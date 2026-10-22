package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/jhunthrop/commish/api/internal/config"
	"github.com/jhunthrop/commish/api/internal/leaguesync"
)

// runYahooProbe reads, once, as the member who attached a Yahoo league of
// the board's season, the answers that could carry a weekly rank or
// projection (Lane 130: the week's scoreboard, the players with ranks and
// percent owned, their week's stats) and logs their shapes as one line,
// probe "yahoo-week": field names, one example row with member data
// blanked, and the values that say what each figure covers. No answer is
// kept and no token leaves the process. An operator runs it by hand on an
// api job's image with its arguments overridden (the Lane 130 report).
func runYahooProbe(ctx context.Context, log *slog.Logger, cfg config.API, pool *pgxpool.Pool, _ []string) error {
	ff, err := newFFPCWiring(cfg, pool, log)
	if err != nil {
		return err
	}
	y := newYahooWiring(cfg, pool, ff, log)
	if !y.on {
		return errors.New("yahoo is off: HOST_YAHOO_ENABLED, the credentials key and the Yahoo app are all needed")
	}
	got, err := leaguesync.ProbeYahoo(ctx, &leaguesync.Store{Pool: pool}, y.member, cfg.Board.Season, time.Now())
	if err != nil {
		return fmt.Errorf("yahoo probe: %w", err)
	}
	log.Info("yahoo probe", "probe", got.Probe, "record", got)
	return nil
}
