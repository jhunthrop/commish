// Package dbtest gives a database-backed test a freshly migrated app
// schema on TEST_DATABASE_URL. Packages share one database, which is why
// CI runs `go test -p 1`.
package dbtest

import (
	"context"
	"io"
	"log/slog"
	"os"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/jhunthrop/commish/api/internal/db"
)

// EnvURL names the test database. CI sets it to the Postgres 16 service
// on 5433; a laptop sets it to any scratch database.
const EnvURL = "TEST_DATABASE_URL"

// URL returns the test database, skipping the test when none is set
// locally and failing it in CI, where a skip would be a false green.
func URL(t *testing.T) string {
	t.Helper()
	url := os.Getenv(EnvURL)
	if url == "" {
		if os.Getenv("CI") != "" {
			t.Fatalf("%s is not set in CI", EnvURL)
		}
		t.Skipf("%s is not set", EnvURL)
	}
	return url
}

// Reset drops the app schema and migrates it from nothing.
func Reset(t *testing.T, url string) []int64 {
	t.Helper()
	ctx := context.Background()
	pool, err := db.Connect(ctx, url)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	if _, err := pool.Exec(ctx, "drop schema if exists "+db.Schema+" cascade"); err != nil {
		t.Fatalf("drop schema: %v", err)
	}
	pool.Close()
	applied, err := db.Migrate(ctx, url, slog.New(slog.NewTextHandler(io.Discard, nil)))
	if err != nil {
		t.Fatalf("migrate: %v", err)
	}
	return applied
}

// Pool resets the schema and returns a pool closed at the test's end.
func Pool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	url := URL(t)
	Reset(t, url)
	pool, err := db.Connect(context.Background(), url)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	t.Cleanup(pool.Close)
	return pool
}
