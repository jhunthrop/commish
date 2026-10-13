package db_test

import (
	"context"
	"io"
	"io/fs"
	"log/slog"
	"strings"
	"testing"

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
}
