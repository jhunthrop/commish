package config

import (
	"errors"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
)

// cloudSQLSocketDir is where Cloud Run mounts the instance's Unix socket
// for --add-cloudsql-instances: a directory whose name holds colons.
const cloudSQLSocketDir = "/cloudsql/trycommish:us-east1:commish-pg"

const (
	socketURL = "postgres://commish_app:s3cr%40t@/commish?host=" + cloudSQLSocketDir
	// prodURL is the exact shape of Secret Manager DATABASE_URL.
	prodURL = socketURL + "&sslmode=disable"
	tcpURL  = "postgres://commish:commish@localhost:5433/commish_test?sslmode=disable"
)

func env(vars map[string]string) Getenv {
	return func(name string) string { return vars[name] }
}

// Production's form: no host in the authority, the socket directory in
// the host parameter. Dev and CI keep the TCP form.
func TestDatabaseURLAcceptsTheSocketAndTCPForms(t *testing.T) {
	for _, raw := range []string{socketURL, prodURL, tcpURL, "postgresql://u:p@/commish?host=/var/run/postgresql"} {
		d, err := LoadMigrate(env(map[string]string{"DATABASE_URL": raw}))
		if err != nil {
			t.Fatalf("%q refused: %v", raw, err)
		}
		if d.URL != raw || d.MigrateURL != raw {
			t.Fatalf("%q came back as %+v", raw, d)
		}
	}
}

func TestDatabaseURLRefusesNoHostAtAll(t *testing.T) {
	for _, raw := range []string{
		"postgres:///commish",
		"postgres://u:p@/commish?host=",
		"postgres://u:p@/commish?host=cloudsql/relative",
		"mysql://u:p@/commish?host=/cloudsql/x",
	} {
		_, err := LoadMigrate(env(map[string]string{"DATABASE_URL": raw}))
		if !errors.Is(err, ErrInvalid) {
			t.Fatalf("%q accepted (err %v)", raw, err)
		}
	}
}

// pgx reads the host parameter as the socket directory, colons and all,
// on the default port, with no TLS (libpq's rule for a Unix socket), so
// it dials <dir>/.s.PGSQL.5432.
func TestPgxParsesTheSocketForm(t *testing.T) {
	for _, raw := range []string{socketURL, prodURL} {
		cfg, err := pgxpool.ParseConfig(raw)
		if err != nil {
			t.Fatalf("%q: %v", raw, err)
		}
		c := cfg.ConnConfig
		if c.Host != cloudSQLSocketDir || c.Port != 5432 || c.Database != "commish" || c.User != "commish_app" || c.Password != "s3cr@t" {
			t.Fatalf("%q parsed %q:%d db %q user %q", raw, c.Host, c.Port, c.Database, c.User)
		}
		if c.TLSConfig != nil || len(c.Fallbacks) != 0 {
			t.Fatalf("%q carries TLS or fallbacks: %v, %d", raw, c.TLSConfig != nil, len(c.Fallbacks))
		}
	}
}

// The room's LISTEN connection is the same URL on Cloud SQL: there is no
// pooler to step around.
func TestDirectURLLeavesTheSocketFormAlone(t *testing.T) {
	if got := DirectURL(socketURL); got != socketURL {
		t.Fatalf("got %q", got)
	}
}
