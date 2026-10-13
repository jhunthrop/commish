package hosts

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ErrBusy is a request whose turn is further away than the caller waits.
var ErrBusy = errors.New("hosts: host busy")

// ErrNoGate is a host with no row in app.host_request_gate.
var ErrNoGate = errors.New("hosts: no request gate for the host")

// Gate paces requests to one host across every process that reads it
// (the api's instances and the refresh job): each request takes the next
// slot, one gap after the last, in one statement against
// app.host_request_gate, and waits for it. A slot is taken only when its
// wait is within what the caller will wait, in the same statement, and is
// never handed back, so no two requests ever hold the same slot.
type Gate struct {
	Pool *pgxpool.Pool
	Host string
	Gap  time.Duration
	// MaxWait is the furthest slot a request takes; the caller's deadline,
	// when nearer, bounds it too.
	MaxWait time.Duration
}

func interval(d time.Duration) string { return fmt.Sprintf("%d milliseconds", d.Milliseconds()) }

// take takes the next slot within the caller's wait, answering it and the
// database's clock, or ErrBusy having taken nothing.
func (g *Gate) take(ctx context.Context) (slot, now time.Time, err error) {
	limit := g.MaxWait
	if deadline, ok := ctx.Deadline(); ok {
		limit = min(limit, time.Until(deadline))
	}
	if limit < 0 {
		return time.Time{}, time.Time{}, ErrBusy
	}
	err = g.Pool.QueryRow(ctx, `update app.host_request_gate
		set next_at = greatest(next_at, clock_timestamp()) + $2::interval
		where host = $1 and greatest(next_at, clock_timestamp()) - clock_timestamp() <= $3::interval
		returning next_at - $2::interval, clock_timestamp()`, g.Host, interval(g.Gap), interval(limit)).Scan(&slot, &now)
	if errors.Is(err, pgx.ErrNoRows) {
		// No row taken: the turn is past the wait, or the host has no gate
		// row at all (a host added without its migration), which is not a
		// backlog and must not read as one.
		var exists bool
		if err := g.Pool.QueryRow(ctx, `select exists (select 1 from app.host_request_gate where host = $1)`, g.Host).Scan(&exists); err != nil {
			return time.Time{}, time.Time{}, fmt.Errorf("hosts: gate: %w", err)
		}
		if !exists {
			return time.Time{}, time.Time{}, fmt.Errorf("%w: %s", ErrNoGate, g.Host)
		}
		return time.Time{}, time.Time{}, ErrBusy
	}
	if err != nil {
		return time.Time{}, time.Time{}, fmt.Errorf("hosts: gate: %w", err)
	}
	return slot, now, nil
}

// Wait takes the next slot and sleeps until it, or answers ErrBusy having
// taken nothing.
func (g *Gate) Wait(ctx context.Context) error {
	slot, now, err := g.take(ctx)
	if err != nil {
		return err
	}
	wait := slot.Sub(now)
	if wait <= 0 {
		return nil
	}
	t := time.NewTimer(wait)
	defer t.Stop()
	select {
	case <-t.C:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}
