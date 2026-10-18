package inseason

import (
	"context"
	"errors"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/jhunthrop/commish/api/internal/boards"
)

type countingReads struct {
	lines, games, designations, runs, gameFacts, projections atomic.Int32
	fail, failRuns                                           bool
}

func (r *countingReads) StatLines(context.Context, int) ([]boards.StatLine, error) {
	r.lines.Add(1)
	if r.fail {
		return nil, errors.New("down")
	}
	return []boards.StatLine{{PlayerID: "p1"}}, nil
}

func (r *countingReads) Schedule(context.Context, int) ([]boards.TeamWeek, error) {
	r.games.Add(1)
	return []boards.TeamWeek{{Team: "BUF"}}, nil
}

func (r *countingReads) Designations(context.Context) (map[string]boards.Designation, error) {
	r.designations.Add(1)
	time.Sleep(5 * time.Millisecond)
	return map[string]boards.Designation{"p1": {Code: "Q"}, "p2": {Code: "IR", AsOf: captureAt}}, nil
}

var captureAt = time.Date(2026, 10, 15, 11, 0, 0, 0, time.UTC)

func (r *countingReads) SeasonRuns(_ context.Context, newest time.Time) (map[boards.RunKey]time.Time, error) {
	r.runs.Add(1)
	if r.failRuns {
		return nil, errors.New("runs down")
	}
	return map[boards.RunKey]time.Time{{PlayerID: "p2", Status: boards.StatusInjuredReserve}: newest.Add(-time.Hour)}, nil
}

func (r *countingReads) GameFacts(context.Context, int) (map[boards.ClubWeek]boards.GameFact, error) {
	r.gameFacts.Add(1)
	return map[boards.ClubWeek]boards.GameFact{{Week: 7, Team: "BUF"}: {Venue: &boards.Venue{Roof: boards.RoofOutdoors}}}, nil
}

func (r *countingReads) WeekProjection(_ context.Context, _, week int) (boards.WeekProjection, error) {
	r.projections.Add(1)
	return boards.WeekProjection{Week: week, Players: map[string]boards.ProjectedPoints{"p1": {PPR: 12.5}}}, nil
}

// The week's projection is one read per week per TTL, and another week is
// its own read.
func TestCacheReadsTheProjectionOncePerWeekAndTTL(t *testing.T) {
	reads := &countingReads{}
	now := time.Date(2026, 10, 15, 12, 0, 0, 0, time.UTC)
	c := &Cache{Reads: reads, Now: func() time.Time { return now }}
	ctx := context.Background()
	for i := 0; i < 3; i++ {
		p, err := c.Projection(ctx, 2026, 6)
		if err != nil || p.Players["p1"].PPR != 12.5 {
			t.Fatalf("%+v %v", p, err)
		}
	}
	if _, err := c.Projection(ctx, 2026, 7); err != nil {
		t.Fatal(err)
	}
	if n := reads.projections.Load(); n != 2 {
		t.Fatalf("%d reads for two weeks inside the TTL", n)
	}
	now = now.Add(CaptureTTL + time.Second)
	if _, err := c.Projection(ctx, 2026, 6); err != nil || reads.projections.Load() != 3 {
		t.Fatalf("after the TTL: %d reads, %v", reads.projections.Load(), err)
	}
}

