// Package db opens the Postgres pool and applies the app schema's
// migrations. Migrations never run at container start: cmd/migrate runs
// them from the deploy workflow before the new revision takes traffic.
package db

import (
	"context"
	"database/sql"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/jackc/pgx/v5/stdlib"
	"github.com/pressly/goose/v3"

	"github.com/jhunthrop/commish/api/migrations"
)

// Schema is the one schema this module owns. The research schema
// belongs to the TypeScript core and is never named here.
const Schema = "app"

// versionTable keeps goose's bookkeeping inside the app schema, so the
// two lanes sharing one database never see each other's history.
const versionTable = Schema + ".goose_db_version"

// Pool settings for a Cloud Run instance at concurrency 80 against
// Neon's pooler: enough connections for a burst, few enough that a
// scaled-out service stays far under the pooler's limit.
const (
	maxConns          = 10
	maxConnIdleTime   = 5 * time.Minute
	healthCheckPeriod = time.Minute
)

// Open builds the pool without dialling, so a cold Neon compute does
// not crash a starting container: readiness pings it instead.
func Open(url string) (*pgxpool.Pool, error) {
	cfg, err := pgxpool.ParseConfig(url)
	if err != nil {
		return nil, fmt.Errorf("db: parse url: %w", err)
	}
	// Neon's pooler runs PgBouncer in transaction mode, where a named
	// prepared statement outlives the server connection it was made on.
	// Describe-and-cache sends every statement unnamed. The URL may
	// still override it.
	if !strings.Contains(url, "default_query_exec_mode=") {
		cfg.ConnConfig.DefaultQueryExecMode = pgx.QueryExecModeCacheDescribe
	}
	cfg.MaxConns = maxConns
	cfg.MaxConnIdleTime = maxConnIdleTime
	cfg.HealthCheckPeriod = healthCheckPeriod
	pool, err := pgxpool.NewWithConfig(context.Background(), cfg)
	if err != nil {
		return nil, fmt.Errorf("db: open pool: %w", err)
	}
	return pool, nil
}

// Connect opens the pool and proves it with a ping, for the commands
// that cannot do anything useful without the database (the jobs).
func Connect(ctx context.Context, url string) (*pgxpool.Pool, error) {
	pool, err := Open(url)
	if err != nil {
		return nil, err
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("db: ping: %w", err)
	}
	return pool, nil
}

// Migrate applies every pending migration in migrations.FS and reports
// what it applied. The app schema is created first, because goose keeps
// its version table in it.
func Migrate(ctx context.Context, url string, log *slog.Logger) ([]int64, error) {
	cfg, err := pgx.ParseConfig(url)
	if err != nil {
		return nil, fmt.Errorf("db: migrate: parse url: %w", err)
	}
	sqlDB := stdlib.OpenDB(*cfg)
	defer func() { _ = sqlDB.Close() }()
	if err := bootstrap(ctx, sqlDB); err != nil {
		return nil, err
	}
	provider, err := goose.NewProvider(goose.DialectPostgres, sqlDB, migrations.FS,
		goose.WithTableName(versionTable), goose.WithSlog(log), goose.WithDisableGlobalRegistry(true))
	if err != nil {
		return nil, fmt.Errorf("db: migrate: provider: %w", err)
	}
	results, err := provider.Up(ctx)
	if err != nil {
		return nil, fmt.Errorf("db: migrate up: %w", err)
	}
	applied := make([]int64, 0, len(results))
	for _, r := range results {
		applied = append(applied, r.Source.Version)
	}
	return applied, nil
}

func bootstrap(ctx context.Context, sqlDB *sql.DB) error {
	if _, err := sqlDB.ExecContext(ctx, "create schema if not exists "+Schema); err != nil {
		return fmt.Errorf("db: create schema %s: %w", Schema, err)
	}
	return nil
}
