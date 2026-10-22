package inseason

import (
	"bytes"
	"context"
	"errors"
	"log/slog"
	"strings"
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
	// runsDown fails the runs read.
	runsDown bool
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
	gate, status, start, down := r.gate, boards.StatusOf(r.code), r.started[boards.StatusOf(r.code)], r.runsDown
	r.mu.Unlock()
	if gate != nil {
		<-gate
	}
	r.runs.Add(1)
	if down {
		return nil, errors.New("runs down")
	}
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
	// The cold read's dating lands behind it (Lane 129).
	c.refreshes.Wait()
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
	c.refreshes.Wait()
	d, err := c.DatedDesignations(ctx)
	got := served(d)
	if err != nil || got.Status != boards.StatusOut || got.CarriedOver || got.Listed == nil || !got.Listed.Equal(friday.Add(time.Hour)) {
		t.Fatalf("after 16:00 is dated: %+v %v", got, err)
	}
}

// A cold start whose dating read fails is never served as if dated (Lane
// 116, B91): the capture answers marked pending, so on a turned week past
// his club's last game p2's Out shows alone, neither listed nor carried
// over (never "still listed"). The failure stands DatingRetryAfter (Lane
// 129): the requests inside it answer pending at once and read nothing
// again; past it the next request starts one dating behind it, and once
// that lands he is Out, listed at its run's start, carried over from the
// game played after it.
func TestAColdStartsFailedDatingIsPendingUntilItLands(t *testing.T) {
	sunday := time.Date(2026, 10, 18, 17, 0, 0, 0, time.UTC)
	reads := &movingCaptures{runsDown: true}
	reads.capture(sunday.Add(-48*time.Hour), "O")
	reads.capture(sunday.Add(-24*time.Hour), "O")
	tuesday := sunday.Add(48 * time.Hour)
	clock := &lockedClock{now: tuesday}
	c := &Cache{Reads: reads, Now: clock.Now}
	ctx := context.Background()
	games := []boards.TeamWeek{
		{Team: "BUF", Week: 7, Kickoff: sunday, Final: true},
		{Team: "BUF", Week: 8, Kickoff: sunday.Add(7 * 24 * time.Hour)},
	}
	p2 := Player{BoardID: "p2", Team: "BUF", Position: draft.WR}
	served := func(d map[string]boards.Designation) *Designation {
		return NewSeason(Data{Designations: d, Games: games}, Rules{}, 8, tuesday).Turned().designation(p2)
	}
	d, err := c.DatedDesignations(ctx)
	got := served(d)
	if err != nil || got == nil || got.Status != boards.StatusOut || got.CarriedOver || got.Listed != nil {
		t.Fatalf("cold start, dating down: %+v %v, want Out alone", got, err)
	}
	if !d["p2"].DatingPending {
		t.Fatalf("cold start, dating down: %+v, want it marked pending", d["p2"])
	}
	c.refreshes.Wait()
	reads.mu.Lock()
	reads.runsDown = false
	reads.mu.Unlock()
	clock.add(DatingRetryAfter - time.Second)
	for i := 0; i < 5; i++ {
		if d, err = c.DatedDesignations(ctx); err != nil || !d["p2"].DatingPending {
			t.Fatalf("inside the retry: %+v %v, want it pending", d["p2"], err)
		}
	}
	c.refreshes.Wait()
	if n := reads.runs.Load(); n != 1 {
		t.Fatalf("%d runs reads inside DatingRetryAfter, want the failed one alone", n)
	}
	clock.add(time.Second)
	if d, err = c.DatedDesignations(ctx); err != nil || !d["p2"].DatingPending {
		t.Fatalf("the request that starts the retry: %+v %v, want it pending, not waiting", d["p2"], err)
	}
	c.refreshes.Wait()
	d, err = c.DatedDesignations(ctx)
	got = served(d)
	if err != nil || d["p2"].DatingPending || got == nil || !got.CarriedOver || got.Listed == nil || !got.Listed.Equal(sunday.Add(-48*time.Hour)) {
		t.Fatalf("once the retry lands: %+v %+v %v, want Out listed Friday, carried over", got, d["p2"], err)
	}
	if n := reads.runs.Load(); n != 2 {
		t.Fatalf("%d runs reads, want the failed one and the retry", n)
	}
}

// slowRuns is the production shape of the failure (Lane 129): the runs
// read takes longer than a request's read bound, and the capture read is
// quick.
type slowRuns struct {
	countingReads
	took time.Duration
}

func (r *slowRuns) DesignationRuns(ctx context.Context, newest time.Time) (map[boards.RunKey]time.Time, error) {
	select {
	case <-time.After(r.took):
	case <-ctx.Done():
		return nil, ctx.Err()
	}
	return r.countingReads.DesignationRuns(ctx, newest)
}

