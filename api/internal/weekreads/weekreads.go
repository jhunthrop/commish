// Package weekreads serves the research store's week reads live (Lane
// 284, B277): the player card's answer carries the newest written read
// for him and the board week, so a read the hourly pass rewrote after a
// status change, or the retry writer rescued (Lane 276), shows within the
// hour rather than at the next nightly's run. The run still carries its
// own read for the prerender and for a client with no live answer.
//
// A read is kept a minute. A read that fails, or runs past its bound,
// marks the store failing for a minute, in which no read is tried and
// every answer goes without the field (failing-read-on-request-path): a
// store that is down costs one bounded wait a minute, not one a request.
package weekreads

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"regexp"
	"strconv"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/sync/singleflight"
)

// Table is the stored reads, research revision 0012.
const Table = "player_week_reads"

// writtenSource is the writer's source: a facts block is never served,
// as the run serves none (nightly/build/pages.py week_read_json).
const writtenSource = "llm"

// Row is one stored written read for a player and week.
type Row struct {
	Week   int
	Body   string
	Call   *string
	Status *string
	// WrittenAt is the write's instant, FactsAt the newest stamp of the
	// facts it was written from (nil with none).
	WrittenAt time.Time
	FactsAt   *time.Time
	// Projection is the published projection it was written with, in
	// PPR, as stored; nil with none.
	Projection *float64
}

// Reader reads one player's written read for a season's week: nil, nil
// when the store holds none.
type Reader interface {
	Read(ctx context.Context, playerID string, season, week int) (*Row, error)
}

// schemaName is a bare Postgres identifier: the schema is configuration.
var schemaName = regexp.MustCompile(`^[a-z_][a-z0-9_]{0,62}$`)

// PGReader reads the research schema: the stored reads are keyed on the
// universe id, the board names players by the provider id, so the read
// goes through the crosswalk as the board's own directory read does.
type PGReader struct {
	pool   *pgxpool.Pool
	schema string
}

// NewPGReader checks the schema name once.
func NewPGReader(pool *pgxpool.Pool, schema string) (*PGReader, error) {
	if !schemaName.MatchString(schema) {
		return nil, fmt.Errorf("weekreads: %q is not a schema name", schema)
	}
	return &PGReader{pool: pool, schema: schema}, nil
}

func (r *PGReader) table(name string) string { return pgx.Identifier{r.schema, name}.Sanitize() }

// Read is his written read for the week, the newest where the crosswalk
// names two universe players for one provider id.
func (r *PGReader) Read(ctx context.Context, playerID string, season, week int) (*Row, error) {
	var row Row
	err := r.pool.QueryRow(ctx, `select w.week, w.body, w.call, w.status, w.written_at, w.facts_at, w.projection_points
from `+r.table(Table)+` w join `+r.table("player_crosswalk")+` c on c.player_id = w.player_id
where c.provider_player_id = $1 and w.season = $2 and w.week = $3 and w.source = $4
order by w.written_at desc limit 1`, playerID, season, week, writtenSource).
		Scan(&row.Week, &row.Body, &row.Call, &row.Status, &row.WrittenAt, &row.FactsAt, &row.Projection)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("weekreads: read %s for %s week %d: %w", Table, playerID, week, err)
	}
	return &row, nil
}

// TTL is how long a read is kept, and how long a failure keeps the store
// unread.
const TTL = time.Minute

// Timeout bounds one read: the request waits on it at most this long.
const Timeout = time.Second

// Live keeps each read for TTL and the store's failure for as long.
type Live struct {
	Reader Reader
	Now    func() time.Time
	// Log takes a failed read; nil discards it.
	Log *slog.Logger
	// TTL and Timeout, the constants when zero.
	TTL     time.Duration
	Timeout time.Duration

	group      singleflight.Group
	mu         sync.Mutex
	kept       map[string]kept
	failedTill time.Time
}

type kept struct {
	row *Row
	at  time.Time
}

func (l *Live) ttl() time.Duration {
	if l.TTL > 0 {
		return l.TTL
	}
	return TTL
}

func (l *Live) timeout() time.Duration {
	if l.Timeout > 0 {
		return l.Timeout
	}
	return Timeout
}

func key(playerID string, season, week int) string {
	return playerID + "/" + strconv.Itoa(season) + "/" + strconv.Itoa(week)
}

// Read is his written read for the week as kept: nil with none, and nil
// while the store is failing. It never returns an error: a read that
// fails answers nil and marks the store failing for TTL.
func (l *Live) Read(ctx context.Context, playerID string, season, week int) *Row {
	k := key(playerID, season, week)
	now := l.Now()
	l.mu.Lock()
	if now.Before(l.failedTill) {
		l.mu.Unlock()
		return nil
	}
	if c, ok := l.kept[k]; ok && now.Sub(c.at) < l.ttl() {
		l.mu.Unlock()
		return c.row
	}
	l.mu.Unlock()
	got, _, _ := l.group.Do(k, func() (any, error) {
		// The request's cancel never cuts a read other requests share;
		// the bound does.
		read, cancel := context.WithTimeout(context.WithoutCancel(ctx), l.timeout())
		defer cancel()
		row, err := l.Reader.Read(read, playerID, season, week)
		l.mu.Lock()
		defer l.mu.Unlock()
		if err != nil {
			l.failedTill = l.Now().Add(l.ttl())
			if l.Log != nil {
				l.Log.Warn("weekreads: the live read failed; answers go without it for a minute", "err", err)
			}
			return (*Row)(nil), nil
		}
		if l.kept == nil {
			l.kept = map[string]kept{}
		}
		l.kept[k] = kept{row: row, at: now}
		return row, nil
	})
	row, _ := got.(*Row)
	return row
}
