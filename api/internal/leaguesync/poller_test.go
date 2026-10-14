package leaguesync

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// countingHost answers a fixed league and counts the reads that reach it.
type countingHost struct {
	Sleeper
	reads atomic.Int64
	down  atomic.Bool
}

func (h *countingHost) Read(_ context.Context, ref Ref) (Snapshot, error) {
	h.reads.Add(1)
	if h.down.Load() {
		return Snapshot{}, ErrUnavailable
	}
	return Snapshot{Ref: ref, Name: "League", Teams: []Team{{RosterID: 1}}}, nil
}

type memorySnapshots struct {
	mu    sync.Mutex
	snaps map[string]Snapshot
}

func (m *memorySnapshots) LastSnapshot(_ context.Context, ref Ref) (Snapshot, bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	s, ok := m.snaps[ref.Key()]
	return s, ok, nil
}

func (m *memorySnapshots) PutSnapshot(_ context.Context, s Snapshot) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.snaps == nil {
		m.snaps = map[string]Snapshot{}
	}
	m.snaps[s.Ref.Key()] = s
	return nil
}

type fakeClock struct {
	mu  sync.Mutex
	now time.Time
}

func (c *fakeClock) Now() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.now
}

func (c *fakeClock) Advance(d time.Duration) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.now = c.now.Add(d)
}

func quietLog() *slog.Logger { return slog.New(slog.NewTextHandler(io.Discard, nil)) }

func newPoller(host *countingHost, store SnapshotStore, clock *fakeClock) *Poller {
	return &Poller{Hosts: Hosts{host}, Store: store, Now: clock.Now, Log: quietLog()}
}

var testRef = Ref{Host: HostSleeper, LeagueID: "1382163311038038016"}

// readAll has n viewers read at once and fails on any error.
func readAll(t *testing.T, p *Poller, n int) []Read {
	t.Helper()
	out := make([]Read, n)
	errs := make([]error, n)
	var wg sync.WaitGroup
	for i := range n {
		wg.Go(func() { out[i], errs[i] = p.Read(context.Background(), testRef) })
	}
	wg.Wait()
	for _, err := range errs {
		if err != nil {
			t.Fatal(err)
		}
	}
	return out
}

// settle waits for the read a view past the minute sent upstream behind
// its answer: a refresh inside the floor joins the read in flight and
// returns once it lands, and sends none of its own, so the host's count
// is final when it returns.
func settle(t *testing.T, p *Poller) {
	t.Helper()
	if _, err := p.Refresh(context.Background(), testRef); err != nil {
		t.Fatal(err)
	}
}

// 25 viewers of one league make one upstream read a minute, the host up
// or down, and past the minute a view answers the last read while the
// next one goes upstream; a refresh reads at once but shares a read
// inside ten seconds.
func TestPollerOneReadPerLeaguePerMinute(t *testing.T) {
	clock := &fakeClock{now: time.Date(2026, 10, 13, 12, 0, 0, 0, time.UTC)}
	host := &countingHost{}
	p := newPoller(host, &memorySnapshots{}, clock)

	readAll(t, p, 25)
	clock.Advance(30 * time.Second)
	readAll(t, p, 25)
	if got := host.reads.Load(); got != 1 {
		t.Fatalf("50 views in 30 s made %d upstream reads, want 1", got)
	}
	clock.Advance(31 * time.Second)
	readAll(t, p, 25)
	settle(t, p)
	if got := host.reads.Load(); got != 2 {
		t.Fatalf("a view past the minute made %d reads in all, want 2", got)
	}

	host.down.Store(true)
	clock.Advance(time.Minute)
	for _, r := range readAll(t, p, 25) {
		if r.Name != "League" {
			t.Fatalf("a view past the minute waited on the host instead of answering the last read")
		}
	}
	settle(t, p)
	if got := host.reads.Load(); got != 3 {
		t.Fatalf("the host down: %d reads in all, want 3", got)
	}
	// A refresh inside the floor waits for the read in flight and shares it.
	r, err := p.Refresh(context.Background(), testRef)
	if err != nil || r.Stale != time.Minute || host.reads.Load() != 3 {
		t.Fatalf("the host down answered %v stale %s after %d reads, want the last read a minute stale", err, r.Stale, host.reads.Load())
	}

	host.down.Store(false)
	clock.Advance(5 * time.Second)
	if _, err := p.Refresh(context.Background(), testRef); err != nil {
		t.Fatal(err)
	}
	if got := host.reads.Load(); got != 3 {
		t.Fatalf("a refresh 5 s after a read went upstream (%d reads)", got)
	}
	clock.Advance(6 * time.Second)
	r, err = p.Refresh(context.Background(), testRef)
	if err != nil {
		t.Fatal(err)
	}
	if got := host.reads.Load(); got != 4 || r.Stale != 0 {
		t.Fatalf("a refresh 11 s after a read: %d reads, stale %s, want 4 and fresh", got, r.Stale)
	}
}

