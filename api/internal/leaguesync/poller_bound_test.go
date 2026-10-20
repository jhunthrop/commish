package leaguesync

import (
	"context"
	"sync/atomic"
	"testing"
	"time"
)

// hangingHost answers like countingHost, but while hold is set each read
// waits for release.
type hangingHost struct {
	countingHost
	hold    atomic.Bool
	release chan struct{}
}

func (h *hangingHost) Read(ctx context.Context, ref Ref) (Snapshot, error) {
	if h.hold.Load() {
		select {
		case <-h.release:
		case <-ctx.Done():
			return Snapshot{}, ctx.Err()
		}
	}
	return h.countingHost.Read(ctx, ref)
}

// A live view waits at most LiveWait for the platform (Lane 92 fix round
// 1, HIGH-1): with the platform hanging it answers the kept read with its
// own read time, never stalls the page, and the read still lands for the
// next view.
func TestPollerLiveWaitIsBounded(t *testing.T) {
	start := time.Date(2026, 10, 20, 0, 17, 0, 0, time.UTC)
	clock := &fakeClock{now: start}
	host := &hangingHost{release: make(chan struct{})}
	waited := make(chan time.Duration, 1)
	fired := make(chan time.Time)
	p := &Poller{Hosts: Hosts{host}, Store: &memorySnapshots{}, Now: clock.Now, Log: quietLog(),
		Live: func(context.Context, int) bool { return true },
		After: func(d time.Duration) <-chan time.Time {
			waited <- d
			return fired
		}}
	if _, err := p.Read(context.Background(), testRef); err != nil {
		t.Fatal(err)
	}
	clock.Advance(70 * time.Second)
	host.hold.Store(true)
	type answer struct {
		r   Read
		err error
	}
	got := make(chan answer, 1)
	go func() {
		r, err := p.Read(context.Background(), testRef)
		got <- answer{r, err}
	}()
	if d := <-waited; d != LiveWait {
		t.Fatalf("the live view waits %s, want %s", d, LiveWait)
	}
	close(fired) // the bound passes with the platform still hanging
	a := <-got
	if a.err != nil || !a.r.ReadAt.Equal(start) {
		t.Fatalf("past the bound the view answered %v at %v, want the kept read of %v", a.err, a.r.ReadAt, start)
	}
	// The read was left running: once the platform answers it lands.
	close(host.release)
	settle(t, p)
	if host.reads.Load() != 2 {
		t.Fatalf("%d reads reached the platform, want 2", host.reads.Load())
	}
	r, err := p.Read(context.Background(), testRef)
	if err != nil || !r.ReadAt.Equal(clock.Now()) {
		t.Fatalf("the next view read %v at %v, want the read that landed at %v", err, r.ReadAt, clock.Now())
	}
}

// A league never read has nothing to answer with: its live view waits for
// the read, as before.
func TestPollerLiveFirstReadWaits(t *testing.T) {
	clock := &fakeClock{now: time.Date(2026, 10, 20, 0, 17, 0, 0, time.UTC)}
	host := &countingHost{}
	p := newPoller(host, &memorySnapshots{}, clock)
	p.Live = func(context.Context, int) bool { return true }
	p.After = func(time.Duration) <-chan time.Time {
		t.Error("a first read started the bound")
		return nil
	}
	r, err := p.Read(context.Background(), testRef)
	if err != nil || r.Name != "League" {
		t.Fatalf("the first live read %v %+v", err, r)
	}
}
