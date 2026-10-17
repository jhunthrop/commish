package db_test

import (
	"context"
	"encoding/json"
	"io"
	"io/fs"
	"log/slog"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/jackc/pgx/v5/stdlib"
	"github.com/pressly/goose/v3"

	"github.com/jhunthrop/commish/api/internal/db"
	"github.com/jhunthrop/commish/api/internal/db/dbtest"
	"github.com/jhunthrop/commish/api/internal/scoring"
	"github.com/jhunthrop/commish/api/migrations"
)

// The boundary this package owns: every migration applies cleanly to an
// empty database, a second run applies nothing, every table the spec
// names exists in the app schema, and no migration names the research
// schema.
func TestMigrationsApplyCleanly(t *testing.T) {
	url := dbtest.URL(t)
	applied := dbtest.Reset(t, url)

	files, err := fs.Glob(migrations.FS, "*.sql")
	if err != nil {
		t.Fatal(err)
	}
	if len(applied) != len(files) {
		t.Fatalf("applied %d migrations, have %d files", len(applied), len(files))
	}
	for _, name := range files {
		body, err := fs.ReadFile(migrations.FS, name)
		if err != nil {
			t.Fatal(err)
		}
		if strings.Contains(strings.ToLower(string(body)), "research.") {
			t.Errorf("%s names the research schema", name)
		}
	}

	ctx := context.Background()
	again, err := db.Migrate(ctx, url, slog.New(slog.NewTextHandler(io.Discard, nil)))
	if err != nil {
		t.Fatalf("second migrate: %v", err)
	}
	if len(again) != 0 {
		t.Fatalf("second migrate applied %v, want nothing", again)
	}

	pool, err := db.Connect(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	for _, table := range []string{
		"accounts", "sessions", "leagues", "sheets", "sheet_rows", "mocks", "mock_actions",
		"rooms", "room_actions", "entitlements", "billing_events", "exports", "lobby_picks",
	} {
		var ok bool
		if err := pool.QueryRow(ctx,
			`select exists (select 1 from pg_tables where schemaname = $1 and tablename = $2)`,
			db.Schema, table).Scan(&ok); err != nil {
			t.Fatal(err)
		}
		if !ok {
			t.Errorf("table %s.%s is missing", db.Schema, table)
		}
	}

	// 00014: the companion keeps the username a seat was found by, each
	// slot's name and the draft's own name, the username held to Sleeper's
	// own pattern and the name to 80 characters.
	for _, column := range []string{"host_username", "seat_names", "draft_name"} {
		var ok bool
		if err := pool.QueryRow(ctx, `select exists (select 1 from information_schema.columns
			where table_schema = $1 and table_name = 'companions' and column_name = $2)`, db.Schema, column).Scan(&ok); err != nil {
			t.Fatal(err)
		}
		if !ok {
			t.Errorf("app.companions.%s is missing", column)
		}
	}
	var checked bool
	if err := pool.QueryRow(ctx, `select exists (select 1 from pg_constraint
		where conrelid = 'app.companions'::regclass and pg_get_constraintdef(oid) like '%host_username%')`).Scan(&checked); err != nil {
		t.Fatal(err)
	}
	if !checked {
		t.Error("app.companions.host_username has no check")
	}
	var nameChecked bool
	if err := pool.QueryRow(ctx, `select exists (select 1 from pg_constraint
		where conrelid = 'app.companions'::regclass and pg_get_constraintdef(oid) like '%char_length(draft_name)%')`).Scan(&nameChecked); err != nil {
		t.Fatal(err)
	}
	if !nameChecked {
		t.Error("app.companions.draft_name has no length check")
	}
	scoringRulesMigration(ctx, t, url, pool)
	ffpcMemberReadsMigration(ctx, t, url, pool)
	kickDefenseRulesMigration(ctx, t, url, pool)
}

// gooseProvider runs the app's migrations one by one on the test database.
func gooseProvider(t *testing.T, url string) *goose.Provider {
	t.Helper()
	cfg, err := pgx.ParseConfig(url)
	if err != nil {
		t.Fatal(err)
	}
	sqlDB := stdlib.OpenDB(*cfg)
	t.Cleanup(func() { _ = sqlDB.Close() })
	provider, err := goose.NewProvider(goose.DialectPostgres, sqlDB, migrations.FS,
		goose.WithTableName("app.goose_db_version"), goose.WithDisableGlobalRegistry(true))
	if err != nil {
		t.Fatal(err)
	}
	return provider
}

// 00023: every FFPC attachment is read as the member who attached it
// (each was attached with that member's own sign-in), whether or not they
// hold an FFPC connection today, and the shared FFPC reads, each made as
// whichever member read last, are dropped.
func ffpcMemberReadsMigration(ctx context.Context, t *testing.T, url string, pool *pgxpool.Pool) {
	t.Helper()
	provider := gooseProvider(t, url)
	if _, err := provider.DownTo(ctx, 22); err != nil {
		t.Fatalf("down to 22: %v", err)
	}
	var connected, unconnected string
	for _, who := range []struct {
		name string
		into *string
	}{{"connected", &connected}, {"unconnected", &unconnected}} {
		if err := pool.QueryRow(ctx, `insert into app.accounts (workos_user_id, email) values ($1, $1 || '@example.invalid') returning id`,
			"user_00023_"+who.name).Scan(who.into); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := pool.Exec(ctx, `insert into app.host_connections
		(account_id, host, wrapped_key, session_ct, signin_ct, key_version, consented_at, consent_version)
		values ($1, 'ffpc', decode(repeat('00', 40), 'hex'), decode(repeat('00', 16), 'hex'), decode(repeat('00', 16), 'hex'), 1, now(), 3)`,
		connected); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `insert into app.league_links (account_id, host, host_league_id, host_season, roster_id, host_team_key)
		values ($1, 'ffpc', '104870', 2026, 11, 'F3C-781497793F8E'), ($2, 'ffpc', '104870', 2026, 3, 'F3C-0000000000B0'),
			($1, 'sleeper', '1180000000000000000', 0, 2, null)`, connected, unconnected); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `insert into app.league_snapshots (host, host_league_id, host_season, snapshot, read_at)
		values ('ffpc', '104870', 2026, '{}', now()), ('sleeper', '1180000000000000000', 0, '{}', now())`); err != nil {
		t.Fatal(err)
	}
	if _, err := provider.Up(ctx); err != nil {
		t.Fatalf("up again: %v", err)
	}
	var ffpcMember, ffpcShared, sleeperMember, sleeperShared int
	if err := pool.QueryRow(ctx, `select
		(select count(*) from app.league_links where host = 'ffpc' and read_as_member),
		(select count(*) from app.league_snapshots where host = 'ffpc'),
		(select count(*) from app.league_links where host = 'sleeper' and read_as_member),
		(select count(*) from app.league_snapshots where host = 'sleeper')`).Scan(&ffpcMember, &ffpcShared, &sleeperMember, &sleeperShared); err != nil {
		t.Fatal(err)
	}
	if ffpcMember != 2 || ffpcShared != 0 || sleeperMember != 0 || sleeperShared != 1 {
		t.Fatalf("ffpc: %d member links, %d shared reads; sleeper: %d member links, %d reads", ffpcMember, ffpcShared, sleeperMember, sleeperShared)
	}
}

