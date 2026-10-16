package season

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"
)

// The site's week turns at 00:00 Eastern Tuesday, the published board's
// only when the next board is out. In the gap the basis says the board is
// still last week's, and board_week carries the board's own week.
func TestSiteSeasonSaysWhenTheBoardLagsTheWeek(t *testing.T) {
	cases := []struct {
		name      string
		at        string
		boardWeek int // 0: the site shows the preseason board
		basis     string
	}{
		{"week 7 begun, board still week 6", "2026-10-20 00:00", 6,
			"Week 7 has begun. Our board is still the week 6 board until Tuesday's refresh."},
		{"the week 7 board is out", "2026-10-20 12:00", 7, "Week 7 of the 2026 NFL season is under way."},
		{"the last minute of week 6", "2026-10-19 23:59", 6, "Week 6 of the 2026 NFL season is under way."},
		{"a board two weeks behind", "2026-10-27 00:00", 6,
			"Week 8 has begun. Our board is still the week 6 board until Tuesday's refresh."},
		{"the preseason board is up", "2026-10-20 00:00", 0, "Week 7 of the 2026 NFL season is under way."},
	}
	for _, c := range cases {
		facts := facts2026(t, false)
		if c.boardWeek > 0 {
			facts.boardWeeks = map[int]int{2026: c.boardWeek}
		}
		got, err := SiteAt(context.Background(), facts, eastern(t, c.at))
		if err != nil || got.Phase != SiteInSeason {
			t.Fatalf("%s: %+v (%v)", c.name, got, err)
		}
		if got.Basis != c.basis || got.BoardWeek != c.boardWeek || strings.ContainsAny(got.Basis, ";—–") {
			t.Errorf("%s: basis %q board week %d, want %q and %d", c.name, got.Basis, got.BoardWeek, c.basis, c.boardWeek)
		}
	}
}

// Only the regular season names a board week.
func TestSiteSeasonOutsideTheSeasonHasNoBoardWeek(t *testing.T) {
	facts := facts2026(t, false)
	facts.boardWeeks = map[int]int{2026: 18}
	for _, at := range []string{"2026-08-20 12:00", "2027-01-20 12:00", "2027-03-20 12:00"} {
		got, err := SiteAt(context.Background(), facts, eastern(t, at))
		if err != nil || got.BoardWeek != 0 {
			t.Fatalf("%s: %+v (%v)", at, got, err)
		}
	}
}

// boardFails reads the schedule and fails the board.
type boardFails struct{ *siteFacts }

func (boardFails) BoardWeek(context.Context, int) (int, bool, error) {
	return 0, false, errors.New("down")
}

// A failed board read fails the season read, so the last good answer is
// served, never a basis that hides the gap.
func TestSiteSeasonBoardReadFailureIsAnError(t *testing.T) {
	facts := boardFails{facts2026(t, false)}
	if got, err := SiteAt(context.Background(), facts, eastern(t, "2026-10-20 00:00")); err == nil {
		t.Fatalf("answered %+v", got)
	}
}

const offseason2027 = "The 2026 season is over and the 2027 boards are not out yet."

// The Super Bowl is the schedule's own date when it carries the
// postseason, and the offseason basis says which.
func TestSiteSeasonReadsTheSuperBowl(t *testing.T) {
	facts := facts2026(t, false)
	// A schedule whose Super Bowl falls a week later than counted.
	facts.postseason = map[int]postseasonEnd{2026: {22, eastern(t, "2027-02-21 00:00")}}
	cases := []struct {
		name  string
		at    string
		phase string
	}{
		{"the counted Super Bowl Sunday", "2027-02-14 18:30", SitePlayoffs},
		{"the day after the counted one", "2027-02-15 00:00", SitePlayoffs},
		{"the read Super Bowl Sunday", "2027-02-21 23:59", SitePlayoffs},
		{"the day after the read one", "2027-02-22 00:00", SiteOffseason},
	}
	for _, c := range cases {
		got, err := SiteAt(context.Background(), facts, eastern(t, c.at))
		if err != nil || got.Phase != c.phase {
			t.Errorf("%s: %s (%v), want %s", c.name, got.Phase, err, c.phase)
		}
		if want := offseason2027 + " The Super Bowl was played on Sunday, February 21."; c.phase == SiteOffseason && got.Basis != want {
			t.Errorf("%s: basis %q", c.name, got.Basis)
		}
	}
}

// With no postseason in the schedule the Super Bowl is counted five weeks
// on, and the offseason basis says it is counted. A schedule that stops
// short of the final week counts too.
func TestSiteSeasonCountsTheSuperBowlWithoutAPostseason(t *testing.T) {
	const counted = offseason2027 +
		" The schedule does not carry the Super Bowl, so it is counted five weeks after the last regular-season game."
	cases := map[string]map[int]postseasonEnd{
		"none":        nil,
		"wild card":   {2026: {19, eastern(t, "2027-01-16 00:00")}},
		"conferences": {2026: {21, eastern(t, "2027-01-31 00:00")}},
	}
	for name, post := range cases {
		facts := facts2026(t, false)
		facts.postseason = post
		for at, phase := range map[string]string{"2027-02-14 18:30": SitePlayoffs, "2027-02-15 00:00": SiteOffseason} {
			got, err := SiteAt(context.Background(), facts, eastern(t, at))
			if err != nil || got.Phase != phase {
				t.Fatalf("%s at %s: %s (%v), want %s", name, at, got.Phase, err, phase)
			}
			if phase == SiteOffseason && got.Basis != counted {
				t.Errorf("%s: basis %q", name, got.Basis)
			}
		}
	}
}

// The offseason before the next opener says the same of the Super Bowl
// that closed the last season, and says nothing of one it knows nothing
// about.
func TestSiteSeasonOffseasonBasisInMarch(t *testing.T) {
	facts := facts2026(t, false)
	facts.postseason = map[int]postseasonEnd{2026: {22, eastern(t, "2027-02-14 00:00")}}
	got, err := SiteAt(context.Background(), facts, eastern(t, "2027-03-20 12:00"))
	want := offseason2027 + " The Super Bowl was played on Sunday, February 14."
	if err != nil || got.Phase != SiteOffseason || got.Basis != want {
		t.Fatalf("%+v (%v)", got, err)
	}
	empty := &siteFacts{boards: map[int]bool{}}
	got, err = SiteAt(context.Background(), empty, eastern(t, "2027-05-01 12:00"))
	if err != nil || got.Phase != SiteOffseason || got.Basis != offseason2027 {
		t.Fatalf("no schedule: %+v (%v)", got, err)
	}
}

var _ = time.Second
