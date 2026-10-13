package hosts

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// ErrBusy is a request whose turn is further away than the caller waits.
var ErrBusy = errors.New("hosts: host busy")

// Gate paces requests to one host across every process that reads it
// (the api's instances and the refresh job): each request takes the next
// slot, one gap after the last, in one statement against
// app.host_request_gate, and waits for it.
type Gate struct {
	Pool *pgxpool.Pool
	Host string
	Gap  time.Duration
	// MaxWait is the furthest slot a request takes; past it the request is
	// refused and its slot handed back.
	MaxWait time.Duration
}

// Wait takes the next slot and sleeps until it.
func (g *Gate) Wait(ctx context.Context) error {
	gap := fmt.Sprintf("%d milliseconds", g.Gap.Milliseconds())
	var slot, now time.Time
	err := g.Pool.QueryRow(ctx, `update app.host_request_gate
		set next_at = greatest(next_at, clock_timestamp()) + $2::interval
		where host = $1 returning next_at - $2::interval, clock_timestamp()`, g.Host, gap).Scan(&slot, &now)
	if err != nil {
		return fmt.Errorf("hosts: gate: %w", err)
	}
	wait := slot.Sub(now)
	if wait > g.MaxWait {
		// Hand the slot back: the next request takes it.
		_, _ = g.Pool.Exec(context.WithoutCancel(ctx), `update app.host_request_gate
			set next_at = next_at - $2::interval where host = $1 and next_at > clock_timestamp()`, g.Host, gap)
		return ErrBusy
	}
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