// A restarted process answers the stored read while it is fresh, and a
// league never read with its host down answers the host's error.
func TestPollerStoredReadAndFirstFailure(t *testing.T) {
	clock := &fakeClock{now: time.Date(2026, 10, 13, 12, 0, 0, 0, time.UTC)}
	store := &memorySnapshots{}
	first := &countingHost{}
	if _, err := newPoller(first, store, clock).Read(context.Background(), testRef); err != nil {
		t.Fatal(err)
	}
	clock.Advance(20 * time.Second)
	restarted := &countingHost{}
	p := newPoller(restarted, store, clock)
	readAll(t, p, 10)
	if got := restarted.reads.Load(); got != 0 {
		t.Fatalf("a restart inside the minute read the host %d times", got)
	}

	down := &countingHost{}
	down.down.Store(true)
	fresh := newPoller(down, &memorySnapshots{}, clock)
	for range 5 {
		if _, err := fresh.Read(context.Background(), testRef); !errors.Is(err, ErrUnavailable) {
			t.Fatalf("a never-read league with the host down answered %v", err)
		}
	}
	if got := down.reads.Load(); got != 1 {
		t.Fatalf("five views of a failing league made %d reads, want 1", got)
	}
}

// failingHost answers a league until it is down, then fails with err.
type failingHost struct {
	countingHost
	err error
}

func (h *failingHost) Read(ctx context.Context, ref Ref) (Snapshot, error) {
	if h.down.Load() {
		h.reads.Add(1)
		return Snapshot{}, h.err
	}
	return h.countingHost.Read(ctx, ref)
}

// A stale read says it is stale for want of a signed-in member only when
// the last try failed that way: a host that is down is not signed out.
func TestPollerStaleReadSaysSignedOut(t *testing.T) {
	cases := []struct {
		name string
		err  error
		want bool
	}{
		{"no member signed in", ErrNotConnected, true},
		{"the member signed out", ErrSignInAgain, true},
		{"the host down", ErrUnavailable, false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			clock := &fakeClock{now: time.Date(2026, 10, 13, 12, 0, 0, 0, time.UTC)}
			host := &failingHost{err: fmt.Errorf("%w: test", c.err)}
			p := &Poller{Hosts: Hosts{host}, Store: &memorySnapshots{}, Now: clock.Now, Log: quietLog()}
			fresh, err := p.Read(context.Background(), testRef)
			if err != nil || fresh.Stale != 0 || fresh.SignedOut {
				t.Fatalf("a fresh read answered %v, stale %s, signed out %v", err, fresh.Stale, fresh.SignedOut)
			}
			host.down.Store(true)
			clock.Advance(time.Minute)
			r, err := p.Refresh(context.Background(), testRef)
			if err != nil || r.Stale != time.Minute {
				t.Fatalf("a failed refresh answered %v, stale %s, want the last read a minute stale", err, r.Stale)
			}
			if !r.Failed || r.SignedOut != c.want {
				t.Fatalf("failed %v, signed out %v, want failed and signed out %v", r.Failed, r.SignedOut, c.want)
			}
		})
	}
}

// A read kept from before this process is stale while the next goes to the
// host, but nothing failed, so it never reads as a failure.
func TestPollerKeptReadIsNotAFailure(t *testing.T) {
	clock := &fakeClock{now: time.Date(2026, 10, 13, 12, 0, 0, 0, time.UTC)}
	store := &memorySnapshots{}
	if _, err := newPoller(&countingHost{}, store, clock).Read(context.Background(), testRef); err != nil {
		t.Fatal(err)
	}
	clock.Advance(3 * time.Minute)
	r, err := newPoller(&countingHost{}, store, clock).Read(context.Background(), testRef)
	if err != nil || r.Stale == 0 || r.Failed || r.SignedOut {
		t.Fatalf("a kept read answered %v, stale %s, failed %v, signed out %v; want stale and not failed", err, r.Stale, r.Failed, r.SignedOut)
	}
}
