package boards

import (
	"context"
	"fmt"
	"log/slog"
	"regexp"
	"sync"
	"sync/atomic"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/jhunthrop/commish/api/internal/draft"
)

// Source reads one stored scoring board.
type Source interface {
	Load(ctx context.Context, f Format) (*Raw, error)
}

// Versioner names the state a Source would read a board from, in a few
// bytes: two equal versions read equal boards, so a cache whose TTL ran
// out keeps its board when the version has not moved rather than reading
// every row again.
type Versioner interface {
	Version(ctx context.Context, f Format) (string, error)
}

// schemaName is a bare Postgres identifier: the schema is configuration,
// never input, and is still checked before it reaches a query.
var schemaName = regexp.MustCompile(`^[a-z_][a-z0-9_]{0,62}$`)

// PGSource reads the research schema (research/README.md): the
// provider's roster (provider_players, the ids rooms and sheets name
// players by), the stored board (preseason_projections, one source per
// scoring format, keyed on the universe id), the crosswalk between them,
// the provider's schedule for byes, and the published run's board
// (published_boards, which in season holds the rest-of-season order).
type PGSource struct {
	Pool *pgxpool.Pool
	// Schema holds the research tables, "research".
	Schema string
	// Season is the season the board drafts for.
	Season int
	// SourcePrefix names the stored boards: <prefix>_<format>_12.
	SourcePrefix string

	// unreadable is set once published_boards was found and not readable,
	// so the warning is logged once a process.
	unreadable atomic.Bool
	// tablesUnreadable is the same for the optional research tables the
	// week reads (the venues, the weekly projection).
	tablesUnreadable atomic.Bool
}

// NewPGSource checks the schema name once.
func NewPGSource(pool *pgxpool.Pool, schema string, season int, sourcePrefix string) (*PGSource, error) {
	if !schemaName.MatchString(schema) {
		return nil, fmt.Errorf("boards: %q is not a schema name", schema)
	}
	return &PGSource{Pool: pool, Schema: schema, Season: season, SourcePrefix: sourcePrefix}, nil
}

func (s *PGSource) table(name string) string { return pgx.Identifier{s.Schema, name}.Sanitize() }

// byeQuery is each team's bye: the first week of the season's schedule
// it plays no game.
func (s *PGSource) byeQuery() string {
	games := s.table("provider_games")
	return `with season_games as (select home_team, away_team, week from ` + games + ` where season = $1),
played as (
  select home_team as team, week from season_games union select away_team, week from season_games
), weeks as (select distinct week from season_games where week between 1 and 18),
teams as (select distinct team from played)
select t.team, min(w.week) from teams t cross join weeks w
where not exists (select 1 from played p where p.team = t.team and p.week = w.week)
group by t.team`
}

// Load reads the format's board joined to the directory: the published
// run's rows when the season has them, else the newest stored board.
func (s *PGSource) Load(ctx context.Context, f Format) (*Raw, error) {
	byes, err := s.byes(ctx)
	if err != nil {
		return nil, err
	}
	query, args, err := s.boardRead(ctx, f)
	if err != nil {
		return nil, err
	}
	source := s.sourceFor(f)
	rows, err := s.Pool.Query(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("boards: read %s: %w", source, err)
	}
	defer rows.Close()
	raw := &Raw{Format: f, Season: s.Season, Source: source}
	var stamp boardStamp
	for rows.Next() {
		p, position, err := scanBoardRow(rows, &stamp)
		if err != nil {
			return nil, fmt.Errorf("boards: scan %s: %w", source, err)
		}
		if directoryPlayer(&p, position, byes) {
			raw.Players = append(raw.Players, p)
		}
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("boards: read %s: %w", source, err)
	}
	if stamp.asOf == nil {
		return nil, fmt.Errorf("boards: no stored board %s for %d", source, s.Season)
	}
	if !stamp.order.Valid() {
		return nil, fmt.Errorf("boards: %s for %d has order %q", source, s.Season, stamp.order)
	}
	raw.AsOf, raw.Order, raw.Run, raw.FromWeek = stamp.asOf.UTC(), stamp.order, stamp.run, stamp.fromWeek
	return raw, nil
}

// boardStamp is the board's own columns, which every row repeats: when
// its points were made, the order they rank, the published run.
type boardStamp struct {
	asOf  *time.Time
	order Order
	run   string
	// fromWeek is the run's first week, 0 for none.
	fromWeek int
}

// scanBoardRow reads one directory row with its points, and the board's
// stamp into stamp.
func scanBoardRow(rows pgx.Rows, stamp *boardStamp) (Player, string, error) {
	var p Player
	var position string
	var floor, median, ceiling *float64
	if err := rows.Scan(&p.ID, &p.Name, &position, &p.Team, &p.Headshot, &p.ADP, &p.Points, &floor, &median, &ceiling,
		&stamp.asOf, &stamp.order, &stamp.run, &stamp.fromWeek, &p.GamePoints); err != nil {
		return Player{}, "", err
	}
	if floor != nil && median != nil && ceiling != nil {
		p.Range = &Range{Floor: *floor, Median: *median, Ceiling: *ceiling}
	}
	return p, position, nil
}

