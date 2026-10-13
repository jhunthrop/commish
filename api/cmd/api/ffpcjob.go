package main

import (
	"context"
	"log/slog"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/jhunthrop/commish/api/internal/config"
	"github.com/jhunthrop/commish/api/internal/leaguesync"
)

// runFFPCRefresh reads every attached FFPC league with a connected
// member once, as that member, and keeps the read: the background
// cadence beside the one-a-minute read while someone views. Cloud
// Scheduler runs it hourly and in bursts around FFPC's own clock
// (Wednesday 6 am and Tuesday 6 am Eastern after the waiver runs, Sunday
// 1 pm at the first kickoffs); infra/README.md lists the schedules. The
// client's one-request-a-second gap holds across the whole run.
func runFFPCRefresh(ctx context.Context, log *slog.Logger, cfg config.API, pool *pgxpool.Pool, _ []string) error {
	ff, err := newFFPCWiring(cfg, pool, log)
	if err != nil {
		return err
	}
	store := &leaguesync.Store{Pool: pool}
	host := ff.host(store)
	if host == nil {
		log.Warn("host credentials key not set", "effect", "no FFPC league read")
		return nil
	}
	ids, err := store.FFPCLeagues(ctx)
	if err != nil {
		return err
	}
	read, failed := 0, 0
	for _, id := range ids {
		snap, err := host.Read(ctx, leaguesync.Ref{Host: leaguesync.HostFFPC, LeagueID: id})
		if err != nil {
			failed++
			log.Warn("ffpc refresh: league", "league", id, "err", err)
			continue
		}
		if err := store.PutSnapshot(ctx, snap); err != nil {
			return err
		}
		read++
	}
	log.Info("ffpc refresh", "leagues", len(ids), "read", read, "failed", failed)
	return nil
}
