package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/gh-Constant/prior/server/internal/config"
	"github.com/gh-Constant/prior/server/internal/database"
	"github.com/gh-Constant/prior/server/internal/httpapi"
)

func main() {
	// All timestamps (logs, database, sessions) are UTC.
	time.Local = time.UTC

	cfg := config.Load()
	if cfg.Production() {
		slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout, nil)))
	}
	if cfg.DatabaseURL == "" {
		slog.Error("DATABASE_URL is required")
		os.Exit(1)
	}
	if cfg.Production() && cfg.SettingsEncryptionKey == "" {
		slog.Warn("SETTINGS_ENCRYPTION_KEY is empty: per-user assistant secrets are stored without at-rest sealing")
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

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

	api := httpapi.New(cfg, pool)
	go api.CleanupLoop(ctx)
	go api.StartRealtimeSubscriber(ctx)
	server := &http.Server{Addr: cfg.HTTPAddr, Handler: api.Handler(), ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 2 * time.Minute, WriteTimeout: 2 * time.Minute, IdleTimeout: 60 * time.Second}
	go func() {
		slog.Info("Prior API listening", "addr", cfg.HTTPAddr, "env", cfg.Env)
		if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			slog.Error("http server", "error", err)
			stop()
		}
	}()
	<-ctx.Done()
	shutdownContext, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	_ = server.Shutdown(shutdownContext)
}
