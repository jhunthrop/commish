package leaguesync

import (
	"context"
	"testing"
	"time"
)

// The front door's "8 minutes ago" beside the Matchup's "just now" (Lane
// 92, B06): the first view past the minute answered the last read while
// the next went upstream behind it, and the views a minute on read the
// fresh one. While a game is live every view waits for a read under the
// minute old, so no screen is staler than the one opened after it.
func TestPollerLiveViewWaitsForAFreshRead(t *testing.T) {
	start := time.Date(2026, 10, 20, 0, 17, 0, 0, time.UTC)
	for _, c := range []struct {
		name string
		live bool
		age  time.Duration
	}{
		{"no game live answers the last read", false, 8 * time.Minute},
		{"a game live waits for the fresh one", true, 0},
	} {
		clock := &fakeClock{now: start}
		host := &countingHost{}
		p := newPoller(host, &memorySnapshots{}, clock)
		asked := -1
		p.Live = func(_ context.Context, season int) bool {
			asked = season
			return c.live
		}
		if _, err := p.Read(context.Background(), testRef); err != nil {
			t.Fatal(err)
		}
		clock.Advance(8 * time.Minute)
		r, err := p.Read(context.Background(), testRef)
		if err != nil {
			t.Fatal(err)
		}
		settle(t, p)
		if got := clock.Now().Sub(r.ReadAt); got != c.age {
			t.Errorf("%s: the view read %s old, want %s", c.name, got, c.age)
		}
		if host.reads.Load() != 2 || asked != testRef.Season {
			t.Errorf("%s: %d reads upstream, asked for season %d", c.name, host.reads.Load(), asked)
		}
	}
}

// Inside the minute a live view shares the read it has: the window
// changes the wait, never the one read a minute.
func TestPollerLiveKeepsOneReadAMinute(t *testing.T) {
	clock := &fakeClock{now: time.Date(2026, 10, 20, 0, 17, 0, 0, time.UTC)}
	host := &countingHost{}
	p := newPoller(host, &memorySnapshots{}, clock)
	p.Live = func(context.Context, int) bool { return true }
	readAll(t, p, 25)
	clock.Advance(40 * time.Second)
	readAll(t, p, 25)
	if got := host.reads.Load(); got != 1 {
		t.Fatalf("50 live views in 40 s made %d upstream reads, want 1", got)
	}
}
