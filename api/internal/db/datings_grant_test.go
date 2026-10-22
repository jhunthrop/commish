package db_test

import (
	"context"
	"io/fs"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"

	"github.com/jhunthrop/commish/api/internal/db/dbtest"
	"github.com/jhunthrop/commish/api/migrations"
)

// The capture jobs' role and the grant 00030 keeps for it (Lane 141, B116).
const (
	researchRole        = "commish_research"
	datingsGrantFile    = "00030_designation_datings_grant.sql"
	datingsTable        = "app.designation_datings"
	gooseDownAnnotation = "-- +goose Down"
)

// datingsGrantSteps is 00030's Up and Down bodies.
func datingsGrantSteps(t *testing.T) (up, down string) {
	t.Helper()
	body, err := fs.ReadFile(migrations.FS, datingsGrantFile)
	if err != nil {
		t.Fatal(err)
	}
	up, down, found := strings.Cut(string(body), gooseDownAnnotation)
	if !found {
		t.Fatalf("%s has no Down", datingsGrantFile)
	}
	return up, down
}

// datingsPrivileges is the role's privileges on the table and the schema,
// by name.
func datingsPrivileges(ctx context.Context, t *testing.T, tx pgx.Tx) map[string]bool {
	t.Helper()
	held := map[string]bool{}
	for _, privilege := range []string{"select", "insert", "delete", "update"} {
		var ok bool
		if err := tx.QueryRow(ctx, `select has_table_privilege($1, $2, $3)`,
			researchRole, datingsTable, privilege).Scan(&ok); err != nil {
			t.Fatal(err)
		}
		held[privilege] = ok
	}
	var usage bool
	if err := tx.QueryRow(ctx, `select has_schema_privilege($1, 'app', 'usage')`, researchRole).Scan(&usage); err != nil {
		t.Fatal(err)
	}
	held["usage"] = usage
	return held
}

// 00030 grants the capture jobs' role exactly what the dating write needs
// where the role exists, twice as once, and its Down takes it back. A role
// is transactional, so the test makes one where the cluster has none and
// rolls it back with everything else: nothing outlives the test.
func TestTheDatingsGrantIsKeptInAMigration(t *testing.T) {
	ctx := context.Background()
	pool := dbtest.Pool(t)
	up, down := datingsGrantSteps(t)
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	var exists bool
	if err := tx.QueryRow(ctx, `select exists (select 1 from pg_roles where rolname = $1)`, researchRole).Scan(&exists); err != nil {
		t.Fatal(err)
	}
	if !exists {
		if _, err := tx.Exec(ctx, "create role "+researchRole+" nologin"); err != nil {
			t.Fatalf("create the role: %v", err)
		}
	}
	for range 2 {
		if _, err := tx.Exec(ctx, up); err != nil {
			t.Fatalf("up: %v", err)
		}
	}
	want := map[string]bool{"select": true, "insert": true, "delete": true, "update": false, "usage": true}
	for privilege, held := range datingsPrivileges(ctx, t, tx) {
		if held != want[privilege] {
			t.Errorf("after up, %s holds %s: %v, want %v", researchRole, privilege, held, want[privilege])
		}
	}
	if _, err := tx.Exec(ctx, down); err != nil {
		t.Fatalf("down: %v", err)
	}
	for privilege, held := range datingsPrivileges(ctx, t, tx) {
		if held {
			t.Errorf("after down, %s still holds %s", researchRole, privilege)
		}
	}
}
