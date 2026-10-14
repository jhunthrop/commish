package season

import (
	"bytes"
	"context"
	"log/slog"
	"strings"
	"testing"
	"time"
)

type schedule struct {
	kickoffs map[int]time.Time
}

func (s schedule) FirstKickoff(_ context.Context, y int) (time.Time, bool, error) {
	k, ok := s.kickoffs[y]
	return k, ok, nil
}

func eastern(t *testing.T, s string) time.Time {
	v, err := time.ParseInLocation("2006-01-02 15:04", s, Eastern())
	if err != nil {
		t.Fatal(err)
	}
	return v
}

// The pass is sold for the current season until its first game kicks
// off, read from the schedule in Eastern time, then for the next.
func TestSaleSeason(t *testing.T) {
	opener := eastern(t, "2026-09-09 20:20") // SEA v NE, the 2026 opener
	sale := &Sale{Schedule: schedule{kickoffs: map[int]time.Time{2026: opener}}}
	cases := []struct {
		name string
		at   time.Time
		want int
	}{
		{"the day before", eastern(t, "2026-09-08 20:20"), 2026},
		{"a minute before kickoff", eastern(t, "2026-09-09 20:19"), 2026},
		{"the kickoff instant", opener, 2027},
		{"the day after", eastern(t, "2026-09-10 20:20"), 2027},
		{"mid-October", eastern(t, "2026-10-13 12:00"), 2027},
		{"February, still season 2026 by Of", eastern(t, "2027-02-20 12:00"), 2027},
	}
	for _, c := range cases {
		if got := sale.Season(context.Background(), c.at); got != c.want {
			t.Errorf("%s: season %d, want %d", c.name, got, c.want)
		}
	}
	if got := End(sale.Season(context.Background(), eastern(t, "2026-10-13 12:00"))); !got.Equal(time.Date(2028, 3, 1, 0, 0, 0, 0, time.UTC)) {
		t.Errorf("the 2027 pass ends %s, want 2028-03-01", got)
	}
}

// With the season's schedule not loaded, the Thursday after Labor Day at
// 00:00 UTC stands in, and the stand-in is logged once.
func TestSaleFallback(t *testing.T) {
	var logs bytes.Buffer
	sale := &Sale{Schedule: schedule{}, Log: slog.New(slog.NewTextHandler(&logs, nil))}
	if !FallbackKickoff(2027).Equal(time.Date(2027, 9, 9, 0, 0, 0, 0, time.UTC)) {
		t.Fatalf("fallback 2027 = %s", FallbackKickoff(2027))
	}
	before := time.Date(2027, 9, 8, 23, 0, 0, 0, time.UTC)
	after := time.Date(2027, 9, 9, 0, 0, 0, 0, time.UTC)
	if got := sale.Season(context.Background(), before); got != 2027 {
		t.Errorf("before the fallback: %d", got)
	}
	if got := sale.Season(context.Background(), after); got != 2028 {
		t.Errorf("at the fallback: %d", got)
	}
	if n := strings.Count(logs.String(), "level=WARN"); n != 1 {
		t.Errorf("logged %d times, want once:\n%s", n, logs.String())
	}
}

// countingSchedule counts its reads and has no season loaded.
type countingSchedule struct{ reads int }

func (c *countingSchedule) FirstKickoff(context.Context, int) (time.Time, bool, error) {
	c.reads++
	return time.Time{}, false, nil
}

// The fallback is kept: with the schedule not loaded, requests inside
// the retry window do not read it again, and the first one after does.
func TestSaleKeepsTheFallback(t *testing.T) {
	sched := &countingSchedule{}
	clock := time.Date(2027, 8, 1, 12, 0, 0, 0, time.UTC)
	sale := &Sale{Schedule: sched}
	for range 50 {
		if got := sale.Season(context.Background(), clock); got != 2027 {
			t.Fatalf("season %d", got)
		}
	}
	if sched.reads != 1 {
		t.Fatalf("%d schedule reads inside the window, want 1", sched.reads)
	}
	clock = clock.Add(fallbackRetry)
	sale.Season(context.Background(), clock)
	if sched.reads != 2 {
		t.Fatalf("%d schedule reads after the window, want 2", sched.reads)
	}
}