// A dating slower than the read bound never holds a request and still
// lands (Lane 129): the cold request answers the capture pending at once,
// the dating reads behind it under its own bound, and from then on every
// request answers the dated pair from the cache.
func TestASlowDatingNeverHoldsARequest(t *testing.T) {
	reads := &slowRuns{took: 300 * time.Millisecond}
	var logged bytes.Buffer
	c := &Cache{Reads: reads, Now: time.Now, Timeout: 100 * time.Millisecond, DatingTimeout: 5 * time.Second,
		Log: slog.New(slog.NewTextHandler(&logged, nil))}
	ctx := context.Background()
	start := time.Now()
	d, err := c.DatedDesignations(ctx)
	if took := time.Since(start); err != nil || took > 100*time.Millisecond || !d["p2"].DatingPending {
		t.Fatalf("cold: %+v %v in %v, want the capture pending at once", d["p2"], err, took)
	}
	c.refreshes.Wait()
	if strings.Contains(logged.String(), "not read") {
		t.Fatalf("the dating failed: %s", logged.String())
	}
	for i := 0; i < 3; i++ {
		start = time.Now()
		d, err = c.DatedDesignations(ctx)
		if took := time.Since(start); err != nil || took > 10*time.Millisecond || d["p2"].DatingPending || d["p2"].Since == nil {
			t.Fatalf("warm: %+v %v in %v, want the dated pair at once", d["p2"], err, took)
		}
	}
	if n := reads.runs.Load(); n != 1 {
		t.Fatalf("%d runs reads, want one", n)
	}
}

// A dated pair stands while its refresh fails, up to PairMaxAge: past it
// the newest capture answers pending, so a status never stays hours old
// behind a dating that keeps failing (Lane 129).
func TestAPairPastItsAgeGivesWayToTheNewestCapture(t *testing.T) {
	friday := time.Date(2026, 10, 23, 15, 0, 0, 0, time.UTC)
	reads := &movingCaptures{}
	reads.capture(friday, "Q")
	clock := &lockedClock{now: friday.Add(time.Minute)}
	c := &Cache{Reads: reads, Now: clock.Now}
	ctx := context.Background()
	if _, err := c.DatedDesignations(ctx); err != nil {
		t.Fatal(err)
	}
	c.refreshes.Wait()
	reads.mu.Lock()
	reads.runsDown = true
	reads.mu.Unlock()
	reads.capture(friday.Add(time.Hour), "O")
	clock.add(time.Hour)
	if d, err := c.DatedDesignations(ctx); err != nil || d["p2"].Code != "Q" || d["p2"].Listed == nil {
		t.Fatalf("an hour on, dating down: %+v %v, want the dated 15:00 pair", d["p2"], err)
	}
	c.refreshes.Wait()
	clock.add(PairMaxAge)
	d, err := c.DatedDesignations(ctx)
	if err != nil || d["p2"].Code != "O" || !d["p2"].DatingPending {
		t.Fatalf("past PairMaxAge, dating down: %+v %v, want the 16:00 capture pending", d["p2"], err)
	}
	c.refreshes.Wait()
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
	c.refreshes.Wait()
	if _, err := c.Data(ctx, 2026); err != nil {
		t.Fatal(err)
	}
	c.refreshes.Wait()
	if n := reads.lines.Load(); n != 2 {
		t.Fatalf("%d line reads inside RetryAfter, want the fill and one refresh", n)
	}
	clock.add(RetryAfter)
	if _, err := c.Data(ctx, 2026); err != nil {
		t.Fatal(err)
	}
	c.refreshes.Wait()
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
		c.refreshes.Wait()
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

// Once the server's context is done, or Drain has begun, a stale read
// starts no refresh: shutdown never waits on a refresh added while it
// waits (review LOW-R1-2), and the kept value still answers.
func TestNoRefreshStartsOnceShutdownBegins(t *testing.T) {
	for _, tc := range []struct {
		name  string
		begin func(c *Cache, shutdown context.CancelFunc)
	}{
		{"context done", func(_ *Cache, shutdown context.CancelFunc) { shutdown() }},
		{"draining", func(c *Cache, _ context.CancelFunc) { c.Drain() }},
	} {
		reads := &countingReads{}
		clock := &lockedClock{now: behindNoon}
		server, shutdown := context.WithCancel(context.Background())
		c := &Cache{Reads: reads, Now: clock.Now, Context: server}
		if _, err := c.Data(context.Background(), 2026); err != nil {
			t.Fatal(err)
		}
		tc.begin(c, shutdown)
		clock.add(SeasonTTL + time.Second)
		d, err := c.Data(context.Background(), 2026)
		if err != nil || len(d.Lines) != 1 {
			t.Fatalf("%s: %+v %v, want the kept value", tc.name, d, err)
		}
		c.refreshes.Wait()
		if n := reads.lines.Load(); n != 1 {
			t.Fatalf("%s: %d line reads, want no refresh", tc.name, n)
		}
		shutdown()
	}
}
