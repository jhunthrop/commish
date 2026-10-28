package notify

import (
	"context"
	"errors"
	"log/slog"
	"time"

	"github.com/google/uuid"

	"github.com/jhunthrop/commish/api/internal/auth"
)

// The drain's bounds (spec §5.3): a run claims in batches under a lease,
// stops claiming once its budget is spent and sends nothing past the
// lease (less a margin), retries a failure on a doubling backoff, and
// gives a row up after its last attempt.
const (
	DefaultBatch       = 20
	DefaultMaxRows     = 1000
	DefaultLease       = 2 * time.Minute
	DefaultMaxAttempts = 6
	DefaultBackoff     = time.Minute
	DefaultMaxBackoff  = time.Hour
	// leaseMargin is the time kept between a run's last send and its lease
	// running out: a send's own timeout and the mark after it.
	leaseMargin = sendTimeout + 5*time.Second
)

// Outbox is the part of Store the drain uses.
type Outbox interface {
	Claim(ctx context.Context, now time.Time, lease time.Duration, limit, maxAttempts int) ([]Notification, error)
	MarkSent(ctx context.Context, n Notification, at time.Time) (bool, error)
	MarkRetry(ctx context.Context, n Notification, at, retryAt time.Time) (bool, error)
	MarkDead(ctx context.Context, n Notification, at time.Time) (bool, error)
	SentWithChildren(ctx context.Context, n Notification, at, retryAt time.Time, devices []uuid.UUID) (bool, error)
	Release(ctx context.Context, rows []Notification, at time.Time) error
	Targets(ctx context.Context, accountID uuid.UUID, deviceID *uuid.UUID, activeSince time.Time) ([]Target, error)
	DropToken(ctx context.Context, deviceID uuid.UUID, token string) error
	Preferences(ctx context.Context, accountID uuid.UUID) (Preferences, error)
}

// Drainer is the notify job: it sends every due row once and records how
// each went.
type Drainer struct {
	Outbox  Outbox
	Senders map[Platform]Sender
	Now     func() time.Time
	Log     *slog.Logger

	Batch       int
	MaxRows     int
	Lease       time.Duration
	MaxAttempts int
	Backoff     time.Duration
	MaxBackoff  time.Duration
	// Budget is how long a run keeps claiming, half the lease by default.
	Budget time.Duration
	// ActiveFor is how recently a device must have been used to receive a
	// push, auth.SessionTTL by default (security review M1).
	ActiveFor time.Duration
}

// Drained counts one run's rows by outcome.
type Drained struct {
	Sent, Retried, Dead, DroppedTokens, Released, Lost int
}

// Run drains due rows in batches until none is due, MaxRows is reached or
// the budget is spent. A row claimed and not tried (the run's context
// ended, or its sends would reach past the lease) is released, its
// attempt not counted (review M3).
func (d *Drainer) Run(ctx context.Context) (Drained, error) {
	var out Drained
	start := d.Now()
	for claimed := 0; claimed < d.maxRows() && d.Now().Sub(start) < d.budget() && ctx.Err() == nil; {
		claimAt := d.Now()
		rows, err := d.Outbox.Claim(ctx, claimAt, d.lease(), min(d.batch(), d.maxRows()-claimed), d.maxAttempts())
		if err != nil {
			return out, err
		}
		if len(rows) == 0 {
			return out, nil
		}
		claimed += len(rows)
		stopped, err := d.drainBatch(ctx, rows, claimAt.Add(d.lease()-leaseMargin), &out)
		if err != nil || stopped {
			return out, err
		}
	}
	return out, nil
}

// drainBatch delivers each claimed row while the run may still send, and
// releases the rest. A row is read on the run's context, sent on one that
// ends before the lease does, and marked on one the run's end does not
// cancel, so a row sent is always marked and never released.
// stopped is true when the run must end: its rows past the window were
// released.
func (d *Drainer) drainBatch(ctx context.Context, rows []Notification, sendBy time.Time, out *Drained) (bool, error) {
	sendCtx, cancel := context.WithTimeout(ctx, max(sendBy.Sub(d.Now()), 0))
	defer cancel()
	dc := deliveryContexts{read: ctx, send: sendCtx, mark: context.WithoutCancel(ctx)}
	for i, n := range rows {
		if sendCtx.Err() != nil || !d.Now().Before(sendBy) {
			return true, d.release(rows[i:], out)
		}
		if err := d.deliver(dc, n, out); err != nil {
			if ctx.Err() != nil {
				return true, d.release(rows[i:], out)
			}
			return true, err
		}
	}
	return false, nil
}

// deliveryContexts are the three a row's delivery runs on.
type deliveryContexts struct{ read, send, mark context.Context }

// release gives the rows back on a context of its own: the run's may be
// the one that ended.
func (d *Drainer) release(rows []Notification, out *Drained) error {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	out.Released += len(rows)
	d.Log.Warn("notify: rows released untried", "rows", len(rows))
	return d.Outbox.Release(ctx, rows, d.Now())
}

// targetOutcome is how one device's send went.
type targetOutcome int

const (
	targetDead targetOutcome = iota
	targetRetry
	targetSent
)

