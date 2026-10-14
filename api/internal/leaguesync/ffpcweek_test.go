package leaguesync

import (
	"context"
	"errors"
	"testing"
	"time"
)

type fixedWeeks struct {
	week int
	ok   bool
	err  error
}

func (f fixedWeeks) WeekAt(context.Context, int, time.Time) (int, bool, error) {
	return f.week, f.ok, f.err
}

// The current week is the run's, from its kickoffs; FFPC's own (6 in the
// capture) answers only when the run has none or cannot be read.
func TestFFPCWeekComesFromTheRun(t *testing.T) {
	l := fixtureLeagueRead(t)
	now := func() time.Time { return time.Date(2026, 10, 13, 14, 0, 0, 0, time.UTC) }
	cases := []struct {
		name  string
		weeks WeekSource
		want  int
	}{
		{"no run schedule", nil, 6},
		{"the run's week", fixedWeeks{week: 7, ok: true}, 7},
		{"the run has no week", fixedWeeks{}, 6},
		{"the run cannot be read", fixedWeeks{err: errors.New("down")}, 6},
	}
	for _, c := range cases {
		f := &FFPC{Weeks: c.weeks, Now: now, Log: quietLog()}
		if got := f.week(context.Background(), l); got != c.want {
			t.Fatalf("%s: week %d, want %d", c.name, got, c.want)
		}
	}
}

// A scoring page set to another week, or carrying another team's card,
// is not the member's score for this week.
func TestMemberScoreIsThisWeeksOwn(t *testing.T) {
	l := fixtureLeagueRead(t)
	if memberScore(l, 6) == nil {
		t.Fatal("week 6's own score was not taken")
	}
	if memberScore(l, 7) != nil {
		t.Fatal("week 6's score was taken for week 7")
	}
	other := *l.Scoreboard
	other.Team = "Huff N Puff Enthusiast"
	l.Scoreboard = &other
	if memberScore(l, 6) != nil {
		t.Fatal("another team's card was taken for the member's score")
	}
}