// 00019: a custom scoring saved as the old free map becomes the 21
// ScoringRules, its own figures kept under either name, the rest at the
// standard figure, and a saved league's settings move to version 2.
func scoringRulesMigration(ctx context.Context, t *testing.T, url string, pool *pgxpool.Pool) {
	t.Helper()
	provider := gooseProvider(t, url)
	if _, err := provider.DownTo(ctx, 18); err != nil {
		t.Fatalf("down to 18: %v", err)
	}
	var league string
	if err := pool.QueryRow(ctx, `with a as (insert into app.accounts (workos_user_id, email) values ('user_00019', 'a@b.c') returning id)
		insert into app.leagues (account_id, name, settings) select id, 'Old custom',
		'{"scoring": {"preset": null, "custom": {"rec": 0.5, "pass_td": 6, "points_per_safety": 3, "rush_2pt": 1, "kr_td": 4, "pr_td": 8}}, "teams": 12}'::jsonb
		from a returning id`).Scan(&league); err != nil {
		t.Fatal(err)
	}
	if _, err := provider.Up(ctx); err != nil {
		t.Fatalf("up again: %v", err)
	}
	var rules map[string]float64
	var version int
	if err := pool.QueryRow(ctx, `select settings->'scoring'->'custom', settings_version from app.leagues where id = $1`, league).
		Scan(&rules, &version); err != nil {
		t.Fatal(err)
	}
	want := map[string]float64{
		"points_per_reception": 0.5, "points_per_passing_touchdown": 6, "points_per_safety": 3,
		"points_per_two_point_conversion": 1, "points_per_passing_yard": 0.04, "te_reception_bonus": 0,
		// Kick and punt returns scored differently are not one figure: the standard one stands.
		"points_per_return_touchdown": 6,
	}
	for k, v := range want {
		if rules[k] != v {
			t.Errorf("%s = %g, want %g", k, rules[k], v)
		}
	}
	if len(rules) != len(scoring.Rules()) || version != 2 {
		t.Errorf("%d rules at version %d, want the %d at version 2", len(rules), version, len(scoring.Rules()))
	}
}

