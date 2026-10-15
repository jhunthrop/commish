package boards

import (
	"context"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/jhunthrop/commish/api/internal/db/dbtest"
)

// weekFactsSchema builds the research tables the in-season reads touch,
// with a small fixture season.
func weekFactsSchema(t *testing.T, pool *pgxpool.Pool, schema string) {
	t.Helper()
	ctx := context.Background()
	for _, q := range []string{
		`drop schema if exists ` + schema + ` cascade`,
		`create schema ` + schema,
		`create table ` + schema + `.player_week_observations (season int, week int, player_id text, source text, metric text, as_of timestamptz, value float8)`,
		`create table ` + schema + `.player_week_teams (season int, week int, player_id text, team text, as_of timestamptz)`,
		`create table ` + schema + `.player_crosswalk (provider_player_id text, player_id text)`,
		`create table ` + schema + `.provider_players (id text, name text, position text, team text)`,
		`create table ` + schema + `.provider_games (season int, week int, home_team text, away_team text, game_date date, kickoff_et text)`,
		`create table ` + schema + `.team_week_observations (season int, week int, team text, source text, metric text, as_of timestamptz, value float8)`,
		`create table ` + schema + `.capture_snapshots (source text, payload jsonb, captured_at timestamptz)`,
		`insert into ` + schema + `.provider_players values ('p1', 'A Back', 'RB', 'LAR'), ('p2', 'A Receiver', 'WR', 'BUF')`,
		`insert into ` + schema + `.player_crosswalk values ('p1', 'u1'), ('p2', 'u2')`,
		// u1's rushing yards were restated: the newer row wins. u3 is not
		// crossed to the provider and is left out; a passing row from
		// another source and a metric no rule scores are ignored.
		`insert into ` + schema + `.player_week_observations values
			(2026, 1, 'u1', 'nflverse_player_week', 'rushing_yards', '2026-09-10', 80),
			(2026, 1, 'u1', 'nflverse_player_week', 'rushing_yards', '2026-09-12', 85),
			(2026, 1, 'u1', 'nflverse_player_week', 'receptions', '2026-09-10', 3),
			(2026, 1, 'u1', 'nflverse_player_week', 'targets', '2026-09-10', 4),
			(2026, 1, 'u1', 'nflverse_pbp_derived', 'passing_yards', '2026-09-10', 999),
			(2026, 1, 'u3', 'nflverse_player_week', 'receptions', '2026-09-10', 9),
			(2026, 2, 'u2', 'nflverse_player_week', 'receptions', '2026-09-17', 7),
			(2025, 2, 'u2', 'nflverse_player_week', 'receptions', '2025-09-17', 1)`,
		`insert into ` + schema + `.player_week_teams values (2026, 1, 'u1', 'LA', '2026-09-10'), (2026, 2, 'u2', 'BUF', '2026-09-17')`,
		`insert into ` + schema + `.provider_games values
			(2026, 1, 'LAR', 'BUF', '2026-09-13', '4:25p'), (2026, 2, 'BUF', 'MIA', '2026-09-20', 'TBD')`,
		`insert into ` + schema + `.team_week_observations values
			(2026, 1, 'LA', 'nflverse_kickoff', 'kickoff_instant', '2026-09-13 20:30:00+00', 1),
			(2026, 1, 'LA', 'nflverse_kickoff', 'game_result', '2026-09-14 12:00:00+00', 1),
			(2026, 1, 'BUF', 'nflverse_kickoff', 'game_result', '2026-09-14 12:00:00+00', 0)`,
		`insert into ` + schema + `.capture_snapshots values
			('tank01_injuries_by_date', '{"injDate": "20260912", "injList": [{"playerID": "p1", "designation": "Q"}, {"playerID": "p2", "designation": "O"}]}', '2026-09-12 10:00:00+00'),
			('tank01_injuries_by_date', '{"injDate": "20260913", "injList": [{"playerID": "p1", "designation": "D"}, {"playerID": " ", "designation": "O"}]}', '2026-09-13 10:00:00+00'),
			('other_source', '{"injList": [{"playerID": "p2", "designation": "IR"}]}', '2026-09-14 10:00:00+00')`,
	} {
		if _, err := pool.Exec(ctx, q); err != nil {
			t.Fatal(err)
		}
	}
	t.Cleanup(func() { _, _ = pool.Exec(context.Background(), `drop schema if exists `+schema+` cascade`) })
}

