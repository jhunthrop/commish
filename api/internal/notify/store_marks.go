package notify

import (
	"context"
	"fmt"
	"time"
)

// The producers with a mark (app.notify_marks' check).
const markStarterStatus = "starter_status"

// RequestRun records that a producer was asked to run at at.
func (s *Store) RequestRun(ctx context.Context, producer string, at time.Time) error {
	_, err := s.Pool.Exec(ctx, `insert into app.notify_marks (producer, requested_at) values ($1, $2)
		on conflict (producer) do update set requested_at = excluded.requested_at`, producer, at)
	if err != nil {
		return fmt.Errorf("notify: request %s: %w", producer, err)
	}
	return nil
}

// RunExclusive runs fn while this process holds the producer's advisory
// lock, so one instance runs it at a time, and records when it finished
// and the newest input it finished through. ran is false when another
// instance holds the lock.
func (s *Store) RunExclusive(ctx context.Context, producer string, fn func(context.Context) (time.Time, error)) (ran bool, err error) {
	conn, err := s.Pool.Acquire(ctx)
	if err != nil {
		return false, fmt.Errorf("notify: lock %s: %w", producer, err)
	}
	defer conn.Release()
	lockKey := "notify:" + producer
	if err := conn.QueryRow(ctx, `select pg_try_advisory_lock(hashtext($1))`, lockKey).Scan(&ran); err != nil || !ran {
		return false, err
	}
	defer func() {
		// The lock is the session's: release it on a fresh context, the
		// run's may be done.
		unlockCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if _, uerr := conn.Exec(unlockCtx, `select pg_advisory_unlock(hashtext($1))`, lockKey); uerr != nil {
			// A closed session drops its locks.
			_ = conn.Conn().Close(unlockCtx)
		}
	}()
	through, err := fn(ctx)
	if err != nil {
		return true, err
	}
	var at any
	if !through.IsZero() {
		at = through
	}
	_, err = conn.Exec(ctx, `insert into app.notify_marks (producer, finished_at, done_through) values ($1, now(), $2)
		on conflict (producer) do update set finished_at = now(),
			done_through = greatest(app.notify_marks.done_through, excluded.done_through)`, producer, at)
	if err != nil {
		return true, fmt.Errorf("notify: finish %s: %w", producer, err)
	}
	return true, nil
}
