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
select ` + m.columns() + `, (select as_of from latest), '` + string(OrderPreseason) + `'::text, ''::text, 0
from ` + s.table("provider_players") + ` pp left join proj board on board.player_id = pp.id` + m.join() + m.order()
}

// publishedQuery is the same roster with the published run's rows for
// (season $1, format $3) when the season has any, else the stored board's
// as preseasonQuery reads it: one statement, so a publish between two
// reads never mixes the two boards. fromWeek is whether the table holds
// from_week (research revision 0007); without it the run's first week
// reads as 0.
func (s *PGSource) publishedQuery(fromWeek bool, m marketRead) string {
	week := "0"
	if fromWeek {
		week = "from_week"
	}
	return `with pub as (
  select player_id, points, floor_points, median_points, ceiling_points, order_basis, refreshed, run_id, ` + week + ` as from_week
  from ` + s.table("published_boards") + ` where season = $1 and format = $3
), ` + s.preseasonCTEs(" and not exists (select 1 from pub)") + `, board as (
  select player_id, points, floor_points, median_points, ceiling_points from pub
  union all select player_id, points, floor_points, median_points, ceiling_points from proj
)` + m.cte(s) + `
select ` + m.columns() + `,
  coalesce((select max(refreshed) from pub), (select as_of from latest)),
  coalesce((select min(order_basis) from pub), '` + string(OrderPreseason) + `'),
  coalesce((select min(run_id) from pub), ''),
  coalesce((select min(from_week) from pub), 0)
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
	fromWeek, err := s.hasFromWeek(ctx)
	if err != nil {
		return "", nil, err
	}
	args := []any{s.Season, s.sourceFor(f), string(f)}
	return s.publishedQuery(fromWeek, marketRead{on: market, first: len(args) + 1}), append(args, marketArgs...), nil
}

// hasFromWeek is true when published_boards holds from_week (research
// revision 0007): the api can deploy ahead of the migration, and then
// reads the league's week as before.
func (s *PGSource) hasFromWeek(ctx context.Context) (bool, error) {
	var ok bool
	err := s.Pool.QueryRow(ctx, `select exists (select 1 from information_schema.columns
  where table_schema = $1 and table_name = 'published_boards' and column_name = 'from_week')`, s.Schema).Scan(&ok)
	if err != nil {
		return false, fmt.Errorf("boards: look for published_boards.from_week: %w", err)
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
