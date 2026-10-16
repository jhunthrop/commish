package season

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"
)

// siteFacts is a fixed schedule and the seasons with a preseason board.
type siteFacts struct {
	kickoffs map[int]time.Time
	lastDays map[int]time.Time
	// weekEnds are each week's last game day, by season.
	weekEnds map[int][]time.Time
	boards   map[int]bool
	reads    int
	fail     error
}

func (f *siteFacts) FirstKickoff(_ context.Context, y int) (time.Time, bool, error) {
	f.reads++
	k, ok := f.kickoffs[y]
	return k, ok, f.fail
}

func (f *siteFacts) LastGameDay(_ context.Context, y int) (time.Time, bool, error) {
	d, ok := f.lastDays[y]
	return d, ok, f.fail
}

func (f *siteFacts) WeekAt(_ context.Context, y int, at time.Time) (int, bool, error) {
	for i, end := range f.weekEnds[y] {
		if at.Before(end.AddDate(0, 0, 1)) {
			return i + 1, true, f.fail
		}
	}
	return 0, false, f.fail
}

func (f *siteFacts) PreseasonBoard(_ context.Context, y int) (bool, error) {
	return f.boards[y], f.fail
}

// facts2026 is the 2026 schedule's shape: the opener on Wednesday
// 2026-09-09, week N's last game day the Monday N-1 weeks after
// 2026-09-14, week 18's on Sunday 2027-01-10; the 2026 board is out,
// the 2027 one only when board2027 says so.
func facts2026(t *testing.T, board2027 bool) *siteFacts {
	var ends []time.Time
	for w := range 17 {
		ends = append(ends, eastern(t, "2026-09-14 00:00").AddDate(0, 0, 7*w))
	}
	ends = append(ends, eastern(t, "2027-01-10 00:00"))
	return &siteFacts{
		kickoffs: map[int]time.Time{2026: eastern(t, "2026-09-09 20:20")},
		lastDays: map[int]time.Time{2026: eastern(t, "2027-01-10 00:00")},
		weekEnds: map[int][]time.Time{2026: ends},
		boards:   map[int]bool{2026: true, 2027: board2027},
	}
}

// Every boundary of the site's season (spec 2026-10-16 §1), at fixed
// times: before the opener is the preseason, the opener to the end of
// the last regular-season game day is in season, then the playoffs to
// the end of Super Bowl day five weeks later, then the offseason until
// the next season's first preseason board.
func TestSiteSeasonBoundaries(t *testing.T) {
	cases := []struct {
		name  string
		at    string
		board bool
		phase string
		week  int
	}{
		{"a minute before the opener", "2026-09-09 20:19", false, SitePreseason, 0},
		{"the opener's kickoff", "2026-09-09 20:20", false, SiteInSeason, 1},
		{"the Monday of week 1", "2026-09-14 23:59", false, SiteInSeason, 1},
		{"the Tuesday after week 1", "2026-09-15 00:00", false, SiteInSeason, 2},
		{"mid-October", "2026-10-15 12:00", false, SiteInSeason, 6},
		{"the last regular-season game day", "2027-01-10 23:59", false, SiteInSeason, 18},
		{"the next morning", "2027-01-11 00:00", false, SitePlayoffs, 19},
		{"wild-card Monday", "2027-01-18 22:00", false, SitePlayoffs, 19},
		{"the divisional round", "2027-01-23 16:00", false, SitePlayoffs, 20},
		{"the conference games", "2027-01-31 15:00", false, SitePlayoffs, 21},
		{"Super Bowl Sunday", "2027-02-14 18:30", false, SitePlayoffs, 22},
		{"the day after the Super Bowl", "2027-02-15 00:00", false, SiteOffseason, 0},
		{"February with the 2027 board out", "2027-02-20 12:00", true, SitePreseason, 0},
		{"February with no 2027 board", "2027-02-20 12:00", false, SiteOffseason, 0},
		{"March with no 2027 board", "2027-03-20 12:00", false, SiteOffseason, 0},
		{"March with the 2027 board out", "2027-03-20 12:00", true, SitePreseason, 0},
	}
	for _, c := range cases {
		got, err := SiteAt(context.Background(), facts2026(t, c.board), eastern(t, c.at))
		if err != nil {
			t.Fatalf("%s: %v", c.name, err)
		}
		if got.Phase != c.phase || got.Week != c.week {
			t.Errorf("%s: %s week %d (%q), want %s week %d", c.name, got.Phase, got.Week, got.Basis, c.phase, c.week)
		}
		if got.Basis == "" || strings.ContainsAny(got.Basis, ";—–") {
			t.Errorf("%s: basis %q", c.name, got.Basis)
		}
	}
}

// The preseason names the opener's day once the schedule is loaded, and
// carries the kickoff for the league phases to name.
func TestSiteSeasonNamesTheOpener(t *testing.T) {
	got, err := SiteAt(context.Background(), facts2026(t, false), eastern(t, "2026-08-20 12:00"))
	if err != nil || got.Phase != SitePreseason || !got.Opener.Equal(eastern(t, "2026-09-09 20:20")) ||
		got.Basis != "The 2026 boards are out and week 1 kicks off Wednesday, September 9." {
		t.Fatalf("%+v (%v)", got, err)
	}
}

// A moment the in-season schedule has no week for is an error, never
// "week 0 is under way".
func TestSiteSeasonWithNoWeekIsAnError(t *testing.T) {
	facts := facts2026(t, false)
	facts.weekEnds = map[int][]time.Time{}
	if got, err := SiteAt(context.Background(), facts, eastern(t, "2026-10-15 12:00")); err == nil {
		t.Fatalf("answered %+v", got)
	}
}

// With no schedule loaded for the season, the preseason board alone
// tells the preseason from the offseason, and the basis says so.
func TestSiteSeasonWithNoSchedule(t *testing.T) {
	facts := &siteFacts{boards: map[int]bool{2027: true}}
	got, err := SiteAt(context.Background(), facts, eastern(t, "2027-05-01 12:00"))
	if err != nil || got.Phase != SitePreseason || !strings.Contains(got.Basis, "schedule is not loaded") {
		t.Fatalf("%+v (%v)", got, err)
	}
}

// The answer is kept for an hour: one schedule read within it, a second
// after it; a failed read is not kept and answers the last good one.
func TestSiteSeasonIsKeptForAnHour(t *testing.T) {
	facts := facts2026(t, false)
	now := eastern(t, "2026-10-15 12:00")
	site := &Site{Facts: facts, Now: func() time.Time { return now }}
	first := site.Phase(context.Background())
	now = now.Add(59 * time.Minute)
	if again := site.Phase(context.Background()); again != first || facts.reads != 1 {
		t.Fatalf("within the hour: %+v after %d reads", again, facts.reads)
	}
	now = now.Add(2 * time.Minute)
	site.Phase(context.Background())
	if facts.reads != 2 {
		t.Fatalf("after the hour: %d reads, want 2", facts.reads)
	}
	facts.fail = errors.New("down")
	now = now.Add(2 * time.Hour)
	if kept := site.Phase(context.Background()); kept != first {
		t.Fatalf("a failed read answered %+v, want the last good %+v", kept, first)
	}
	reads := facts.reads
	now = now.Add(30 * time.Second)
	if kept := site.Phase(context.Background()); kept != first || facts.reads != reads {
		t.Fatalf("within a minute of a failure: %+v after %d more reads", kept, facts.reads-reads)
	}
	now = now.Add(time.Minute)
	site.Phase(context.Background())
	if facts.reads != reads+1 {
		t.Fatalf("a minute after a failure: %d more reads, want 1", facts.reads-reads)
	}
}
