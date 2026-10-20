package boards

import (
	"context"
	"fmt"
	"log/slog"
)

// The board the site shows reaches the api through a table: the nightly
// publishes its run to R2, and `research.nightly publish` keeps
// research.published_boards equal to the public run's board rows (Lane
// 28), keyed on the provider id. From week 7 those rows rank the rest of
// the season, with points and no range; before it they are the stored
// preseason board's. A season with no published rows reads the stored
// board itself, as before the table.

// preseasonCTEs is the newest stored board for (season $1, source $2):
// its stamp (latest) and its rows keyed on the provider id through the
// crosswalk (proj). gate is SQL appended to the stamp's condition; when
// it is false both are empty.
func (s *PGSource) preseasonCTEs(gate string) string {
	return `latest as (
  select max(as_of) as as_of from ` + s.table("preseason_projections") + ` where season = $1 and source = $2` + gate + `
), proj as (
  select c.provider_player_id as player_id, p.projected_points as points, p.floor_points, p.median_points, p.ceiling_points
  from ` + s.table("preseason_projections") + ` p
  join latest l on p.as_of = l.as_of
  join ` + s.table("player_crosswalk") + ` c on c.player_id = p.player_id
  where p.season = $1 and p.source = $2
)`
}

// preseasonQuery is the provider's roster (the ids the product names
// players by) in ADP order, each with the stored board's points: the read
// for a schema the 0006 migration has not reached.
func (s *PGSource) preseasonQuery(m marketRead) string {
	return `with ` + s.preseasonCTEs("") + m.cte(s) + `
select ` + m.columns() + `, (select as_of from latest), '` + string(OrderPreseason) + `'::text, ''::text, 0, null::double precision
from ` + s.table("provider_players") + ` pp left join proj board on board.player_id = pp.id` + m.join() + m.order()
}

// publishedQuery is the same roster with the published run's rows for
// (season $1, format $3) when the season has any, else the stored board's
// as preseasonQuery reads it: one statement, so a publish between two
// reads never mixes the two boards. cols says which later columns the
// table holds: without from_week (research revision 0007) the run's first
// week reads as 0, without game_points (revision 0015, Lane 96) each
// player's points for one more club game read as null.
func (s *PGSource) publishedQuery(cols publishedColumns, m marketRead) string {
	week, game := "0", "null::double precision"
	if cols.fromWeek {
		week = "from_week"
	}
	if cols.gamePoints {
		game = "game_points"
	}
	return `with pub as (
  select player_id, points, floor_points, median_points, ceiling_points, order_basis, refreshed, run_id, ` + week + ` as from_week,
    ` + game + ` as game_points
  from ` + s.table("published_boards") + ` where season = $1 and format = $3
), ` + s.preseasonCTEs(" and not exists (select 1 from pub)") + `, board as (
  select player_id, points, floor_points, median_points, ceiling_points, game_points from pub
  union all select player_id, points, floor_points, median_points, ceiling_points, null::double precision from proj
)` + m.cte(s) + `
select ` + m.columns() + `,
  coalesce((select max(refreshed) from pub), (select as_of from latest)),
  coalesce((select min(order_basis) from pub), '` + string(OrderPreseason) + `'),
  coalesce((select min(run_id) from pub), ''),
  coalesce((select min(from_week) from pub), 0),
  board.game_points
from ` + s.table("provider_players") + ` pp left join board on board.player_id = pp.id` + m.join() + m.order()
}

// boardRead is the statement Load and Version read f's board with, and
// its arguments.
func (s *PGSource) boardRead(ctx context.Context, f Format) (string, []any, error) {
	market, marketArgs, err := s.marketArgs(ctx, f)
	if err != nil {
		return "", nil, err
	}
	published, err := s.hasPublished(ctx)
	if err != nil {
		return "", nil, err
	}
	if !published {
		args := []any{s.Season, s.sourceFor(f)}
		return s.preseasonQuery(marketRead{on: market, first: len(args) + 1}), append(args, marketArgs...), nil
	}
	fromWeek, err := s.hasColumn(ctx, "from_week")
	if err != nil {
		return "", nil, err
	}
	gamePoints, err := s.hasColumn(ctx, "game_points")
	if err != nil {
		return "", nil, err
	}
	args := []any{s.Season, s.sourceFor(f), string(f)}
	return s.publishedQuery(publishedColumns{fromWeek: fromWeek, gamePoints: gamePoints}, marketRead{on: market, first: len(args) + 1}), append(args, marketArgs...), nil
}

// publishedColumns is which of published_boards' later columns the table
// holds.
type publishedColumns struct {
	fromWeek, gamePoints bool
}

// hasColumn is true when published_boards holds the column (from_week,
// research revision 0007; game_points, revision 0015): the api can deploy
// ahead of the migration, and then reads as before it.
func (s *PGSource) hasColumn(ctx context.Context, column string) (bool, error) {
	var ok bool
	err := s.Pool.QueryRow(ctx, `select exists (select 1 from information_schema.columns
  where table_schema = $1 and table_name = 'published_boards' and column_name = $2)`, s.Schema, column).Scan(&ok)
	if err != nil {
		return false, fmt.Errorf("boards: look for published_boards.%s: %w", column, err)
	}
	return ok, nil
}

// hasPublished is true when the schema holds published_boards (research
// revision 0006) and this role may read it. Asked on every read (one
// catalog lookup, every TTL a format), never latched: the api can deploy
// ahead of the migration, and a migration run by a role whose default
// privileges do not reach the api's role creates a table the api cannot
// select from. Either way the board reads the stored preseason board, as
// before the table, rather than failing every room; an unreadable table is
// logged once a process.
func (s *PGSource) hasPublished(ctx context.Context) (bool, error) {
	var exists, readable bool
	err := s.Pool.QueryRow(ctx, `select to_regclass($1) is not null,
  coalesce(has_table_privilege(to_regclass($1), 'select'), false)`, s.table("published_boards")).Scan(&exists, &readable)
	if err != nil {
		return false, fmt.Errorf("boards: look for published_boards: %w", err)
	}
	if exists && !readable && s.unreadable.CompareAndSwap(false, true) {
		slog.Warn("boards: published_boards exists but this role cannot select from it; reading the preseason board",
			"table", s.table("published_boards"))
	}
	return readable, nil
}