// deliver sends one row to each of its devices and records it (the rule
// of review M1):
//   - a device took it and none failed worth a retry: sent;
//   - a device took it and others failed worth a retry: sent, with one
//     child row per failed device to retry it there alone;
//   - no device took it and one failed worth a retry: the whole row
//     retries (nobody has it, so nobody gets it twice);
//   - otherwise: dead.
func (d *Drainer) deliver(dc deliveryContexts, n Notification, out *Drained) error {
	ctx := dc.mark
	prefs, err := d.Outbox.Preferences(dc.read, n.AccountID)
	if err != nil {
		return err
	}
	now := d.Now()
	if !prefs.On(n.Kind) {
		d.Log.Info("notify: dead, kind switched off since queued", "id", n.ID, "kind", n.Kind)
		return d.dead(ctx, n, now, out)
	}
	targets, err := d.Outbox.Targets(dc.read, n.AccountID, n.DeviceID, now.Add(-d.activeFor()))
	if err != nil {
		return err
	}
	if len(targets) == 0 {
		d.Log.Info("notify: dead, no active registered device", "id", n.ID, "account_id", n.AccountID)
		return d.dead(ctx, n, now, out)
	}
	var sent int
	var retry []uuid.UUID
	for _, t := range targets {
		got, err := d.sendOne(dc, n, t, out)
		if err != nil {
			return err
		}
		switch got {
		case targetSent:
			sent++
		case targetRetry:
			retry = append(retry, t.DeviceID)
		}
	}
	now = d.Now()
	retryAt := prefs.SendAfter(now.Add(d.backoff(n.Attempts)))
	switch {
	case sent > 0 && len(retry) == 0:
		return d.held(n, out, &out.Sent)(d.Outbox.MarkSent(ctx, n, now))
	case sent > 0 && n.DeviceID == nil && n.Attempts < d.maxAttempts():
		return d.held(n, out, &out.Sent)(d.Outbox.SentWithChildren(ctx, n, now, retryAt, retry))
	case sent > 0:
		return d.held(n, out, &out.Sent)(d.Outbox.MarkSent(ctx, n, now))
	case len(retry) > 0 && n.Attempts < d.maxAttempts():
		return d.held(n, out, &out.Retried)(d.Outbox.MarkRetry(ctx, n, now, retryAt))
	default:
		return d.dead(ctx, n, now, out)
	}
}

func (d *Drainer) dead(ctx context.Context, n Notification, now time.Time, out *Drained) error {
	return d.held(n, out, &out.Dead)(d.Outbox.MarkDead(ctx, n, now))
}

// held counts a mark that held the claim under counter, and a lost one
// (another run took the row after this run's lease) as lost, logged.
func (d *Drainer) held(n Notification, out *Drained, counter *int) func(bool, error) error {
	return func(ok bool, err error) error {
		if err != nil {
			return err
		}
		if !ok {
			out.Lost++
			d.Log.Warn("notify: the claim was lost before its mark", "id", n.ID, "attempt", n.Attempts)
			return nil
		}
		*counter++
		return nil
	}
}

// sendOne sends to one device and answers how it went; the error it
// answers is the store's, a send's own failure is its outcome. A dead
// token's registration is removed.
func (d *Drainer) sendOne(dc deliveryContexts, n Notification, t Target, out *Drained) (targetOutcome, error) {
	sender, ok := d.Senders[t.Platform]
	if !ok {
		sender = NotConfigured{Platform: t.Platform}
	}
	err := sender.Send(dc.send, Message{Token: t.Token, Kind: n.Kind, Title: n.Title, Body: n.Body, Data: n.Data})
	switch {
	case err == nil:
		return targetSent, nil
	case errors.Is(err, ErrDeadToken):
		d.Log.Info("notify: dead token removed", "id", n.ID, "device_id", t.DeviceID, "platform", t.Platform, "err", err)
		out.DroppedTokens++
		return targetDead, d.Outbox.DropToken(dc.mark, t.DeviceID, t.Token)
	case errors.Is(err, ErrNotConfigured):
		d.Log.Info("notify: not sent, the platform is not configured", "id", n.ID, "device_id", t.DeviceID, "platform", t.Platform)
		return targetDead, nil
	case errors.Is(err, ErrRejected):
		d.Log.Warn("notify: not sent, the platform refused it", "id", n.ID, "device_id", t.DeviceID, "platform", t.Platform, "err", err)
		return targetDead, nil
	default:
		d.Log.Warn("notify: send failed", "id", n.ID, "device_id", t.DeviceID, "platform", t.Platform,
			"attempt", n.Attempts, "err", err)
		return targetRetry, nil
	}
}

// backoff is the wait after the attempt-th failure: Backoff doubled each
// attempt, up to MaxBackoff.
func (d *Drainer) backoff(attempt int) time.Duration {
	wait, ceiling := orDuration(d.Backoff, DefaultBackoff), orDuration(d.MaxBackoff, DefaultMaxBackoff)
	for i := 1; i < attempt && wait < ceiling; i++ {
		wait *= 2
	}
	return min(wait, ceiling)
}

func (d *Drainer) batch() int               { return orDefault(d.Batch, DefaultBatch) }
func (d *Drainer) maxRows() int             { return orDefault(d.MaxRows, DefaultMaxRows) }
func (d *Drainer) maxAttempts() int         { return orDefault(d.MaxAttempts, DefaultMaxAttempts) }
func (d *Drainer) lease() time.Duration     { return orDuration(d.Lease, DefaultLease) }
func (d *Drainer) budget() time.Duration    { return orDuration(d.Budget, d.lease()/2) }
func (d *Drainer) activeFor() time.Duration { return orDuration(d.ActiveFor, auth.SessionTTL) }

func orDefault(v, def int) int {
	if v <= 0 {
		return def
	}
	return v
}

func orDuration(v, def time.Duration) time.Duration {
	if v <= 0 {
		return def
	}
	return v
}