func TestWeekFactReads(t *testing.T) {
	pool := dbtest.Pool(t)
	ctx := context.Background()
	const schema = "weekfacts_test"
	weekFactsSchema(t, pool, schema)
	src, err := NewPGSource(pool, schema, 2026, "")
	if err != nil {
		t.Fatal(err)
	}

	lines, err := src.StatLines(ctx, 2026)
	if err != nil {
		t.Fatal(err)
	}
	if len(lines) != 2 {
		t.Fatalf("lines %+v, want p1 week 1 and p2 week 2", lines)
	}
	l := lines[0]
	if l.PlayerID != "p1" || l.Week != 1 || l.Team != "LAR" || l.Position != "RB" ||
		l.Metrics["rushing_yards"] != 85 || l.Metrics["receptions"] != 3 || len(l.Metrics) != 2 {
		t.Fatalf("p1's line %+v", l)
	}
	if lines[1].PlayerID != "p2" || lines[1].Metrics["receptions"] != 7 {
		t.Fatalf("p2's line %+v", lines[1])
	}

	games, err := src.Schedule(ctx, 2026)
	if err != nil {
		t.Fatal(err)
	}
	byKey := map[string]TeamWeek{}
	for _, g := range games {
		byKey[teamWeekKey(g.Week, g.Team)] = g
	}
	rams := byKey["1|LAR"]
	if rams.Opponent != "BUF" || !rams.Home || !rams.Final || !rams.Kickoff.Equal(time.Date(2026, 9, 13, 20, 30, 0, 0, time.UTC)) {
		t.Fatalf("the Rams' week 1 %+v", rams)
	}
	bills := byKey["1|BUF"]
	if bills.Opponent != "LAR" || bills.Home || !bills.Final || !bills.Kickoff.Equal(time.Date(2026, 9, 13, 20, 25, 0, 0, time.UTC)) {
		t.Fatalf("Buffalo's week 1 %+v (the schedule's 4:25 Eastern, no kickoff observation of its own)", bills)
	}
	if mia := byKey["2|MIA"]; mia.Final || mia.Opponent != "BUF" || !mia.Kickoff.Equal(time.Date(2026, 9, 20, 4, 0, 0, 0, time.UTC)) {
		t.Fatalf("Miami's week 2 %+v: TBD reads as the start of the day", mia)
	}

	d, err := src.Designations(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(d) != 1 || d["p1"].Code != "D" || !d["p1"].AsOf.Equal(time.Date(2026, 9, 13, 10, 0, 0, 0, time.UTC)) {
		t.Fatalf("designations %+v: the newest capture alone, p2 cleared, a blank id dropped", d)
	}
}

func TestDesignationsFromTheRosterSweep(t *testing.T) {
	codes, err := parseCapture(injuriesRosterWide, []byte(`[{"roster": [
		{"playerID": "p1", "injury": {"designation": "IR"}},
		{"playerID": "p2", "injury": {"designation": ""}},
		{"playerID": "p3"}]}]`))
	if err != nil {
		t.Fatal(err)
	}
	if len(codes) != 1 || codes["p1"] != "IR" {
		t.Fatalf("codes %v", codes)
	}
	if _, err := parseCapture(injuriesByDate, []byte(`[1, 2]`)); err == nil {
		t.Fatal("a by-date capture that is not an object reads")
	}
}

func TestNoCaptureIsNoDesignations(t *testing.T) {
	pool := dbtest.Pool(t)
	ctx := context.Background()
	const schema = "weekfacts_empty_test"
	for _, q := range []string{
		`drop schema if exists ` + schema + ` cascade`, `create schema ` + schema,
		`create table ` + schema + `.capture_snapshots (source text, payload jsonb, captured_at timestamptz)`,
	} {
		if _, err := pool.Exec(ctx, q); err != nil {
			t.Fatal(err)
		}
	}
	t.Cleanup(func() { _, _ = pool.Exec(context.Background(), `drop schema if exists `+schema+` cascade`) })
	src, _ := NewPGSource(pool, schema, 2026, "")
	d, err := src.Designations(ctx)
	if err != nil || len(d) != 0 {
		t.Fatalf("designations %v (%v), want none", d, err)
	}
}

// The by-date list is read before a newer roster sweep; a newest capture
// that does not parse gives way to the next with its own stamp; the
// sweep stands in when no by-date capture exists.
func TestDesignationSources(t *testing.T) {
	pool := dbtest.Pool(t)
	ctx := context.Background()
	const schema = "weekfacts_sources_test"
	for _, q := range []string{
		`drop schema if exists ` + schema + ` cascade`, `create schema ` + schema,
		`create table ` + schema + `.capture_snapshots (source text, payload jsonb, captured_at timestamptz)`,
		`insert into ` + schema + `.capture_snapshots values
			('tank01_injuries', '[{"roster": [{"playerID": "p9", "injury": {"designation": "IR"}}]}]', '2026-09-08 10:00:00+00'),
			('tank01_injuries_by_date', '{"injList": [{"playerID": "p1", "designation": "Q"}]}', '2026-09-12 10:00:00+00'),
			('tank01_injuries_by_date', '[1, 2]', '2026-09-13 10:00:00+00'),
			('tank01_injuries', '[{"roster": [{"playerID": "p2", "injury": {"designation": "O"}}]}]', '2026-09-14 10:00:00+00')`,
	} {
		if _, err := pool.Exec(ctx, q); err != nil {
			t.Fatal(err)
		}
	}
	t.Cleanup(func() { _, _ = pool.Exec(context.Background(), `drop schema if exists `+schema+` cascade`) })
	src, _ := NewPGSource(pool, schema, 2026, "")
	d, err := src.Designations(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(d) != 1 || d["p1"].Code != "Q" || !d["p1"].AsOf.Equal(time.Date(2026, 9, 12, 10, 0, 0, 0, time.UTC)) {
		t.Fatalf("designations %+v: the newest by-date capture that reads, with its stamp", d)
	}
	if _, err := pool.Exec(ctx, `delete from `+schema+`.capture_snapshots where source = 'tank01_injuries_by_date'`); err != nil {
		t.Fatal(err)
	}
	d, err = src.Designations(ctx)
	if err != nil || len(d) != 1 || d["p2"].Code != "O" {
		t.Fatalf("designations %+v (%v): the sweep with no by-date capture", d, err)
	}
	if _, err := pool.Exec(ctx, `update `+schema+`.capture_snapshots set payload = '{"x": 1}'`); err != nil {
		t.Fatal(err)
	}
	if _, err := src.Designations(ctx); err == nil {
		t.Fatal("no capture reads, and no error")
	}
}
