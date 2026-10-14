package db_test

import (
	"context"
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
}

// 00018: a custom scoring saved as the old free map becomes the 21
// ScoringRules, its own figures kept under either name, the rest at the
// standard figure, and a saved league's settings move to version 2.
func scoringRulesMigration(ctx context.Context, t *testing.T, url string, pool *pgxpool.Pool) {
	t.Helper()
	cfg, err := pgx.ParseConfig(url)
	if err != nil {
		t.Fatal(err)
	}
	sqlDB := stdlib.OpenDB(*cfg)
	defer func() { _ = sqlDB.Close() }()
	provider, err := goose.NewProvider(goose.DialectPostgres, sqlDB, migrations.FS,
		goose.WithTableName("app.goose_db_version"), goose.WithDisableGlobalRegistry(true))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := provider.DownTo(ctx, 17); err != nil {
		t.Fatalf("down to 17: %v", err)
	}
	var league string
	if err := pool.QueryRow(ctx, `with a as (insert into app.accounts (workos_user_id, email) values ('user_00018', 'a@b.c') returning id)
		insert into app.leagues (account_id, name, settings) select id, 'Old custom',
		'{"scoring": {"preset": null, "custom": {"rec": 0.5, "pass_td": 6, "points_per_safety": 3, "rush_2pt": 1}}, "teams": 12}'::jsonb
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
	}
	for k, v := range want {
		if rules[k] != v {
			t.Errorf("%s = %g, want %g", k, rules[k], v)
		}
	}
	if len(rules) != 21 || version != 2 {
		t.Errorf("%d rules at version %d, want the 21 at version 2", len(rules), version)
	}
}
