package notify

import (
	"context"
	"errors"
	"log/slog"
	"time"

	"github.com/google/uuid"
)

// The drain's bounds (spec §5.3): a minute's run claims in batches under a
// lease longer than any batch's sends, retries a failure on a doubling
// backoff, and gives a row up after its last attempt.
const (
	DefaultBatch       = 50
	DefaultMaxRows     = 1000
	DefaultLease       = 2 * time.Minute
	DefaultMaxAttempts = 6
	DefaultBackoff     = time.Minute
	DefaultMaxBackoff  = time.Hour
)

// Outbox is the part of Store the drain uses.
type Outbox interface {
	Claim(ctx context.Context, now time.Time, lease time.Duration, limit, maxAttempts int) ([]Notification, error)
	MarkSent(ctx context.Context, id uuid.UUID, at time.Time) error
	MarkRetry(ctx context.Context, id uuid.UUID, at, retryAt time.Time) error
	MarkDead(ctx context.Context, id uuid.UUID, at time.Time, maxAttempts int) error
	Targets(ctx context.Context, accountID uuid.UUID, deviceID *uuid.UUID) ([]Target, error)
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
}

// Drained counts one run's rows by outcome.
type Drained struct {
	Sent, Retried, Dead, DroppedTokens int
}

// Run drains due rows in batches until none is due or MaxRows is reached.
func (d *Drainer) Run(ctx context.Context) (Drained, error) {
	var out Drained
	for claimed := 0; claimed < d.maxRows(); {
		rows, err := d.Outbox.Claim(ctx, d.Now(), d.lease(), min(d.batch(), d.maxRows()-claimed), d.maxAttempts())
		if err != nil {
			return out, err
		}
		if len(rows) == 0 {
			return out, nil
		}
		claimed += len(rows)
		for _, n := range rows {
			if err := d.deliver(ctx, n, &out); err != nil {
				return out, err
			}
		}
	}
	return out, nil
}

// rowOutcome is how one row's sends went across its devices.
type rowOutcome int

const (
	rowDead rowOutcome = iota
	rowRetry
	rowSent
)

// deliver sends one row to each of its devices and records it: sent when
// any device took it, retried when one failed in a way worth retrying,
// else dead. A dead token's registration is removed.
func (d *Drainer) deliver(ctx context.Context, n Notification, out *Drained) error {
	prefs, err := d.Outbox.Preferences(ctx, n.AccountID)
	if err != nil {
		return err
	}
	if !prefs.On(n.Kind) {
		d.Log.Info("notify: kind switched off since queued", "id", n.ID, "kind", n.Kind)
		out.Dead++
		return d.Outbox.MarkDead(ctx, n.ID, d.Now(), d.maxAttempts())
	}
	targets, err := d.Outbox.Targets(ctx, n.AccountID, n.DeviceID)
	if err != nil {
		return err
	}
	outcome := rowDead
	for _, t := range targets {
		got, dropped, err := d.sendOne(ctx, n, t)
		if err != nil {
			return err
		}
		if dropped {
			out.DroppedTokens++
		}
		outcome = max(outcome, got)
	}
	now := d.Now()
	switch {
	case outcome == rowSent:
		out.Sent++
		return d.Outbox.MarkSent(ctx, n.ID, now)
	case outcome == rowRetry && n.Attempts < d.maxAttempts():
		out.Retried++
		return d.Outbox.MarkRetry(ctx, n.ID, now, prefs.SendAfter(now.Add(d.backoff(n.Attempts))))
	default:
		if len(targets) == 0 {
			d.Log.Info("notify: no registered device", "id", n.ID, "account_id", n.AccountID)
		}
		out.Dead++
		return d.Outbox.MarkDead(ctx, n.ID, now, d.maxAttempts())
	}
}

// sendOne sends to one device and answers how it went and whether its
// dead token was removed; the error it answers is the store's, a send's
// own failure is its outcome.
func (d *Drainer) sendOne(ctx context.Context, n Notification, t Target) (rowOutcome, bool, error) {
	sender, ok := d.Senders[t.Platform]
	if !ok {
		sender = NotConfigured{Platform: t.Platform}
	}
	err := sender.Send(ctx, Message{Token: t.Token, Kind: n.Kind, Title: n.Title, Body: n.Body, Data: n.Data})
	switch {
	case err == nil:
		return rowSent, false, nil
	case errors.Is(err, ErrDeadToken):
		d.Log.Info("notify: dead token removed", "id", n.ID, "device_id", t.DeviceID, "platform", t.Platform, "err", err)
		return rowDead, true, d.Outbox.DropToken(ctx, t.DeviceID, t.Token)
	case errors.Is(err, ErrNotConfigured), errors.Is(err, ErrRejected):
		d.Log.Warn("notify: not sent", "id", n.ID, "device_id", t.DeviceID, "platform", t.Platform, "err", err)
		return rowDead, false, nil
	default:
		d.Log.Warn("notify: send failed", "id", n.ID, "device_id", t.DeviceID, "platform", t.Platform,
			"attempt", n.Attempts, "err", err)
		return rowRetry, false, nil
	}
}

// backoff is the wait after the attempt-th failure: Backoff doubled each
// attempt, up to MaxBackoff.
func (d *Drainer) backoff(attempt int) time.Duration {
	wait, ceiling := d.Backoff, d.MaxBackoff
	if wait <= 0 {
		wait = DefaultBackoff
	}
	if ceiling <= 0 {
		ceiling = DefaultMaxBackoff
	}
	for i := 1; i < attempt && wait < ceiling; i++ {
		wait *= 2
	}
	return min(wait, ceiling)
}

func (d *Drainer) batch() int       { return orDefault(d.Batch, DefaultBatch) }
func (d *Drainer) maxRows() int     { return orDefault(d.MaxRows, DefaultMaxRows) }
func (d *Drainer) maxAttempts() int { return orDefault(d.MaxAttempts, DefaultMaxAttempts) }

func (d *Drainer) lease() time.Duration {
	if d.Lease <= 0 {
		return DefaultLease
	}
	return d.Lease
}

func orDefault(v, def int) int {
	if v <= 0 {
		return def
	}
	return v
}
