package runs

import (
	"context"
	"time"
)

// The reach pass (Lane 203 fix round 1): run once per run in the
// background, never on a request's time. A /run/manifest asked before it
// lands answers without the reach (handler.go); once it lands the
// manifest answers with it under the run's ETag.

// reachTimeout is one pass's budget: every page of the run, read
// pageReads at a time, well under the server's 60 s write timeout.
const reachTimeout = 30 * time.Second

// The retry after a failed pass backs off from firstReachBackoff,
// doubling to maxReachBackoff, so a slow bucket is not read whole every
// few seconds.
const (
	firstReachBackoff = 30 * time.Second
	maxReachBackoff   = 5 * time.Minute
)

// reachMemo is the pass's state for one run: its answer once it has
// landed, or when a failed pass may run again and how long it waited.
// A failed pass's answer is never kept.
type reachMemo struct {
	runID   string
	answer  *Answer
	retryAt time.Time
	backoff time.Duration
}

// Reached is the manifest's answer with the reach for runID once its pass
// has landed. Until then it is false, and the pass is started when none is
// running and no backoff is pending; it never waits on the pass.
func (r *Reader) Reached(runID string) (Answer, bool) {
	r.mu.Lock()
	if r.reach.runID != runID {
		r.reach = reachMemo{runID: runID}
	}
	if r.reach.answer != nil {
		answer := *r.reach.answer
		r.mu.Unlock()
		return answer, true
	}
	backingOff := r.now().Before(r.reach.retryAt)
	r.mu.Unlock()
	if !backingOff {
		// DoChan joins a pass already running; its result is recorded by
		// the pass itself, so no caller waits on the channel.
		r.group.DoChan(reachKey(runID), func() (any, error) {
			r.reachPass(runID)
			return nil, nil
		})
	}
	return Answer{}, false
}

func reachKey(runID string) string { return "reach:" + runID }

// reachPass works the reach out under its own budget, detached from any
// request, and records what came of it.
func (r *Reader) reachPass(runID string) {
	ctx, cancel := context.WithTimeout(context.Background(), r.reachTimeout)
	defer cancel()
	started := time.Now()
	answer, pages, err := composeManifest(ctx, r, runID)
	took := time.Since(started)

	r.mu.Lock()
	defer r.mu.Unlock()
	// An ask after this record starts a pass of its own, never joining
	// this one as it returns.
	r.group.Forget(reachKey(runID))
	if r.reach.runID != runID {
		return // the pointer moved on while the pass ran
	}
	if err != nil {
		next := firstReachBackoff
		if r.reach.backoff > 0 {
			next = min(2*r.reach.backoff, maxReachBackoff)
		}
		r.reach.backoff, r.reach.retryAt = next, r.now().Add(next)
		r.log.Warn("runs: the season reach did not work out; the manifest answers without it",
			"run_id", runID, "took", took, "retry_in", next, "err", err)
		return
	}
	r.reach.answer, r.reach.backoff, r.reach.retryAt = &answer, 0, time.Time{}
	r.log.Info("runs: the season reach is in", "run_id", runID, "pages", pages, "took", took)
}