func TestCacheReadsOncePerTTL(t *testing.T) {
	reads := &countingReads{}
	now := time.Date(2026, 10, 15, 12, 0, 0, 0, time.UTC)
	var mu sync.Mutex
	c := &Cache{Reads: reads, Now: func() time.Time { mu.Lock(); defer mu.Unlock(); return now }}
	ctx := context.Background()
	var wg sync.WaitGroup
	for i := 0; i < 12; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if d, err := c.Data(ctx, 2026); err != nil || len(d.Lines) != 1 || len(d.Games) != 1 || len(d.Designations) != 2 || len(d.GameFacts) != 1 {
				t.Errorf("data %+v %v", d, err)
			}
		}()
	}
	wg.Wait()
	if reads.lines.Load() != 1 || reads.designations.Load() != 1 {
		t.Fatalf("twelve viewers read lines %d and captures %d times, want once", reads.lines.Load(), reads.designations.Load())
	}
	mu.Lock()
	now = now.Add(CaptureTTL + time.Second)
	mu.Unlock()
	if _, err := c.Data(ctx, 2026); err != nil {
		t.Fatal(err)
	}
	if reads.lines.Load() != 1 || reads.designations.Load() != 2 || reads.gameFacts.Load() != 2 {
		t.Fatalf("past the capture TTL: lines %d captures %d game facts %d, want 1, 2 and 2",
			reads.lines.Load(), reads.designations.Load(), reads.gameFacts.Load())
	}
	mu.Lock()
	now = now.Add(SeasonTTL)
	mu.Unlock()
	if _, err := c.Data(ctx, 2026); err != nil || reads.lines.Load() != 2 || reads.games.Load() != 2 {
		t.Fatalf("past the season TTL: lines %d games %d (%v)", reads.lines.Load(), reads.games.Load(), err)
	}
}

// The board route's designations are the in-season screens' read: one
// capture read and one dating read serve both within the TTL, and the
// screens' data carries each season-long status's start, so their chip
// says since when as the board's does (review 66n finding 3).
func TestCacheSharesTheCaptureRead(t *testing.T) {
	reads := &countingReads{}
	c := &Cache{Reads: reads, Now: time.Now}
	ctx := context.Background()
	data, err := c.Data(ctx, 2026)
	if err != nil {
		t.Fatal(err)
	}
	if since := data.Designations["p2"].Since; since == nil || !since.Equal(captureAt.Add(-time.Hour)) {
		t.Fatalf("the screens' designations undated: %+v", data.Designations)
	}
	d, err := c.DatedDesignations(ctx)
	if err != nil || d["p2"].Since == nil || !d["p2"].Since.Equal(captureAt.Add(-time.Hour)) || d["p1"].Since != nil {
		t.Fatalf("dated designations %+v %v", d, err)
	}
	if reads.designations.Load() != 1 || reads.runs.Load() != 1 {
		t.Fatalf("the board and the screens read the capture %d and the runs %d times, want once each",
			reads.designations.Load(), reads.runs.Load())
	}
}

// A dating read that fails answers the designations undated, never an
// error, and the screens' read is untouched.
func TestCacheDatingFailureAnswersUndated(t *testing.T) {
	reads := &countingReads{failRuns: true}
	c := &Cache{Reads: reads, Now: time.Now}
	d, err := c.DatedDesignations(context.Background())
	if err != nil || len(d) != 2 || d["p2"].Since != nil {
		t.Fatalf("designations %+v %v, want them undated", d, err)
	}
	if _, err := c.Data(context.Background(), 2026); err != nil {
		t.Fatal(err)
	}
}

func TestCacheKeepsNoFailure(t *testing.T) {
	reads := &countingReads{fail: true}
	c := &Cache{Reads: reads, Now: time.Now}
	if _, err := c.Data(context.Background(), 2026); err == nil {
		t.Fatal("a failed read answered")
	}
	if _, err := c.Data(context.Background(), 2026); err == nil || reads.lines.Load() != 2 {
		t.Fatalf("a failure was kept: %d reads", reads.lines.Load())
	}
}

type blockingReads struct{ countingReads }

func (*blockingReads) StatLines(ctx context.Context, _ int) ([]boards.StatLine, error) {
	<-ctx.Done()
	return nil, ctx.Err()
}

// A read that never answers errors within the timeout, even for a
// caller whose own context never ends.
func TestCacheReadTimesOut(t *testing.T) {
	c := &Cache{Reads: &blockingReads{}, Now: time.Now, Timeout: 50 * time.Millisecond}
	start := time.Now()
	_, err := c.Data(context.Background(), 2026)
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("err %v, want the deadline", err)
	}
	if took := time.Since(start); took > time.Second {
		t.Fatalf("took %v", took)
	}
	if (&Cache{}).timeout() != ReadTimeout {
		t.Fatal("no default timeout")
	}
}
