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
		{"playerID": "p1", "injury": {"designation": "O", "description": "Out for the season (knee)"}},
		{"playerID": "p2", "injury": {"designation": ""}},
		{"playerID": "p3"}]}]`))
	if err != nil {
		t.Fatal(err)
	}
	if len(codes) != 1 || codes["p1"] != (captured{code: "O", note: "Out for the season (knee)"}) {
		t.Fatalf("codes %v: the sweep's designation with its note", codes)
	}
	if _, err := parseCapture(injuriesByDate, []byte(`[1, 2]`)); err == nil {
		t.Fatal("a by-date capture that is not an object reads")
	}
}

// A season-long designation is dated by the first capture of his
// unbroken run under that status (IR and IR-R are one status); a run that
// reaches the oldest capture in the window has no date, and a week's
// designation never carries one. A capture that does not read breaks no
// run.
func TestDesignationSince(t *testing.T) {
	pool := dbtest.Pool(t)
	ctx := context.Background()
	const schema = "weekfacts_since_test"
	for _, q := range []string{
		`drop schema if exists ` + schema + ` cascade`, `create schema ` + schema,
		`create table ` + schema + `.capture_snapshots (source text, payload jsonb, captured_at timestamptz)`,
		`insert into ` + schema + `.capture_snapshots values
			('tank01_injuries_by_date', '{"injList": [{"playerID": "p5", "designation": "Q"}]}', '2026-07-01 10:00:00+00'),
			('tank01_injuries_by_date', '{"injList": [{"playerID": "p1", "designation": "Q"}, {"playerID": "p5", "designation": "IR"}]}', '2026-10-13 10:00:00+00'),
			('tank01_injuries_by_date', '{"injList": [{"playerID": "p1", "designation": "IR"}, {"playerID": "p2", "designation": "IR"}, {"playerID": "p5", "designation": "IR"}]}', '2026-10-13 11:00:00+00'),
			('tank01_injuries_by_date', '{"injList": [{"playerID": "p1", "designation": "IR"}, {"playerID": "p2", "designation": "IR"}, {"playerID": "p3", "designation": "PUP"}, {"playerID": "p5", "designation": "IR"}]}', '2026-10-13 12:00:00+00'),
			('tank01_injuries_by_date', '[1, 2]', '2026-10-13 13:00:00+00'),
			('tank01_injuries_by_date', '{"injList": [{"playerID": "p9", "designation": "Q"}]}', '2026-10-13 13:30:00+00'),
			('tank01_injuries_by_date', '{"injList": [{"playerID": "p1", "designation": "IR-R"}, {"playerID": "p2", "designation": "ir"}, {"playerID": "p3", "designation": "PUP"}, {"playerID": "p4", "designation": "O"}, {"playerID": "p5", "designation": "IR"}]}', '2026-10-13 14:00:00+00')`,
	} {
		if _, err := pool.Exec(ctx, q); err != nil {
			t.Fatal(err)
		}
	}
	t.Cleanup(func() { _, _ = pool.Exec(context.Background(), `drop schema if exists `+schema+` cascade`) })
	src, _ := NewPGSource(pool, schema, 2026, "")
	undated, err := src.Designations(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if undated["p1"].Since != nil {
		t.Fatal("the in-season screens' read dates a run")
	}
	runs, err := src.SeasonRuns(ctx, Newest(undated))
	if err != nil {
		t.Fatal(err)
	}
	d := WithSince(undated, runs)
	at := func(hour int) *time.Time {
		v := time.Date(2026, 10, 13, hour, 0, 0, 0, time.UTC)
		return &v
	}
	// p5's run reaches July's capture, outside the window: no date.
	for id, want := range map[string]*time.Time{"p1": at(11), "p2": at(11), "p3": at(12), "p4": nil, "p5": nil} {
		got := d[id]
		if got.Source != injuriesByDate || !got.AsOf.Equal(*at(14)) {
			t.Errorf("%s: %+v, want the newest by-date capture's stamp and source", id, got)
		}
		if (got.Since == nil) != (want == nil) || (want != nil && !got.Since.Equal(*want)) {
			t.Errorf("%s since %v, want %v", id, got.Since, want)
		}
	}
}

// A list that is empty or under half the one before it is a glitch: the
// read takes the newest list that is not, and a real drop reads once a
// second short list follows it. A designation the newest list no longer
// names is gone. The capture job's last check rides on every designation,
// and a by-date out takes a nearby roster sweep's note.
func TestDesignationFloorChecksAndNotes(t *testing.T) {
	pool := dbtest.Pool(t)
	ctx := context.Background()
	const schema = "weekfacts_floor_test"
	full := `{"injList": [{"playerID": "p1", "designation": "IR"}, {"playerID": "p2", "designation": "O"}, {"playerID": "p3", "designation": "Q"}, {"playerID": "p4", "designation": "Q"}]}`
	for _, q := range []string{
		`drop schema if exists ` + schema + ` cascade`, `create schema ` + schema,
		`create table ` + schema + `.capture_snapshots (source text, payload jsonb, captured_at timestamptz)`,
		`insert into ` + schema + `.capture_snapshots values
			('tank01_injuries_by_date', '` + full + `', '2026-10-13 10:00:00+00'),
			('tank01_injuries_by_date', '{"injList": []}', '2026-10-13 11:00:00+00'),
			('tank01_injuries_by_date', '{"injList": [{"playerID": "p3", "designation": "Q"}]}', '2026-10-13 12:00:00+00'),
			('tank01_injuries', '[{"roster": [{"playerID": "p2", "injury": {"designation": "O", "description": "Out for the season (knee)"}}]}]', '2026-10-12 20:00:00+00')`,
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
	if len(d) != 4 || !d["p1"].AsOf.Equal(time.Date(2026, 10, 13, 10, 0, 0, 0, time.UTC)) || d["p1"].CheckedAt != nil {
		t.Fatalf("designations %+v: the empty 11:00 list and the cut-short 12:00 one give way to 10:00's, with no check recorded", d)
	}
	if !d["p2"].SeasonLong() || d["p2"].Note != "Out for the season (knee)" {
		t.Fatalf("p2 %+v: the sweep's note makes his out season-long", d["p2"])
	}
	// The list really drops to one: a second short list reads, and p1's
	// injured reserve is gone.
	for _, q := range []string{
		`insert into ` + schema + `.capture_snapshots values
			('tank01_injuries_by_date', '{"injList": [{"playerID": "p3", "designation": "D"}]}', '2026-10-13 13:00:00+00')`,
		`create table ` + schema + `.capture_checks (source text primary key, checked_at timestamptz)`,
		`insert into ` + schema + `.capture_checks values ('tank01_injuries_by_date', '2026-10-13 15:00:00+00')`,
	} {
		if _, err := pool.Exec(ctx, q); err != nil {
			t.Fatal(err)
		}
	}
	d, err = src.Designations(ctx)
	checked := time.Date(2026, 10, 13, 15, 0, 0, 0, time.UTC)
	if err != nil || len(d) != 1 || d["p3"].Code != "D" || d["p3"].CheckedAt == nil || !d["p3"].CheckedAt.Equal(checked) {
		t.Fatalf("designations %+v (%v): the second short list, with the last check", d, err)
	}
	if _, listed := d["p1"]; listed {
		t.Fatal("a lapsed injured reserve still shows")
	}
	// The 16:00 pass returns an empty list, which the floor refuses: the
	// 13:00 list shows, and the 16:00 check never vouches for it.
	for _, q := range []string{
		`insert into ` + schema + `.capture_snapshots values ('tank01_injuries_by_date', '{"injList": []}', '2026-10-13 16:00:00+00')`,
		`update ` + schema + `.capture_checks set checked_at = '2026-10-13 16:00:00+00'`,
	} {
		if _, err := pool.Exec(ctx, q); err != nil {
			t.Fatal(err)
		}
	}
	d, err = src.Designations(ctx)
	if err != nil || d["p3"].Code != "D" || d["p3"].CheckedAt != nil {
		t.Fatalf("designations %+v (%v): the older list shown, with no check named", d, err)
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
