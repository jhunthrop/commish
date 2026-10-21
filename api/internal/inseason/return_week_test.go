package inseason

import (
	"testing"
	"time"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/boards"
	"github.com/jhunthrop/commish/api/internal/draft"
	"github.com/jhunthrop/commish/api/internal/scoring"
)

func eastDay(month time.Month, day int) *time.Time {
	at := time.Date(2026, month, day, 0, 0, 0, 0, east)
	return &at
}

// The return week is the first week whose last game day is on or after
// the provider's return date (Lane 110, B79): a Tuesday is the coming
// week's, a game day its own week's, the day after a week's last game the
// next week's, a date past the schedule none.
func TestReturnWeekIsTheWeekItsDateFallsIn(t *testing.T) {
	// The fixture's last game days: week 2 Sunday Sep 20, week 3 Thursday Sep 24.
	s := fixtureSeason(time.Date(2026, 9, 19, 12, 0, 0, 0, east))
	for _, tc := range []struct {
		name string
		on   *time.Time
		want int
	}{
		{"a Tuesday before week 2", eastDay(time.September, 15), 2},
		{"week 2's own Sunday", eastDay(time.September, 20), 2},
		{"the Monday after week 2", eastDay(time.September, 21), 3},
		{"week 3's Thursday", eastDay(time.September, 24), 3},
	} {
		got := s.returnWeek(tc.on)
		if got == nil || *got != tc.want {
			t.Errorf("%s: week %v, want %d", tc.name, got, tc.want)
		}
	}
	if got := s.returnWeek(eastDay(time.September, 25)); got != nil {
		t.Errorf("a date past the schedule's last week is week %d, want none", *got)
	}
	if got := s.returnWeek(nil); got != nil {
		t.Errorf("no date is week %d, want none", *got)
	}
}

// A designation the player list dates carries its week through the
// facts; the host's own IR mark and an undated designation carry none.
func TestTheFactsCarryTheReturnWeek(t *testing.T) {
	data := Data{Games: fixtureGames(), Designations: map[string]boards.Designation{
		"mia-wr": {Code: "IR", AsOf: time.Date(2026, 9, 19, 14, 0, 0, 0, time.UTC), ReturnOn: eastDay(time.September, 22)},
		"buf-rb": {Code: "IR", AsOf: time.Date(2026, 9, 19, 14, 0, 0, 0, time.UTC)},
	}}
	s := NewSeason(data, RulesOf(scoring.Standard()), 2, time.Date(2026, 9, 19, 12, 0, 0, 0, east))
	dated := s.For(Player{BoardID: "mia-wr", Team: "MIA", Position: draft.WR}).Designation
	if dated == nil || dated.ReturnWeek == nil || *dated.ReturnWeek != 3 {
		t.Fatalf("the dated IR %+v, want week 3", dated)
	}
	if undated := s.For(Player{BoardID: "buf-rb", Team: "BUF", Position: draft.RB}).Designation; undated == nil || undated.ReturnWeek != nil {
		t.Fatalf("the undated IR %+v, want no week", undated)
	}
	host := s.For(Player{BoardID: "nobody", Team: "NE", Position: draft.WR, HostIR: true, ReadAt: time.Now()}).Designation
	if host == nil || host.ReturnWeek != nil {
		t.Fatalf("the host's IR mark %+v, want no week", host)
	}
}

// Through the engine: the member's injured starter's row on Waivers says
// the week he is due back, and a free agent's undated IR says none.
func TestWaiversRowsCarryTheReturnWeek(t *testing.T) {
	f, projection := liveFixture(t)
	// Two weeks after the fixture's week 6, so a return date has a week ahead.
	f.data.Games = append(f.data.Games, game(7, "CLE", "CIN", time.Date(2026, 10, 25, 13, 0, 0, 0, east), false)...)
	f.data.Games = append(f.data.Games, game(8, "CLE", "CIN", time.Date(2026, 11, 1, 13, 0, 0, 0, east), false)...)
	asOf := liveSunday.Add(-6 * time.Hour)
	f.data.Designations = map[string]boards.Designation{
		"p001": {Code: "IR", AsOf: asOf, ReturnOn: eastDay(time.October, 27)},
		"p002": {Code: "IR", AsOf: asOf},
	}
	s := liveService(t, f, projection)
	w := decode[apitypes.WaiverAdvice](t, s, "waivers")
	weeks := map[string]*int{}
	found := map[string]bool{}
	for _, l := range w.Roster {
		if l.Player.BoardId != nil && l.Facts.Designation != nil {
			weeks[*l.Player.BoardId], found[*l.Player.BoardId] = l.Facts.Designation.ReturnWeek, true
		}
	}
	if !found["p001"] || weeks["p001"] == nil || *weeks["p001"] != 8 {
		t.Fatalf("p001's return week %v (listed %v), want 8: Oct 27 falls in week 8", weeks["p001"], found["p001"])
	}
	if !found["p002"] || weeks["p002"] != nil {
		t.Fatalf("p002's return week %v (listed %v), want none for an undated IR", weeks["p002"], found["p002"])
	}
}