// 00025: a custom scoring stored before gains the longer field goals at
// its own field goal figure and the tiers at the standard figures, and so
// do the rules of a league's last host read; down takes them away again.
func kickDefenseRulesMigration(ctx context.Context, t *testing.T, url string, pool *pgxpool.Pool) {
	t.Helper()
	provider := gooseProvider(t, url)
	if _, err := provider.DownTo(ctx, 24); err != nil {
		t.Fatalf("down to 24: %v", err)
	}
	board := scoring.BoardRules(scoring.Standard())
	board[scoring.FieldGoal] = 3.5
	custom, err := json.Marshal(map[string]any{"scoring": map[string]any{"preset": nil, "custom": board}, "teams": 12})
	if err != nil {
		t.Fatal(err)
	}
	snapshot, err := json.Marshal(map[string]any{"scoring": map[string]any{"rules": board}})
	if err != nil {
		t.Fatal(err)
	}
	var league string
	if err := pool.QueryRow(ctx, `with a as (insert into app.accounts (workos_user_id, email) values ('user_00025', 'k@d.c') returning id)
		insert into app.leagues (account_id, name, settings) select id, 'Kicking', $1::jsonb from a returning id`, custom).Scan(&league); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `insert into app.league_snapshots (host, host_league_id, host_season, snapshot, read_at)
		values ('sleeper', '2500', 2026, $1::jsonb, now())`, snapshot); err != nil {
		t.Fatal(err)
	}
	if _, err := provider.Up(ctx); err != nil {
		t.Fatalf("up again: %v", err)
	}
	read := func(query string) map[string]float64 {
		var rules map[string]float64
		if err := pool.QueryRow(ctx, query).Scan(&rules); err != nil {
			t.Fatal(err)
		}
		return rules
	}
	leagueQuery := `select settings->'scoring'->'custom' from app.leagues where id = '` + league + `'`
	snapQuery := `select snapshot->'scoring'->'rules' from app.league_snapshots where host_league_id = '2500'`
	for name, rules := range map[string]map[string]float64{"league": read(leagueQuery), "snapshot": read(snapQuery)} {
		r, err := scoring.FromMap(rules)
		if err != nil {
			t.Fatalf("%s: %v", name, err)
		}
		if r.PointsPerFieldGoal != 3.5 || r.PointsPerFieldGoal4049 != 3.5 || r.PointsPerFieldGoal50Plus != 3.5 ||
			r.PointsAllowed0 != 5 || r.PointsAllowed46Plus != -5 || r.YardsAllowed099 != 5 || r.YardsAllowed550Plus != -7 {
			t.Errorf("%s: %+v", name, r)
		}
	}
	if _, err := provider.DownTo(ctx, 24); err != nil {
		t.Fatalf("down to 24 again: %v", err)
	}
	if got := read(leagueQuery); len(got) != len(board) {
		t.Errorf("down left %d rules, want the %d", len(got), len(board))
	}
	if _, err := provider.Up(ctx); err != nil {
		t.Fatalf("up at last: %v", err)
	}
}
