package notify

import (
	"context"
	"log/slog"
	"time"

	"github.com/google/uuid"

	"github.com/jhunthrop/commish/api/internal/boards"
)

// The catch-up's windows. A producer with no mark yet looks back
// FirstRunWindow (older changes are no longer news); one with a mark
// picks up after its done_through, but never further back than
// MaxCatchUp, which spans the capture schedule's longest gap (02:00 to
// 06:00 New York) many times over and a day's outage of the job (Lane
// 262 re-review N4). Captures are never deleted, so the bound is the
// news's age, not the store's retention; the pair read takes at most
// boards.MaxPairCaptures captures after the mark, and a read it cuts moves
// the mark no further than the newest capture read.
const (
	FirstRunWindow = 3 * time.Hour
	MaxCatchUp     = 24 * time.Hour
)

// markWriteTimeout bounds the mark's write after a run: it runs on a
// context of its own, so a run cut at its deadline still records where it
// stopped (one row, milliseconds), and the drain after it starts at most
// this much later.
const markWriteTimeout = 5 * time.Second

// Marks is the part of Store the catch-up reads and writes.
type Marks interface {
	MarkOf(ctx context.Context, producer string) (Mark, error)
	Finish(ctx context.Context, producer string, started, through time.Time) error
	Hold(ctx context.Context, producer string, started time.Time, after uuid.UUID, through time.Time) error
}

// Captures says when the newest injury capture landed. *boards.PGSource
// implements it.
type Captures interface {
	NewestCaptureAt(ctx context.Context) (time.Time, error)
}

// CatchUp runs the starter status producer from the notify job (re-review
// N1): when a capture landed after the mark's done_through, a request came
// after the last run began, or a cut run is owed its resume, it compares
// every capture pair since done_through and records how far it got. A run
// cut by its deadline, or stopped at the account page bound, keeps the
// last account it finished and the window it paired (Store.Hold), and the
// next run walks the accounts after it over that same window; only a walk
// that finishes moves done_through (Lane 285, B275). The internal route
// only records the request; the work never runs on the API service.
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
	if !requested && !captured && !mark.Resuming() {
		return Produced{}, false, nil
	}
	started := c.Now()
	w := Window{Since: catchUpSince(mark.DoneThrough, started)}
	if mark.Resuming() {
		w.Until, w.After = mark.ResumeThrough, mark.ResumeAfter
	}
	got, err := c.StarterStatus.Produce(ctx, w)
	through := runThrough(mark, newest, got)
	if got.Cut && !mark.Resuming() {
		// Once per cut pass: a resume of the same window reads the same cut.
		c.Log.Warn("notify: the capture pair read reached its bound; the mark stops at the newest capture read",
			"bound", boards.MaxPairCaptures, "read", got.Captures, "left", got.CapturesLeft, "through", through)
	}
	markCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), markWriteTimeout)
	defer cancel()
	if err == nil && got.Done {
		c.Log.Info("notify: starter status produced", "pairs", got.Pairs, "changes", got.Changes, "accounts", got.Accounts,
			"queued", got.Queued, "skipped", got.Skipped, "stale_leagues", got.StaleLeagues, "through", through)
		return got, true, c.Marks.Finish(markCtx, markStarterStatus, started, through)
	}
	if got.LastAccount == uuid.Nil {
		return got, true, err
	}
	c.Log.Warn("notify: starter status stopped mid-walk; the next run resumes after the account",
		"account_id", got.LastAccount, "accounts", got.Accounts, "queued", got.Queued, "through", through, "err", err)
	if holdErr := c.Marks.Hold(markCtx, markStarterStatus, started, got.LastAccount, through); holdErr != nil {
		return got, true, holdErr
	}
	return got, true, err
}

// runThrough is how far a run's window reaches: a resumed run's own
// window; a pair read the bound cut, its newest capture read; else the
// newest capture seen, readable or not (a capture the floor refuses stays
// refused, and every pair after it is newer).
func runThrough(mark Mark, newest time.Time, got Produced) time.Time {
	if mark.Resuming() {
		return mark.ResumeThrough
	}
	if got.Cut {
		return got.CutAt
	}
	if got.NewerAt != nil && got.NewerAt.After(newest) {
		return *got.NewerAt
	}
	return newest
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
