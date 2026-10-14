package main

import (
	"context"
	"log/slog"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/jhunthrop/commish/api/internal/config"
	"github.com/jhunthrop/commish/api/internal/hosts"
)

// runRekey re-wraps every connected host account's data key under the
// current HOST_CREDENTIALS_KEY version, during a rotation (hosts.Rekey
// says the steps). It opens no secret.
func runRekey(ctx context.Context, log *slog.Logger, cfg config.API, pool *pgxpool.Pool, _ []string) error {
	current, ring := cfg.Hosts.Ring()
	vault, err := hosts.NewVault(hosts.Keys{Current: current, ByVer: ring})
	if err != nil {
		return err
	}
	done, skipped, err := hosts.Rekey(ctx, &hosts.Store{Pool: pool}, vault)
	if err != nil {
		return err
	}
	log.Info("re-encrypted host connections", "version", current, "rewrapped", done, "skipped", skipped)
	return nil
}
