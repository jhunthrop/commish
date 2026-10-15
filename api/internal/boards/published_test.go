package boards

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/jhunthrop/commish/api/internal/db"
	"github.com/jhunthrop/commish/api/internal/db/dbtest"
	"github.com/jhunthrop/commish/api/internal/draft"
)

// publishedSchema is a scratch schema shaped like the research tables the
// board reads, published_boards (revision 0006) included, on the test
// database, dropped when the test ends.
const publishedSchema = "boards_published_test"

var (
	preseasonAsOf = time.Date(2026, 9, 9, 2, 20, 29, 0, time.UTC)
	refreshedAt   = time.Date(2026, 10, 21, 12, 0, 0, 0, time.UTC)
)

func publishedFixture(t *testing.T, withTable bool) (*pgxpool.Pool, *PGSource) {
	t.Helper()
	url := dbtest.URL(t)
	ctx := context.Background()
	pool, err := db.Connect(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(ctx, "drop schema if exists "+publishedSchema+" cascade")
		pool.Close()
	})
	s := publishedSchema
	stmts := []string{
		"drop schema if exists " + s + " cascade",
		"create schema " + s,
		"create table " + s + ".preseason_projections (season int, source text, player_id text, as_of timestamptz, " +
			"projected_points float8, floor_points float8, median_points float8, ceiling_points float8)",
		"create table " + s + ".player_crosswalk (provider_player_id text, player_id text)",
		"create table " + s + ".provider_players (id text, name text, position text, team text, headshot_url text, adp float8)",
		"create table " + s + ".provider_games (season int, week int, home_team text, away_team text)",
		"insert into " + s + ".preseason_projections values " +
			"(2026, 'commish_board_v9_ppr_12', 'u1', '2026-09-09T02:20:29Z', 262.1, 177.6, 262.1, 346.6), " +
			"(2026, 'commish_board_v9_ppr_12', 'u2', '2026-09-09T02:20:29Z', 307.3, 207.6, 307.4, 407.1)",
		"insert into " + s + ".player_crosswalk values ('p1', 'u1'), ('p2', 'u2')",
		"insert into " + s + ".provider_players values ('p1', 'J. Gibbs', 'RB', 'DET', null, 1.4), " +
			"('p2', 'J. Allen', 'QB', 'BUF', null, 32.4), ('p3', 'B. Aubrey', 'K', 'DAL', null, 150)",
		"insert into " + s + ".provider_games values (2026, 1, 'DET', 'BUF'), (2026, 2, 'DAL', 'NYG')",
	}
	if withTable {
		stmts = append(stmts, "create table "+s+".published_boards (season int, format text, player_id text, run_id text, "+
			"rank int, position_rank int, points float8, points_over_replacement float8, floor_points float8, "+
			"median_points float8, ceiling_points float8, order_basis text, refreshed timestamptz, published_at timestamptz, "+
			"primary key (season, format, player_id))")
	}
	for _, stmt := range stmts {
		if _, err := pool.Exec(ctx, stmt); err != nil {
			t.Fatal(err)
		}
	}
	src, err := NewPGSource(pool, s, 2026, "commish_board_v9")
	if err != nil {
		t.Fatal(err)
	}
	return pool, src
}

// publishRun stands in for `research.nightly publish`: the season's rows
// replaced by one run's.
func publishRun(t *testing.T, pool *pgxpool.Pool, run, basis string, rows ...string) {
	t.Helper()
	ctx := context.Background()
	if _, err := pool.Exec(ctx, "delete from "+publishedSchema+".published_boards where season = 2026"); err != nil {
		t.Fatal(err)
	}
	for _, row := range rows {
		// row: format, player, points, floor (or null)
		parts := strings.Split(row, ",")
		_, err := pool.Exec(ctx, "insert into "+publishedSchema+".published_boards values "+
			"(2026, $1, $2, $3, 1, 1, $4::text::float8, 10, $5::text::float8, $5::text::float8, $5::text::float8, $6, $7, now())",
			parts[0], parts[1], run, parts[2], nullable(parts[3]), basis, refreshedAt)
		if err != nil {
			t.Fatal(err)
		}
	}
}

func nullable(v string) *string {
	if v == "null" {
		return nil
	}
	return &v
}

func pointsOf(raw *Raw) map[string]*float64 {
	out := map[string]*float64{}
	for _, p := range raw.Players {
		out[p.ID] = p.Points
	}
	return out
}

