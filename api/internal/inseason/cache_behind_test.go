package inseason

import (
	"context"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/jhunthrop/commish/api/internal/boards"
)

// gatedReads answers each projection read with its own number, holding
// the read while a gate is set until it is closed.
type gatedReads struct {
	countingReads
	mu   sync.Mutex
	gate chan struct{}
	n    atomic.Int32
}

func (r *gatedReads) hold() chan struct{} {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.gate = make(chan struct{})
	return r.gate
}

func (r *gatedReads) WeekProjection(_ context.Context, _, week int) (boards.WeekProjection, error) {
	r.mu.Lock()
	gate := r.gate
	r.mu.Unlock()
	if gate != nil {
		<-gate
	}
	n := r.n.Add(1)
	return boards.WeekProjection{Week: week, Players: map[string]boards.ProjectedPoints{"p1": {PPR: float64(n)}}}, nil
}

// answersWithin runs read in the background and reports its answer, or
// false when it has not answered within wait.
func answersWithin(t *testing.T, wait time.Duration, read func() (boards.WeekProjection, error)) (boards.WeekProjection, bool) {
	t.Helper()
	done := make(chan boards.WeekProjection, 1)
	go func() {
		p, err := read()
		if err != nil {
			t.Errorf("read: %v", err)
		}
		done <- p
	}()
	select {
	case p := <-done:
		return p, true
	case <-time.After(wait):
		return boards.WeekProjection{}, false
	}
}

// lockedClock is a fixed clock a test moves while reads run.
type lockedClock struct {
	mu  sync.Mutex
	now time.Time
}

func (c *lockedClock) Now() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.now
}

func (c *lockedClock) add(d time.Duration) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.now = c.now.Add(d)
}

var behindNoon = time.Date(2026, 10, 18, 12, 0, 0, 0, time.UTC)

// Past its TTL a kept read answers at once with the value kept while one
// refresh runs behind it, and the next read after that refresh answers
// the refreshed value (Lane 112 ruling 2).
func TestCacheServesTheKeptValueDuringARefresh(t *testing.T) {
	reads := &gatedReads{}
	clock := &lockedClock{now: behindNoon}
	c := &Cache{Reads: reads, Now: clock.Now}
	ctx := context.Background()
	if p, err := c.Projection(ctx, 2026, 7); err != nil || p.Players["p1"].PPR != 1 {
		t.Fatalf("first fill %+v %v", p, err)
	}
	clock.add(CaptureTTL + time.Second)
	gate := reads.hold()
	for i := 0; i < 3; i++ {
		p, ok := answersWithin(t, time.Second, func() (boards.WeekProjection, error) { return c.Projection(ctx, 2026, 7) })
		if !ok {
			t.Fatal("a read past the TTL waited on the refresh")
		}
		if p.Players["p1"].PPR != 1 {
			t.Fatalf("during the refresh: %+v, want the kept value", p)
		}
	}
	close(gate)
	c.refreshes.Wait()
	if n := reads.n.Load(); n != 2 {
		t.Fatalf("%d reads, want the fill and one refresh", n)
	}
	if p, err := c.Projection(ctx, 2026, 7); err != nil || p.Players["p1"].PPR != 2 {
		t.Fatalf("after the refresh %+v %v", p, err)
	}
}

// A read with nothing kept waits for the fill.
func TestCacheWaitsWhenNothingIsKept(t *testing.T) {
	reads := &gatedReads{}
	c := &Cache{Reads: reads, Now: time.Now}
	gate := reads.hold()
	done := make(chan boards.WeekProjection, 1)
	go func() {
		p, _ := c.Projection(context.Background(), 2026, 7)
		done <- p
	}()
	select {
	case p := <-done:
		t.Fatalf("answered %+v before the fill", p)
	case <-time.After(50 * time.Millisecond):
	}
	close(gate)
	if p := <-done; p.Players["p1"].PPR != 1 {
		t.Fatalf("after the fill %+v", p)
	}
}

