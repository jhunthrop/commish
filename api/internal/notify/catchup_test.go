package notify

import (
	"context"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/jhunthrop/commish/api/internal/boards"
	"github.com/jhunthrop/commish/api/internal/leaguesync"
)

// fixedCaptures answers one newest capture time.
type fixedCaptures struct{ at time.Time }

func (f fixedCaptures) NewestCaptureAt(context.Context) (time.Time, error) { return f.at, nil }

// The notify job's catch-up (re-review N1, N4): with no mark it looks back
// FirstRunWindow and records how far it got; with nothing new and no
// request it does nothing; a request after its last run began runs it
// again; a mark four hours old (the 02:00 to 06:00 gap) still catches the
// pair after it; a mark older than MaxCatchUp picks up at the bound.
func TestCatchUpFromTheMark(t *testing.T) {
	f := newOutbox(t)
	f.device("android", PlatformFCM, androidToken)
	ctx := context.Background()
	lineups := fakeLineups{f.acct: {{LinkID: uuid.New(), LeagueName: "L", Players: []leaguesync.StartingPlayer{{BoardID: "p1", Name: "A Receiver"}}}}}
	at := func(h int) time.Time { return time.Date(2026, 10, 25, h, 0, 0, 0, time.UTC) }
	pair := func(older, newer time.Time, code string) boards.DesignationPair {
		return boards.DesignationPair{Older: designated(map[string]string{}, nil, older), Newer: designated(map[string]string{"p1": code}, nil, newer),
			OlderAt: older, NewerAt: newer}
	}
	c := &clock{now: at(12)}
	producer := &StarterStatus{Designations: pairsOf(pair(at(10), at(11), "O")), Lineups: lineups, Queue: f.store, Now: c.Now, Log: quiet()}
	run := func(newest time.Time) (Produced, bool) {
		t.Helper()
		cu := &CatchUp{Marks: f.store, Captures: fixedCaptures{newest}, StarterStatus: producer, Now: c.Now, Log: quiet()}
		got, ran, err := cu.Run(ctx)
		if err != nil {
			t.Fatal(err)
		}
		return got, ran
	}

	if got, ran := run(at(11)); !ran || got.Queued != 1 {
		t.Fatalf("first run %+v %v", got, ran)
	}
	if mark, _ := f.store.MarkOf(ctx, markStarterStatus); !mark.DoneThrough.Equal(at(11)) || !mark.StartedAt.Equal(at(12)) {
		t.Fatalf("mark %+v", mark)
	}
	c.set(at(12).Add(time.Minute))
	if _, ran := run(at(11)); ran {
		t.Fatal("ran with nothing new and no request")
	}
	if err := f.store.RequestRun(ctx, markStarterStatus, c.Now()); err != nil {
		t.Fatal(err)
	}
	if got, ran := run(at(11)); !ran || got.Queued != 0 {
		t.Fatalf("a request after the last run: %+v %v", got, ran)
	}

	// The 02:00 capture's run was lost; 06:00 is the next capture, four
	// hours on, and the mark still stands at 02:00.
	night := func(h int) time.Time { return time.Date(2026, 10, 26, h, 0, 0, 0, time.UTC) }
	if err := f.store.Finish(ctx, markStarterStatus, night(1), night(1)); err != nil {
		t.Fatal(err)
	}
	c.set(night(6).Add(5 * time.Minute))
	producer.Designations = pairsOf(pair(night(1), night(2), "D"), pair(night(2), night(6), "IR"))
	if got, ran := run(night(6)); !ran || got.Pairs != 2 || got.Queued != 2 {
		t.Fatalf("after the gap %+v %v", got, ran)
	}

	if since := catchUpSince(night(6).Add(-48*time.Hour), night(6)); !since.Equal(night(6).Add(-MaxCatchUp)) {
		t.Fatalf("a stale mark picks up at %v", since)
	}
	if since := catchUpSince(time.Time{}, night(6)); !since.Equal(night(6).Add(-FirstRunWindow)) {
		t.Fatalf("no mark picks up at %v", since)
	}
}

// One notify run at a time: while one holds the lock, another does
// nothing and says so (re-review N5).
func TestExclusiveIsOneAtATime(t *testing.T) {
	f := newOutbox(t)
	ctx := context.Background()
	holding, release := make(chan struct{}), make(chan struct{})
	var wg sync.WaitGroup
	var firstRan bool
	var firstErr error
	wg.Add(1)
	go func() {
		defer wg.Done()
		firstRan, firstErr = f.store.Exclusive(ctx, func(context.Context) error {
			close(holding)
			<-release
			return nil
		})
	}()
	<-holding
	secondRan, err := f.store.Exclusive(ctx, func(context.Context) error {
		t.Error("the second run ran while the first held the lock")
		return nil
	})
	close(release)
	wg.Wait()
	if err != nil || firstErr != nil || secondRan || !firstRan {
		t.Fatalf("first %v %v, second %v %v", firstRan, firstErr, secondRan, err)
	}
	if ran, err := f.store.Exclusive(ctx, func(context.Context) error { return nil }); err != nil || !ran {
		t.Fatalf("after the first released: %v %v", ran, err)
	}
}

// blockingCatchUp waits until its context ends.
type blockingCatchUp struct{}

func (blockingCatchUp) Run(ctx context.Context) (Produced, bool, error) {
	<-ctx.Done()
	return Produced{}, true, ctx.Err()
}

// recordingDrain records the context it ran on.
type recordingDrain struct{ ranAlive bool }

func (d *recordingDrain) Run(ctx context.Context) (Drained, error) {
	d.ranAlive = ctx.Err() == nil
	return Drained{Sent: 1}, nil
}

// A catch-up that blocks is cut at its own deadline and the drain still
// runs, on a context still alive (re-review N17).
func TestPassBoundsTheCatchUp(t *testing.T) {
	drain := &recordingDrain{}
	pass := &Pass{CatchUp: blockingCatchUp{}, Drain: drain, CatchUpBudget: 50 * time.Millisecond, Log: quiet()}
	start := time.Now()
	got, err := pass.Run(context.Background())
	if err != nil || got.Sent != 1 || !drain.ranAlive || time.Since(start) > 5*time.Second {
		t.Fatalf("%+v %v, drain alive %v after %v", got, err, drain.ranAlive, time.Since(start))
	}
}
