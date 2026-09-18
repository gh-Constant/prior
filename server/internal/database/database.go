package database

import (
	"context"
	"embed"
	"fmt"
	"log/slog"
	"sort"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

//go:embed migrations/*.sql
var migrationFiles embed.FS

func Open(ctx context.Context, url string) (*pgxpool.Pool, error) {
	if url == "" {
		return nil, fmt.Errorf("DATABASE_URL is required")
	}
	config, err := pgxpool.ParseConfig(url)
	if err != nil {
		return nil, fmt.Errorf("parse database url: %w", err)
	}
	config.MaxConns = 8
	config.MinConns = 1
	pool, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		return nil, fmt.Errorf("open database: %w", err)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("ping database: %w", err)
	}
	return pool, nil
}

func Migrate(ctx context.Context, pool *pgxpool.Pool) error {
	entries, err := migrationFiles.ReadDir("migrations")
	if err != nil {
		return err
	}
	sort.Slice(entries, func(i, j int) bool { return entries[i].Name() < entries[j].Name() })
	for _, entry := range entries {
		started := time.Now()
		contents, readErr := migrationFiles.ReadFile("migrations/" + entry.Name())
		if readErr != nil {
			return readErr
		}
		// One transaction per file under a transaction-scoped advisory lock so
		// concurrent API replicas serialize migrations without a session-level
		// lock that could leak across deploys. Migrations must stay idempotent
		// (IF NOT EXISTS / ADD COLUMN IF NOT EXISTS).
		tx, err := pool.Begin(ctx)
		if err != nil {
			return err
		}
		var locked bool
		if err := tx.QueryRow(ctx, "SELECT pg_try_advisory_xact_lock(907381)").Scan(&locked); err != nil {
			_ = tx.Rollback(ctx)
			return err
		}
		if !locked {
			_ = tx.Rollback(ctx)
			return fmt.Errorf("migration %s: another migrator holds the lock", entry.Name())
		}
		if _, execErr := tx.Exec(ctx, string(contents)); execErr != nil {
			_ = tx.Rollback(ctx)
			return fmt.Errorf("migration %s: %w", entry.Name(), execErr)
		}
		if err := tx.Commit(ctx); err != nil {
			return fmt.Errorf("migration %s: %w", entry.Name(), err)
		}
		slog.Info("migration applied", "migration", entry.Name(), "duration_ms", time.Since(started).Milliseconds())
	}
	return nil
}
