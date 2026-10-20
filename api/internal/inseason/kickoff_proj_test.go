package inseason

import (
	"testing"
	"time"

	"github.com/jhunthrop/commish/api/internal/boards"
)

// A row whose game has kicked off keeps its Proj as of kickoff (Lane 92,
// B27): Monday's snapshot moves h001's projection after his Sunday game
// started, and his row keeps Thursday's; h015, still to play Monday
// night, reads the newest.
func TestRowProjectionIsAsOfKickoff(t *testing.T) {
	f, thursday := liveFixture(t)
	thursday.Players["p001"] = boards.ProjectedPoints{PPR: 12.04, Half: 11, Standard: 10}
	monday := boards.WeekProjection{ReadAt: time.Date(2026, 10, 19, 18, 0, 0, 0, east),
		Players: map[string]boards.ProjectedPoints{
			"p001": {PPR: 30, Half: 30, Standard: 30},
			"p015": {PPR: 21.04, Half: 20, Standard: 19},
		},
		Kickers: thursday.Kickers, Defenses: thursday.Defenses, Previous: &thursday,
		Earlier: []boards.WeekProjection{thursday}}
	s := liveService(t, f, monday)
	box := matchupOf(t, s)
	proj := map[string]*float64{}
	delta := map[string]*float64{}
	for _, side := range box.Sides {
		for _, st := range side.Starters {
			proj[st.Line.Player.HostId], delta[st.Line.Player.HostId] = st.Line.WeekProjection, st.Line.ProjectionDelta
		}
	}
	if got := proj["h001"]; got == nil || *got != 12 {
		t.Errorf("h001, kicked off Sunday, Proj %v, want 12.0 as of kickoff", got)
	}
	if got := delta["h001"]; got != nil {
		t.Errorf("h001's change %v: the snapshot as of kickoff has none before it", *got)
	}
	if got := proj["h015"]; got == nil || *got != 21 {
		t.Errorf("h015, still to play, Proj %v, want the newest 21.0", got)
	}
	if got := delta["h015"]; got == nil || *got != 3 {
		t.Errorf("h015's change %v, want 3.0 since Thursday", got)
	}
}
