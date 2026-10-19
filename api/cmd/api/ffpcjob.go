package main

import (
	"context"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/jhunthrop/commish/api/internal/config"
	"github.com/jhunthrop/commish/api/internal/draftroom"
	"github.com/jhunthrop/commish/api/internal/leaguesync"
)

// runFFPCRefresh reads every FFPC attachment whose member is connected
// once, as that member alone, and keeps the read under them: the background
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
	// The run's schedule answers the league's current week.
	board, closeBoard, err := draftroom.OpenBoards(pool, cfg.Board, time.Now)
	if err != nil {
		return err
	}
	defer closeBoard()
	host := ff.host(store, board.Schedule, log)
	if host == nil {
		log.Warn("ffpc is off", "effect", "no FFPC league read")
		return nil
	}
	refs, err := store.FFPCLeagues(ctx)
	if err != nil {
		return err
	}
	read, failed := 0, 0
	for _, ref := range refs {
		snap, err := host.Read(ctx, ref)
		if err != nil {
			failed++
			log.Warn("ffpc refresh: league", "league", ref.Key(), "err", err)
			continue
		}
		if _, err := store.PutSnapshot(ctx, snap); err != nil {
			return err
		}
		read++
	}
	log.Info("ffpc refresh", "attachments", len(refs), "read", read, "failed", failed)
	return nil
}
