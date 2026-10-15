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
	lines, games, designations atomic.Int32
	fail                       bool
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
	return map[string]boards.Designation{"p1": {Code: "Q"}}, nil
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
			if d, err := c.Data(ctx, 2026); err != nil || len(d.Lines) != 1 || len(d.Games) != 1 || len(d.Designations) != 1 {
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
	if reads.lines.Load() != 1 || reads.designations.Load() != 2 {
		t.Fatalf("past the capture TTL: lines %d captures %d, want 1 and 2", reads.lines.Load(), reads.designations.Load())
	}
	mu.Lock()
	now = now.Add(SeasonTTL)
	mu.Unlock()
	if _, err := c.Data(ctx, 2026); err != nil || reads.lines.Load() != 2 || reads.games.Load() != 2 {
		t.Fatalf("past the season TTL: lines %d games %d (%v)", reads.lines.Load(), reads.games.Load(), err)
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
