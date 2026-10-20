package inseason

import (
	"context"
	"testing"
	"time"

	"github.com/jhunthrop/commish/api/internal/boards"
)

// The live window (Lane 92, B06) is a game kicked off with no final held,
// by the one game state, inside LiveSpan: Monday night's game is live,
// Sunday's finals and Thursday's next game are not, and a game whose
// final the status missed stops being live after LiveSpan.
func TestLiveWindowIsAGameUnderWay(t *testing.T) {
	monday := time.Date(2026, 10, 19, 19, 15, 0, 0, east)
	now := monday.Add(20 * time.Minute)
	sunday := time.Date(2026, 10, 18, 13, 0, 0, 0, east)
	thursday := time.Date(2026, 10, 22, 20, 15, 0, 0, east)
	cases := []struct {
		name  string
		games []boards.TeamWeek
		at    time.Time
		want  bool
	}{
		{"Monday night under way", []boards.TeamWeek{{Kickoff: sunday, Final: true}, {Kickoff: monday}}, now, true},
		{"every game final", []boards.TeamWeek{{Kickoff: sunday, Final: true}, {Kickoff: monday, Final: true}}, now, false},
		{"the next game still to come", []boards.TeamWeek{{Kickoff: sunday, Final: true}, {Kickoff: thursday}}, now, false},
		{"a missed final past the span", []boards.TeamWeek{{Kickoff: monday}}, monday.Add(LiveSpan), false},
	}
	for _, c := range cases {
		if got := liveAt(c.games, c.at); got != c.want {
			t.Errorf("%s: live %v, want %v", c.name, got, c.want)
		}
	}
}

// The cache answers the window from the schedule it keeps, one read per
// TTL, at its own clock.
type scheduleReads struct {
	countingReads
	games []boards.TeamWeek
}

func (r *scheduleReads) Schedule(context.Context, int) ([]boards.TeamWeek, error) {
	r.countingReads.games.Add(1)
	return r.games, nil
}

func TestCacheLiveReadsTheKeptSchedule(t *testing.T) {
	kickoff := time.Date(2026, 10, 19, 19, 15, 0, 0, east)
	reads := &scheduleReads{games: []boards.TeamWeek{{Team: "SF", Kickoff: kickoff}}}
	now := kickoff.Add(-time.Minute)
	c := &Cache{Reads: reads, Now: func() time.Time { return now }}
	if c.Live(context.Background(), 2026) {
		t.Error("live a minute before kickoff")
	}
	now = kickoff.Add(time.Minute)
	if !c.Live(context.Background(), 2026) {
		t.Error("not live a minute after kickoff")
	}
	if got := reads.countingReads.games.Load(); got != 1 {
		t.Errorf("%d schedule reads, want 1 inside the TTL", got)
	}
}
