// Command migrate applies the app schema's pending migrations and
// exits. The deploy workflow runs it as a Cloud Run job before the new
// api and room revisions take traffic; no container migrates at start.
package main

import (
	"context"
	"log/slog"
	"os"
	"os/signal"
	"syscall"

	"github.com/jhunthrop/commish/api/internal/config"
	"github.com/jhunthrop/commish/api/internal/db"
)

// version is set at build: -ldflags "-X main.version=<git sha>".
var version = "dev"

func main() {
	log := slog.New(slog.NewJSONHandler(os.Stdout, nil)).With("service", "migrate", "version", version)
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	cfg, err := config.LoadMigrate(os.Getenv)
	if err != nil {
		log.Error("exit", "err", err)
		os.Exit(1)
	}
	applied, err := db.Migrate(ctx, cfg.MigrateURL, log)
	if err != nil {
		log.Error("exit", "err", err)
		os.Exit(1)
	}
	log.Info("migrated", "applied", applied)
}
