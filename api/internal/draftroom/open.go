package draftroom

import (
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/jhunthrop/commish/api/internal/boards"
	"github.com/jhunthrop/commish/api/internal/config"
	"github.com/jhunthrop/commish/api/internal/db"
)

// OpenBoards is the rooms' board reader as configured: the research
// tables through app's own pool, or through a pool of their own when
// BOARD_DATABASE_URL names another database. close releases that pool. log takes each board read's duration.
func OpenBoards(app *pgxpool.Pool, c config.Board, now func() time.Time, log *slog.Logger) (*Boards, func(), error) {
	pool, closeFn := app, func() {}
	if c.DatabaseURL != "" {
		own, err := db.Open(c.DatabaseURL)
		if err != nil {
			return nil, nil, err
		}
		pool, closeFn = own, own.Close
	}
	source, err := boards.NewPGSource(pool, c.Schema, c.Season, c.SourcePrefix)
	if err != nil {
		closeFn()
		return nil, nil, err
	}
	return &Boards{Raw: &boards.Cache{Source: source, TTL: c.TTL, Now: now, Log: log}, Schedule: source}, closeFn, nil
}