// Two requests at once with nothing kept start one fill, and two past
// the TTL start one refresh.
func TestCacheStartsOneFillAndOneRefresh(t *testing.T) {
	reads := &gatedReads{}
	clock := &lockedClock{now: behindNoon}
	c := &Cache{Reads: reads, Now: clock.Now}
	ctx := context.Background()
	gate := reads.hold()
	var wg sync.WaitGroup
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if p, err := c.Projection(ctx, 2026, 7); err != nil || p.Players["p1"].PPR != 1 {
				t.Errorf("fill %+v %v", p, err)
			}
		}()
	}
	time.Sleep(20 * time.Millisecond)
	close(gate)
	wg.Wait()
	if n := reads.n.Load(); n != 1 {
		t.Fatalf("two requests started %d fills", n)
	}
	clock.add(CaptureTTL + time.Second)
	gate = reads.hold()
	for i := 0; i < 2; i++ {
		if _, err := c.Projection(ctx, 2026, 7); err != nil {
			t.Fatal(err)
		}
	}
	close(gate)
	c.refreshes.Wait()
	if n := reads.n.Load(); n != 2 {
		t.Fatalf("two requests past the TTL started %d refreshes", n-1)
	}
}

// movingCaptures is a capture store whose newest capture moves on, its
// runs read held while a gate is set.
type movingCaptures struct {
	countingReads
	mu     sync.Mutex
	newest time.Time
	gate   chan struct{}
}

func (r *movingCaptures) Designations(context.Context) (map[string]boards.Designation, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	return map[string]boards.Designation{"p2": {Code: "IR", AsOf: r.newest}}, nil
}

func (r *movingCaptures) DesignationRuns(_ context.Context, newest time.Time) (map[boards.RunKey]time.Time, error) {
	r.mu.Lock()
	gate := r.gate
	r.mu.Unlock()
	if gate != nil {
		<-gate
	}
	r.runs.Add(1)
	return map[boards.RunKey]time.Time{{PlayerID: "p2", Status: boards.StatusInjuredReserve}: newest.Add(-time.Hour)}, nil
}

// An hourly capture never makes a request wait on its dating: the newer
// capture is dated by the runs kept while its own are read behind, then
// by its own.
func TestCacheDatesANewerCaptureByTheKeptRuns(t *testing.T) {
	reads := &movingCaptures{newest: captureAt}
	clock := &lockedClock{now: captureAt.Add(time.Minute)}
	c := &Cache{Reads: reads, Now: clock.Now}
	ctx := context.Background()
	if d, err := c.DatedDesignations(ctx); err != nil || !d["p2"].Since.Equal(captureAt.Add(-time.Hour)) {
		t.Fatalf("first read %+v %v", d, err)
	}
	reads.mu.Lock()
	reads.newest, reads.gate = captureAt.Add(time.Hour), make(chan struct{})
	gate := reads.gate
	reads.mu.Unlock()
	clock.add(CaptureTTL + time.Second)
	// The capture's own refresh lands first, behind its kept read.
	if _, err := c.Designations(ctx); err != nil {
		t.Fatal(err)
	}
	c.refreshes.Wait()
	done := make(chan map[string]boards.Designation, 1)
	go func() {
		d, _ := c.DatedDesignations(ctx)
		done <- d
	}()
	select {
	case d := <-done:
		if since := d["p2"].Since; since == nil || !since.Equal(captureAt.Add(-time.Hour)) {
			t.Fatalf("the newer capture dated %+v, want the kept run's start", d["p2"])
		}
	case <-time.After(time.Second):
		t.Fatal("the newer capture waited on its runs")
	}
	close(gate)
	c.refreshes.Wait()
	d, err := c.DatedDesignations(ctx)
	if err != nil || !d["p2"].Since.Equal(captureAt) || reads.runs.Load() != 2 {
		t.Fatalf("after its runs landed %+v %v, %d runs reads", d["p2"], err, reads.runs.Load())
	}
}

// A refresh that fails keeps the value it was refreshing, and the next
// read past the TTL tries again.
func TestCacheKeepsTheValueWhenARefreshFails(t *testing.T) {
	reads := &countingReads{}
	clock := &lockedClock{now: behindNoon}
	c := &Cache{Reads: reads, Now: clock.Now}
	ctx := context.Background()
	if _, err := c.Data(ctx, 2026); err != nil {
		t.Fatal(err)
	}
	clock.add(SeasonTTL + time.Second)
	reads.fail = true
	d, err := c.Data(ctx, 2026)
	if err != nil || len(d.Lines) != 1 {
		t.Fatalf("past the TTL with the store down: %+v %v", d, err)
	}
	c.refreshes.Wait()
	if _, err := c.Data(ctx, 2026); err != nil {
		t.Fatal(err)
	}
	c.refreshes.Wait()
	if n := reads.lines.Load(); n != 3 {
		t.Fatalf("%d line reads, want the fill and two refresh attempts", n)
	}
}
