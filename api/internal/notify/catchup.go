package notify

import (
	"context"
	"log/slog"
	"time"
)

// The catch-up's windows. A producer with no mark yet looks back
// FirstRunWindow (older changes are no longer news); one with a mark
// picks up after its done_through, but never further back than
// MaxCatchUp, which spans the capture schedule's longest gap (02:00 to
// 06:00 New York) many times over and a day's outage of the job (Lane
// 262 re-review N4). Captures are never deleted, so the bound is the
// news's age, not the store's retention; the pair read takes at most
// boards.pairsTried captures.
const (
	FirstRunWindow = 3 * time.Hour
	MaxCatchUp     = 24 * time.Hour
)

// Marks is the part of Store the catch-up reads and writes.
type Marks interface {
	MarkOf(ctx context.Context, producer string) (Mark, error)
	Finish(ctx context.Context, producer string, started, through time.Time) error
}

// Captures says when the newest injury capture landed. *boards.PGSource
// implements it.
type Captures interface {
	NewestCaptureAt(ctx context.Context) (time.Time, error)
}

// CatchUp runs the starter status producer from the notify job (re-review
// N1): when a capture landed after the mark's done_through, or a request
// came after the last run began, it compares every capture pair since
// done_through and records how far it got. The internal route only
// records the request; the work never runs on the API service.
type CatchUp struct {
	Marks         Marks
	Captures      Captures
	StarterStatus *StarterStatus
	Now           func() time.Time
	Log           *slog.Logger
}

// Run catches the producer up once; ran is false when nothing was owed.
func (c *CatchUp) Run(ctx context.Context) (Produced, bool, error) {
	mark, err := c.Marks.MarkOf(ctx, markStarterStatus)
	if err != nil {
		return Produced{}, false, err
	}
	newest, err := c.Captures.NewestCaptureAt(ctx)
	if err != nil {
		return Produced{}, false, err
	}
	requested := mark.RequestedAt.After(mark.StartedAt)
	captured := !newest.IsZero() && newest.After(mark.DoneThrough)
	if !requested && !captured {
		return Produced{}, false, nil
	}
	started := c.Now()
	got, err := c.StarterStatus.Produce(ctx, catchUpSince(mark.DoneThrough, started))
	if err != nil {
		return got, true, err
	}
	// Through the newest capture seen, readable or not: a capture the
	// floor refuses stays refused, and every pair after it is newer.
	through := newest
	if got.NewerAt != nil && got.NewerAt.After(through) {
		through = *got.NewerAt
	}
	c.Log.Info("notify: starter status produced", "pairs", got.Pairs, "changes", got.Changes,
		"queued", got.Queued, "skipped", got.Skipped, "through", through)
	return got, true, c.Marks.Finish(ctx, markStarterStatus, started, through)
}

// catchUpSince is where a run picks up: after done_through, bounded by
// MaxCatchUp, or FirstRunWindow back with no mark.
func catchUpSince(doneThrough, now time.Time) time.Time {
	if doneThrough.IsZero() {
		return now.Add(-FirstRunWindow)
	}
	if floor := now.Add(-MaxCatchUp); doneThrough.Before(floor) {
		return floor
	}
	return doneThrough
}
