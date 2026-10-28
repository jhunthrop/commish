package notify

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/jhunthrop/commish/api/internal/db"
)

// The producers with a mark (app.notify_marks' check).
const markStarterStatus = "starter_status"

// notifyLockKey is the advisory lock one notify run holds, so one process
// at a time catches up the producer and drains.
const notifyLockKey = "notify:run"

// Mark is a producer's mark: when it was last asked to run, when its last
// run began, and the newest input it has finished through. A field never
// written is zero.
type Mark struct {
	RequestedAt time.Time
	StartedAt   time.Time
	DoneThrough time.Time
}

// RequestRun records that a producer was asked to run at at.
func (s *Store) RequestRun(ctx context.Context, producer string, at time.Time) error {
	_, err := s.Pool.Exec(ctx, `insert into app.notify_marks (producer, requested_at) values ($1, $2)
		on conflict (producer) do update set requested_at = greatest(app.notify_marks.requested_at, excluded.requested_at)`,
		producer, at)
	if err != nil {
		return fmt.Errorf("notify: request %s: %w", producer, err)
	}
	return nil
}

// MarkOf is the producer's mark, zero when it has none.
func (s *Store) MarkOf(ctx context.Context, producer string) (Mark, error) {
	var requested, started, through *time.Time
	err := s.Pool.QueryRow(ctx, `select requested_at, started_at, done_through from app.notify_marks where producer = $1`,
		producer).Scan(&requested, &started, &through)
	if errors.Is(err, pgx.ErrNoRows) {
		return Mark{}, nil
	}
	if err != nil {
		return Mark{}, fmt.Errorf("notify: mark %s: %w", producer, err)
	}
	var m Mark
	for dst, src := range map[*time.Time]*time.Time{&m.RequestedAt: requested, &m.StartedAt: started, &m.DoneThrough: through} {
		if src != nil {
			*dst = src.UTC()
		}
	}
	return m, nil
}

// Finish records a run that began at started and finished through
// through: a request after started is a run still owed.
func (s *Store) Finish(ctx context.Context, producer string, started, through time.Time) error {
	var at any
	if !through.IsZero() {
		at = through
	}
	_, err := s.Pool.Exec(ctx, `insert into app.notify_marks (producer, started_at, done_through) values ($1, $2, $3)
		on conflict (producer) do update set started_at = excluded.started_at,
			done_through = greatest(app.notify_marks.done_through, excluded.done_through)`, producer, started, at)
	if err != nil {
		return fmt.Errorf("notify: finish %s: %w", producer, err)
	}
	return nil
}

// Exclusive runs fn while this process holds the notify run's lock (a
// transaction-level lock on its own connection, db.TryWithLock); ran is
// false when another process holds it.
func (s *Store) Exclusive(ctx context.Context, fn func(context.Context) error) (bool, error) {
	return db.TryWithLock(ctx, s.Pool, notifyLockKey, fn)
}