// Version is a digest, computed on the server, of every row Load would
// read for f (the board query's rows and the byes), each set in a fixed
// order: 65 bytes over the wire where Load moves about 260 KB. A publish
// moves it: the rows carry the published run, its points and its refresh.
func (s *PGSource) Version(ctx context.Context, f Format) (string, error) {
	board, args, err := s.boardRead(ctx, f)
	if err != nil {
		return "", err
	}
	query := `select md5(coalesce(string_agg(b::text, '|' order by b::text), '')) || ':' ||
  (select md5(coalesce(string_agg(y::text, '|' order by y::text), '')) from (` + s.byeQuery() + `) y)
from (` + board + `) b`
	var version string
	if err := s.Pool.QueryRow(ctx, query, args...).Scan(&version); err != nil {
		return "", fmt.Errorf("boards: version of %s: %w", s.sourceFor(f), err)
	}
	return version, nil
}

func (s *PGSource) sourceFor(f Format) string { return fmt.Sprintf("%s_%s_12", s.SourcePrefix, f) }

// directoryPlayer finishes a directory row the way every board reads it:
// its position (false for one no room drafts) and its team's bye.
func directoryPlayer(p *Player, position string, byes map[string]int) bool {
	p.Position = draft.Position(position)
	p.Bye = byes[p.Team]
	return p.Position.Valid()
}

func (s *PGSource) byes(ctx context.Context) (map[string]int, error) {
	rows, err := s.Pool.Query(ctx, s.byeQuery(), s.Season)
	if err != nil {
		return nil, fmt.Errorf("boards: read byes: %w", err)
	}
	out := map[string]int{}
	for rows.Next() {
		var team string
		var week int
		if err := rows.Scan(&team, &week); err != nil {
			rows.Close()
			return nil, fmt.Errorf("boards: scan byes: %w", err)
		}
		out[team] = week
	}
	return out, rows.Err()
}

// Cache holds each format's board for TTL: the board changes nightly, and
// a pick must not read 1,500 rows. Past its TTL a board whose Source is a
// Versioner is kept while its version stands (one row read, not the
// board), so a busy instance reads the board again only once it moved.
type Cache struct {
	Source Source
	TTL    time.Duration
	Now    func() time.Time

	mu      sync.Mutex
	entries map[Format]cached
	loading map[Format]*sync.Mutex
	// warned is set once a version read has failed and been logged.
	warned atomic.Bool
}

type cached struct {
	raw     *Raw
	at      time.Time
	version string
}

// Load answers from the cache, reloading a stale format once however many
// requests ask for it at the same time.
func (c *Cache) Load(ctx context.Context, f Format) (*Raw, error) {
	if raw, ok := c.fresh(f); ok {
		return raw, nil
	}
	lock := c.formatLock(f)
	lock.Lock()
	defer lock.Unlock()
	if raw, ok := c.fresh(f); ok {
		return raw, nil
	}
	// The version is read before the board: a change between the two
	// leaves an older version beside a newer board, which costs the next
	// check a reload, never a stale board kept.
	version := c.version(ctx, f)
	if raw, ok := c.unmoved(f, version); ok {
		return raw, nil
	}
	raw, err := c.Source.Load(ctx, f)
	if err != nil {
		return nil, err
	}
	c.mu.Lock()
	c.entries[f] = cached{raw: raw, at: c.Now(), version: version}
	c.mu.Unlock()
	return raw, nil
}

// version is the Source's version of f, "" when it names none or cannot
// be read (then the board is read in full, as without one).
func (c *Cache) version(ctx context.Context, f Format) string {
	v, ok := c.Source.(Versioner)
	if !ok {
		return ""
	}
	version, err := v.Version(ctx, f)
	if err != nil {
		// Logged once a process: a broken version read would otherwise quietly
		// bring back a full board read every TTL.
		if c.warned.CompareAndSwap(false, true) {
			slog.Warn("boards: the board version could not be read; reading boards in full", "format", f, "error", err)
		}
		return ""
	}
	return version
}

// unmoved keeps the held board for another TTL when its version stands.
func (c *Cache) unmoved(f Format, version string) (*Raw, bool) {
	if version == "" {
		return nil, false
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	e, ok := c.entries[f]
	if !ok || e.version != version {
		return nil, false
	}
	e.at = c.Now()
	c.entries[f] = e
	return e.raw, true
}

func (c *Cache) fresh(f Format) (*Raw, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.entries == nil {
		c.entries = map[Format]cached{}
		c.loading = map[Format]*sync.Mutex{}
	}
	e, ok := c.entries[f]
	if !ok || c.Now().Sub(e.at) > c.TTL {
		return nil, false
	}
	return e.raw, true
}

func (c *Cache) formatLock(f Format) *sync.Mutex {
	c.mu.Lock()
	defer c.mu.Unlock()
	lock, ok := c.loading[f]
	if !ok {
		lock = &sync.Mutex{}
		c.loading[f] = lock
	}
	return lock
}
