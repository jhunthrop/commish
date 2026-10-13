package boards

import (
	"context"
	"fmt"
	"regexp"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/jhunthrop/commish/api/internal/draft"
)

// Source reads one stored scoring board.
type Source interface {
	Load(ctx context.Context, f Format) (*Raw, error)
}

// schemaName is a bare Postgres identifier: the schema is configuration,
// never input, and is still checked before it reaches a query.
var schemaName = regexp.MustCompile(`^[a-z_][a-z0-9_]{0,62}$`)

// PGSource reads the research tables: the directory (players), the
// stored board (preseason_projections, one source per scoring format,
// keyed on the universe id), the crosswalk between the two, and the
// schedule for byes.
type PGSource struct {
	Pool *pgxpool.Pool
	// Schema holds the research tables: "research" in the prep site's
	// database, "public" in the legacy copy used for development.
	Schema string
	// Season is the season the board drafts for.
	Season int
	// SourcePrefix names the stored boards: <prefix>_<format>_12.
	SourcePrefix string
}

// NewPGSource checks the schema name once.
func NewPGSource(pool *pgxpool.Pool, schema string, season int, sourcePrefix string) (*PGSource, error) {
	if !schemaName.MatchString(schema) {
		return nil, fmt.Errorf("boards: %q is not a schema name", schema)
	}
	return &PGSource{Pool: pool, Schema: schema, Season: season, SourcePrefix: sourcePrefix}, nil
}

func (s *PGSource) table(name string) string { return pgx.Identifier{s.Schema, name}.Sanitize() }

func (s *PGSource) boardQuery() string {
	return `with latest as (
  select max(as_of) as as_of from ` + s.table("preseason_projections") + ` where season = $1 and source = $2
), proj as (
  select c.player_id, p.projected_points
  from ` + s.table("preseason_projections") + ` p
  join latest l on p.as_of = l.as_of
  join ` + s.table("player_crosswalk") + ` c on c.nfl_player_id = p.player_id
  where p.season = $1 and p.source = $2
)
select pl.id, pl.name, pl.position::text, pl.nfl_team, coalesce(pl.headshot_url, ''), pl.adp::float8, proj.projected_points,
  (select as_of from latest)
from ` + s.table("players") + ` pl left join proj on proj.player_id = pl.id
order by pl.adp asc nulls last, pl.id collate "C"`
}

func (s *PGSource) byeQuery() string {
	games := s.table("nfl_games")
	return `with played as (
  select home_nfl_team as team, week from ` + games + ` union select away_nfl_team, week from ` + games + `
), weeks as (select distinct week from ` + games + ` where week between 1 and 18),
teams as (select distinct team from played)
select t.team, min(w.week) from teams t cross join weeks w
where not exists (select 1 from played p where p.team = t.team and p.week = w.week)
group by t.team`
}

// Load reads the format's newest stored board joined to the directory.
func (s *PGSource) Load(ctx context.Context, f Format) (*Raw, error) {
	byes, err := s.byes(ctx)
	if err != nil {
		return nil, err
	}
	source := fmt.Sprintf("%s_%s_12", s.SourcePrefix, f)
	rows, err := s.Pool.Query(ctx, s.boardQuery(), s.Season, source)
	if err != nil {
		return nil, fmt.Errorf("boards: read %s: %w", source, err)
	}
	raw := &Raw{Format: f, Season: s.Season, Source: source}
	var asOf *time.Time
	for rows.Next() {
		var p Player
		var position string
		if err := rows.Scan(&p.ID, &p.Name, &position, &p.Team, &p.Headshot, &p.ADP, &p.Points, &asOf); err != nil {
			rows.Close()
			return nil, fmt.Errorf("boards: scan %s: %w", source, err)
		}
		p.Position = draft.Position(position)
		if !p.Position.Valid() {
			continue
		}
		p.Bye = byes[p.Team]
		raw.Players = append(raw.Players, p)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("boards: read %s: %w", source, err)
	}
	if asOf == nil {
		return nil, fmt.Errorf("boards: no stored board %s for %d", source, s.Season)
	}
	raw.AsOf = asOf.UTC()
	return raw, nil
}

func (s *PGSource) byes(ctx context.Context) (map[string]int, error) {
	rows, err := s.Pool.Query(ctx, s.byeQuery())
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
// a pick must not read 1,500 rows.
type Cache struct {
	Source Source
	TTL    time.Duration
	Now    func() time.Time

	mu      sync.Mutex
	entries map[Format]cached
	loading map[Format]*sync.Mutex
}

type cached struct {
	raw *Raw
	at  time.Time
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
	raw, err := c.Source.Load(ctx, f)
	if err != nil {
		return nil, err
	}
	c.mu.Lock()
	c.entries[f] = cached{raw: raw, at: c.Now()}
	c.mu.Unlock()
	return raw, nil
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
