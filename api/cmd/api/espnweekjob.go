package main

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/jhunthrop/commish/api/internal/config"
	"github.com/jhunthrop/commish/api/internal/draftroom"
	"github.com/jhunthrop/commish/api/internal/leaguerecord"
)

// runESPNWeekReads reads every attached ESPN league of the board's season twice
// (Lane 93): the NFL week at the run's clock, ESPN's projection for each rostered player
// in the league's scoring, and the week before for its own period, its rosters and points. Cloud
// Scheduler runs it Thursday 13:30 Eastern, half an hour before the
// register's Thursday pass sets the week's order, and Wednesday 19:00
// Eastern, after the Wednesday pass grades the week before (infra/README.md
// lists the schedules). Each read is kept whole, never updated.
func runESPNWeekReads(ctx context.Context, log *slog.Logger, cfg config.API, pool *pgxpool.Pool, _ []string) error {
	if !cfg.Hosts.ESPNEnabled {
		log.Warn("espn is off", "effect", "no ESPN week read")
		return nil
	}
	ff, err := newFFPCWiring(cfg, pool, log)
	if err != nil {
		return err
	}
	e := newESPNWiring(cfg, pool, ff, log)
	board, closeBoard, err := draftroom.OpenBoards(pool, cfg.Board, time.Now, log)
	if err != nil {
		return err
	}
	defer closeBoard()
	now := time.Now()
	week, ok, err := board.Schedule.WeekAt(ctx, cfg.Board.Season, now)
	if err != nil {
		return err
	}
	if !ok {
		log.Info("espn week reads", "effect", "no NFL week at this clock, nothing read")
		return nil
	}
	reader := leaguerecord.ESPNWeeks{Member: e.member, Public: e.client, Log: log}
	got, err := leaguerecord.Capture(ctx, &leaguerecord.Store{Pool: pool}, reader, cfg.Board.Season, leaguerecord.Periods(week), now, log)
	if err != nil {
		return fmt.Errorf("espn week reads: %w", err)
	}
	log.Info("espn week reads", "week", week, "leagues", got.Leagues, "read", got.Read, "skipped", got.Skipped, "failed", got.Failed, "rows", got.Rows)
	return nil
}
