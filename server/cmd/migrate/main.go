package main

import (
	"context"
	"log/slog"
	"os"

	"github.com/gh-Constant/prior/server/internal/config"
	"github.com/gh-Constant/prior/server/internal/database"
)

func main() {
	ctx := context.Background()
	cfg := config.Load()
	pool, err := database.Open(ctx, cfg.DatabaseURL)
	if err != nil {
		slog.Error("open database", "error", err)
		os.Exit(1)
	}
	defer pool.Close()
	if err := database.Migrate(ctx, pool); err != nil {
		slog.Error("migrate database", "error", err)
		os.Exit(1)
	}
	slog.Info("database ready")
}
