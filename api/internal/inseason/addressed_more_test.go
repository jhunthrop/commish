package inseason

import (
	"testing"
	"time"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/boards"
)

// The arrival is the addressed week's first kickoff less the capture's
// lead, whatever day that falls on: a week opening on Saturday says
// Saturday's slot (Lane 95 review LOW-2).
func TestProjectionArrivesAtTheWeeksFirstSlot(t *testing.T) {
	f, data := turnFixture(t, mondayNight)
	saturday := time.Date(2026, 10, 24, 16, 30, 0, 0, east)
	games := append([]boards.TeamWeek(nil), data.Games...)
	for i := range games {
		if games[i].Week == 7 && games[i].Kickoff.Equal(weekSevenFirst) {
			games[i].Kickoff = saturday
		}
	}
	data.Games = games
	a, err := newAdvisor(f.league, data, boards.WeekProjection{}, nil, mondayNight, nil)
	if err != nil {
		t.Fatal(err)
	}
	got := a.turnTo(7, boards.WeekProjection{Week: 7}).projectionArrivesAt()
	if got == nil || !got.Equal(saturday.Add(-ProjectionCaptureLead)) {
		t.Fatalf("arrives %v, want Saturday's slot", got)
	}
}

// On the platform's own week with no projection read (a failed read on a
// Sunday morning), the page takes the season Gain order too, with at most
// one pickup, the first row worth making (Lane 95 review LOW-2).
func TestUnprojectedOwnWeekTakesTheSeasonOrder(t *testing.T) {
	s, _ := turnService(t, sundayMorning, false)
	s.Facts = weekFacts{data: s.Facts.(weekFacts).data, byWeek: map[int]boards.WeekProjection{}}
	w := decode[apitypes.WaiverAdvice](t, s, "waivers")
	if *w.ForWeek != 6 || w.PickupOrder != seasonOrder || w.Basis != UnprojectedOrderWords(6) {
		t.Fatalf("for %d order %s %q, want week 6 in the season order", *w.ForWeek, w.PickupOrder, w.Basis)
	}
	if len(w.Pickups) > 1 {
		t.Fatalf("%d pickups, want at most one", len(w.Pickups))
	}
	marked := 0
	for _, r := range w.Rows {
		if r.Pickup {
			marked++
		}
	}
	if marked != len(w.Pickups) {
		t.Fatalf("%d rows marked for %d pickups", marked, len(w.Pickups))
	}
}
