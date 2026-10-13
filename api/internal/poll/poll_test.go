package poll

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

type clock struct {
	mu  sync.Mutex
	now time.Time
}

func (c *clock) Now() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.now
}

func (c *clock) Advance(d time.Duration) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.now = c.now.Add(d)
}

const gap = time.Minute

func newPoller(c *clock, outlive bool, store Store[int]) *Poller[int] {
	return &Poller[int]{
		Now: c.Now, Store: store, Log: slog.New(slog.NewTextHandler(io.Discard, nil)),
		Idle: time.Hour, Timeout: 5 * time.Second, Outlive: outlive,
	}
}

func start() *clock { return &clock{now: time.Date(2026, 10, 13, 12, 0, 0, 0, time.UTC)} }

// counting answers its read count, so a viewer can tell which read it got.
func counting(n *atomic.Int64) Fetch[int] {
	return func(context.Context) (int, error) { return int(n.Add(1)), nil }
}

// One read per key per gap whatever the number of viewers, in Wait mode;
// past the gap Revalidate answers the last read at once and reads behind.
func TestOneReadPerGapAndRevalidate(t *testing.T) {
	c := start()
	p := newPoller(c, false, nil)
	var n atomic.Int64
	var wg sync.WaitGroup
	for range 25 {
		wg.Go(func() {
			if r, err := p.Read(context.Background(), "k", gap, Wait, counting(&n)); err != nil || r.Value != 1 {
				t.Errorf("a viewer got %d, %v", r.Value, err)
			}
		})
	}
	wg.Wait()
	c.Advance(gap - time.Second)
	if _, err := p.Read(context.Background(), "k", gap, Wait, counting(&n)); err != nil || n.Load() != 1 {
		t.Fatalf("inside the gap: %v after %d reads", err, n.Load())
	}
	c.Advance(2 * time.Second)
	r, err := p.Read(context.Background(), "k", gap, Revalidate, counting(&n))
	if err != nil || r.Value != 1 || p.Upstream() != 2 {
		t.Fatalf("past the gap Revalidate answered %d, %v, with %d reads sent", r.Value, err, p.Upstream())
	}
}

type kept struct {
	value int
	at    time.Time
}

func (k kept) Last(context.Context, string) (int, time.Time, bool, error) {
	return k.value, k.at, true, nil
}
func (kept) Keep(context.Context, string, int, time.Time) error { return nil }

// A read kept from before this process answers fresh inside the gap with
// no read sent, and past it says how stale it is until a read lands.
func TestKeptReadStaleRule(t *testing.T) {
	c := start()
	var n atomic.Int64
	fresh := newPoller(c, false, kept{value: 7, at: c.Now().Add(-10 * time.Second)})
	if r, err := fresh.Read(context.Background(), "k", gap, Revalidate, counting(&n)); err != nil || r.Value != 7 || r.Stale != 0 || n.Load() != 0 {
		t.Fatalf("a fresh kept read: %d stale %s, %v, %d reads", r.Value, r.Stale, err, n.Load())
	}
	old := newPoller(c, false, kept{value: 7, at: c.Now().Add(-2 * gap)})
	r, err := old.Read(context.Background(), "k", gap, Revalidate, counting(&n))
	if err != nil || r.Value != 7 || r.Stale != 2*gap {
		t.Fatalf("an old kept read: %d stale %s, %v", r.Value, r.Stale, err)
	}
}

// blocking is a read that waits for its context or its release.
type blocking struct {
	started  chan struct{}
	release  chan struct{}
	finished atomic.Bool
}

func (b *blocking) fetch(ctx context.Context) (int, error) {
	close(b.started)
	select {
	case <-ctx.Done():
		return 0, ctx.Err()
	case <-b.release:
		b.finished.Store(true)
		return 42, nil
	}
}

func abandon(t *testing.T, p *Poller[int], b *blocking) {
	t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() {
		_, err := p.Read(ctx, "k", gap, Wait, b.fetch)
		done <- err
	}()
	<-b.started
	cancel()
	if err := <-done; !errors.Is(err, context.Canceled) {
		t.Fatalf("the leaving viewer got %v", err)
	}
}

// A read every viewer walked away from is cancelled and leaves no trace:
// the next viewer inside the gap sends a fresh read and gets no error.
func TestAbandonedReadLeavesNoTrace(t *testing.T) {
	c := start()
	p := newPoller(c, false, nil)
	abandon(t, p, &blocking{started: make(chan struct{}), release: make(chan struct{})})
	var n atomic.Int64
	var r Read[int]
	var err error
	for deadline := time.Now().Add(2 * time.Second); time.Now().Before(deadline); {
		if r, err = p.Read(context.Background(), "k", gap, Wait, counting(&n)); err == nil {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if err != nil || r.Value != 1 || r.Stale != 0 || p.Upstream() != 2 {
		t.Fatalf("after an abandoned read: %d stale %s, %v, %d reads sent", r.Value, r.Stale, err, p.Upstream())
	}
}

// With Outlive the read runs on for the key's other viewers when its
// viewer leaves, and the next viewer inside the gap shares it.
func TestOutliveKeepsTheRead(t *testing.T) {
	c := start()
	p := newPoller(c, true, nil)
	b := &blocking{started: make(chan struct{}), release: make(chan struct{})}
	abandon(t, p, b)
	close(b.release)
	var n atomic.Int64
	r, err := p.Read(context.Background(), "k", gap, Wait, counting(&n))
	if err != nil || r.Value != 42 || !b.finished.Load() || p.Upstream() != 1 {
		t.Fatalf("after the viewer left: %d, %v, finished %v, %d reads sent", r.Value, err, b.finished.Load(), p.Upstream())
	}
}
