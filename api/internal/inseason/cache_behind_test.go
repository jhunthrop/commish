package inseason

import (
	"context"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/jhunthrop/commish/api/internal/boards"
	"github.com/jhunthrop/commish/api/internal/draft"
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
	c.Drain()
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
	c.Drain()
	if n := reads.n.Load(); n != 2 {
		t.Fatalf("two requests past the TTL started %d refreshes", n-1)
	}
}

// movingCaptures is a capture store whose newest capture moves on: each
// capture lists p2 at its code, and his run under it starts at that
// capture unless it goes on from the one before. Its runs read is held
// while a gate is set.
type movingCaptures struct {
	countingReads
	mu     sync.Mutex
	newest time.Time
	code   string
	// started is when each status's run began.
	started map[string]time.Time
	gate    chan struct{}
}

func (r *movingCaptures) capture(at time.Time, code string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.newest, r.code = at, code
	if r.started == nil {
		r.started = map[string]time.Time{}
	}
	if _, ok := r.started[boards.StatusOf(code)]; !ok {
		r.started[boards.StatusOf(code)] = at
	}
}

func (r *movingCaptures) Designations(context.Context) (map[string]boards.Designation, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	return map[string]boards.Designation{"p2": {Code: r.code, AsOf: r.newest}}, nil
}

func (r *movingCaptures) DesignationRuns(context.Context, time.Time) (map[boards.RunKey]time.Time, error) {
	r.mu.Lock()
	gate, status, start := r.gate, boards.StatusOf(r.code), r.started[boards.StatusOf(r.code)]
	r.mu.Unlock()
	if gate != nil {
		<-gate
	}
	r.runs.Add(1)
	return map[boards.RunKey]time.Time{{PlayerID: "p2", Status: status}: start}, nil
}

// A status new this hour is never served without its date (Lane 112 fix
// round 1, HIGH-1). Friday's 16:00 capture rules p2 Out, Questionable at
// 15:00; while its dating is read behind, every request answers the 15:00
// pair (Questionable, dated), at once, and from the moment it lands the
// 16:00 pair (Out, listed at 16:00). On the week the turned page reads,
// past his club's last game, neither is ever carried over.
func TestANewStatusIsNeverServedUndated(t *testing.T) {
	friday := time.Date(2026, 10, 23, 15, 0, 0, 0, time.UTC)
	reads := &movingCaptures{}
	reads.capture(friday, "Q")
	clock := &lockedClock{now: friday.Add(time.Minute)}
	c := &Cache{Reads: reads, Now: clock.Now}
	ctx := context.Background()
	games := []boards.TeamWeek{
		{Team: "BUF", Week: 7, Kickoff: friday.Add(-5 * 24 * time.Hour), Final: true},
		{Team: "BUF", Week: 8, Kickoff: friday.Add(2 * 24 * time.Hour)},
	}
	p2 := Player{BoardID: "p2", Team: "BUF", Position: draft.WR}
	served := func(d map[string]boards.Designation) *Designation {
		return NewSeason(Data{Designations: d, Games: games}, Rules{}, 8, clock.Now()).Turned().designation(p2)
	}
	if d, err := c.DatedDesignations(ctx); err != nil || served(d).CarriedOver || served(d).Status != boards.StatusQuestionable {
		t.Fatalf("15:00: %+v %v", served(d), err)
	}
	reads.capture(friday.Add(time.Hour), "O")
	reads.mu.Lock()
	reads.gate = make(chan struct{})
	gate := reads.gate
	reads.mu.Unlock()
	clock.add(time.Hour)
	for i := 0; i < 3; i++ {
		done := make(chan map[string]boards.Designation, 1)
		go func() {
			d, _ := c.DatedDesignations(ctx)
			done <- d
		}()
		select {
		case d := <-done:
			if got := served(d); got == nil || got.CarriedOver || got.Listed == nil || got.Status != boards.StatusQuestionable {
				t.Fatalf("while 16:00 is dated: %+v, want the 15:00 pair", got)
			}
		case <-time.After(time.Second):
			t.Fatal("a request waited on the new capture's dating")
		}
	}
	close(gate)
	c.Drain()
	d, err := c.DatedDesignations(ctx)
	got := served(d)
	if err != nil || got.Status != boards.StatusOut || got.CarriedOver || got.Listed == nil || !got.Listed.Equal(friday.Add(time.Hour)) {
		t.Fatalf("after 16:00 is dated: %+v %v", got, err)
	}
}

// A refresh that fails keeps the value it was refreshing; the next read
// past the TTL tries again once RetryAfter has passed, not before.
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
	c.Drain()
	if _, err := c.Data(ctx, 2026); err != nil {
		t.Fatal(err)
	}
	c.Drain()
	if n := reads.lines.Load(); n != 2 {
		t.Fatalf("%d line reads inside RetryAfter, want the fill and one refresh", n)
	}
	clock.add(RetryAfter)
	if _, err := c.Data(ctx, 2026); err != nil {
		t.Fatal(err)
	}
	c.Drain()
	if n := reads.lines.Load(); n != 3 {
		t.Fatalf("%d line reads past RetryAfter, want a second refresh", n)
	}
}

// A refresh runs on the server's context, not the request's: a request
// that has ended does not stop it, and the server's shutdown does.
func TestARefreshRunsOnTheServersContext(t *testing.T) {
	server, shutdown := context.WithCancel(context.Background())
	c := &Cache{Reads: &blockingReads{}, Now: time.Now, Context: server, Timeout: time.Minute}
	c.entries = map[string]entry{"lines/2026": {value: []boards.StatLine{{PlayerID: "p1"}}, at: time.Now().Add(-SeasonTTL - time.Second)}}
	request, done := context.WithCancel(context.Background())
	if _, err := c.Data(request, 2026); err != nil {
		t.Fatal(err)
	}
	done()
	stopped := make(chan struct{})
	go func() {
		c.Drain()
		close(stopped)
	}()
	select {
	case <-stopped:
		t.Fatal("the refresh stopped with the request")
	case <-time.After(50 * time.Millisecond):
	}
	shutdown()
	select {
	case <-stopped:
	case <-time.After(time.Second):
		t.Fatal("shutdown did not stop the refresh")
	}
}