func load(t *testing.T, src *PGSource, f Format) *Raw {
	t.Helper()
	raw, err := src.Load(context.Background(), f)
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

// From week 7 the published run ranks the rest of the season: its points
// beat the preseason board's, with no range, and the board names its
// order and its refresh. The directory (ADP order, the kicker, byes) is
// the same board either way.
func TestPublishedBoardBeatsThePreseasonBoard(t *testing.T) {
	pool, src := publishedFixture(t, true)
	publishRun(t, pool, "2026-10-21T12", "rest_of_season", "ppr,p1,242.5,null", "ppr,p2,195.3,null")
	raw := load(t, src, PPR)
	if raw.OrderBasis != OrderRestOfSeason || !raw.AsOf.Equal(refreshedAt) || raw.Run != "2026-10-21T12" {
		t.Fatalf("basis %q as of %s run %q", raw.OrderBasis, raw.AsOf, raw.Run)
	}
	ids := make([]string, len(raw.Players))
	for i, p := range raw.Players {
		ids[i] = p.ID
	}
	if strings.Join(ids, " ") != "p1 p2 p3" {
		t.Fatalf("pool order %v", ids)
	}
	gibbs := raw.Players[0]
	if gibbs.Points == nil || *gibbs.Points != 242.5 || gibbs.Range != nil || gibbs.Bye != 2 {
		t.Fatalf("published row %+v", gibbs)
	}
	if raw.Players[2].Points != nil {
		t.Fatalf("a kicker carries no projection: %v", *raw.Players[2].Points)
	}
	b, err := For(raw, 12, []draft.SlotConfig{{Slot: draft.SlotQB, Count: 1}, {Slot: draft.SlotRB, Count: 2}})
	if err != nil {
		t.Fatal(err)
	}
	if b.OrderBasis() != OrderRestOfSeason || !b.Refreshed().Equal(refreshedAt) {
		t.Fatalf("board basis %q refreshed %s", b.OrderBasis(), b.Refreshed())
	}
	if basis := b.Basis(); !strings.Contains(basis, "rest of the season, refreshed October 21") {
		t.Fatalf("basis %q", basis)
	}
}

// Before week 7 the published run is the preseason board: its rows keep
// their range, and the basis is the preseason sentence.
func TestPublishedPreseasonRunKeepsItsRange(t *testing.T) {
	pool, src := publishedFixture(t, true)
	publishRun(t, pool, "2026-10-13T05", "preseason", "ppr,p1,262.1,177.6", "ppr,p2,307.3,207.6")
	raw := load(t, src, PPR)
	if raw.OrderBasis != OrderPreseason || raw.Players[0].Range == nil || raw.Players[0].Range.Floor != 177.6 {
		t.Fatalf("basis %q first %+v", raw.OrderBasis, raw.Players[0])
	}
	b := Board{Raw: raw, teams: 12}
	if basis := b.Basis(); strings.Contains(basis, "rest of the season") {
		t.Fatalf("basis %q", basis)
	}
}

// An empty table, another season's rows, and a schema the migration has
// not reached yet all read the preseason board as before.
func TestEmptyPublishedTableFallsBackToThePreseasonBoard(t *testing.T) {
	for _, c := range []struct {
		name      string
		withTable bool
		seed      string
	}{
		{"empty table", true, ""},
		{"another season", true, "insert into " + publishedSchema + ".published_boards values " +
			"(2027, 'ppr', 'p1', '2027-09-01T05', 1, 1, 999, 10, null, null, null, 'preseason', now(), now())"},
		{"no table yet", false, ""},
	} {
		t.Run(c.name, func(t *testing.T) {
			pool, src := publishedFixture(t, c.withTable)
			if c.seed != "" {
				if _, err := pool.Exec(context.Background(), c.seed); err != nil {
					t.Fatal(err)
				}
			}
			raw := load(t, src, PPR)
			if raw.OrderBasis != OrderPreseason || !raw.AsOf.Equal(preseasonAsOf) || raw.Run != "" {
				t.Fatalf("basis %q as of %s run %q", raw.OrderBasis, raw.AsOf, raw.Run)
			}
			if p := pointsOf(raw)["p1"]; p == nil || *p != 262.1 || raw.Players[0].Range == nil {
				t.Fatalf("preseason row %+v", raw.Players[0])
			}
		})
	}
}

// The run serves superflex as its own format (the PPR points valued for a
// second quarterback); a league reads the scoring board it drafts on and
// values its own roster, so the superflex rows never reach a PPR read.
func TestPublishedSuperflexRowsStayOffTheScoringBoards(t *testing.T) {
	pool, src := publishedFixture(t, true)
	publishRun(t, pool, "2026-10-21T12", "rest_of_season",
		"ppr,p1,242.5,null", "ppr,p2,195.3,null", "superflex,p1,1,null", "superflex,p2,2,null")
	points := pointsOf(load(t, src, PPR))
	if *points["p1"] != 242.5 || *points["p2"] != 195.3 {
		t.Fatalf("ppr read %v %v", *points["p1"], *points["p2"])
	}
	// A format the run did not publish reads its preseason board, which
	// this store does not hold: an error, never another format's rows.
	if _, err := src.Load(context.Background(), Half); err == nil {
		t.Fatal("half read a board the store does not hold")
	}
}

// The version moves when a run is published over the preseason board and
// when the next run replaces it, so the cache rereads within its TTL.
func TestVersionMovesWithThePublishedRun(t *testing.T) {
	pool, src := publishedFixture(t, true)
	ctx := context.Background()
	seen := map[string]bool{}
	for i, publish := range []func(){
		func() {},
		func() { publishRun(t, pool, "2026-10-13T05", "preseason", "ppr,p1,262.1,177.6") },
		func() { publishRun(t, pool, "2026-10-21T12", "rest_of_season", "ppr,p1,242.5,null") },
	} {
		publish()
		v, err := src.Version(ctx, PPR)
		if err != nil {
			t.Fatal(err)
		}
		if seen[v] {
			t.Fatalf("step %d: the version did not move", i)
		}
		seen[v] = true
	}
}
