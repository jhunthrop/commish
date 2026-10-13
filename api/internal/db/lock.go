package db

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// WithLock runs fn holding a Postgres advisory lock on key, so one
// caller at a time across every instance does the work.
//
// The lock sits on its own connection outside the pool, because fn's
// own writes use the pool and a lock holder must never compete with its
// own work for a pooled connection (the hang foreversixty hit on
// 2026-09-21). It is a transaction-level lock inside an open
// transaction, not a session lock: Neon's pooler runs PgBouncer in
// transaction mode, where a session lock and its unlock can land on two
// different server connections and the lock leaks. A transaction pins
// one server connection until it ends, and the lock ends with it, on
// commit, rollback or a dropped connection alike.
func WithLock(ctx context.Context, pool *pgxpool.Pool, key string, fn func(context.Context) error) error {
	conn, err := pgx.ConnectConfig(ctx, pool.Config().ConnConfig)
	if err != nil {
		return fmt.Errorf("db: lock %s: connect: %w", key, err)
	}
	defer func() { _ = conn.Close(context.WithoutCancel(ctx)) }()
	tx, err := conn.Begin(ctx)
	if err != nil {
		return fmt.Errorf("db: lock %s: begin: %w", key, err)
	}
	defer func() { _ = tx.Rollback(context.WithoutCancel(ctx)) }()
	if _, err := tx.Exec(ctx, `select pg_advisory_xact_lock(hashtext($1))`, key); err != nil {
		return fmt.Errorf("db: lock %s: %w", key, err)
	}
	if err := fn(ctx); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("db: lock %s: release: %w", key, err)
	}
	return nil
}
