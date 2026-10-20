package inseason

import (
	"testing"
	"time"

	"github.com/jhunthrop/commish/api/internal/boards"
)

// A starter still to play with no Proj leaves the side with no projected
// final (fix round 1, MEDIUM-4): a figure that counted him as nothing
// would read low all afternoon.
func TestProjectedFinalNeedsEveryStarterStillToPlay(t *testing.T) {
	f, projection := liveFixture(t)
	delete(projection.Players, "p015") // h015 (DEN) plays Monday night
	s := liveService(t, f, projection)
	game := scoreboardOf(t, s).Games[0]
	if got := game.Sides[1].ProjectedFinal; got != nil {
		t.Errorf("the opponent with an unprojected starter to play has a projected final %v", *got)
	}
	if got := game.Sides[0].ProjectedFinal; got == nil || *got != 50 {
		t.Errorf("the member, nothing to play, %v, want 50", got)
	}
	box := matchupOf(t, s)
	if got := box.Sides[1].ProjectedFinal; got != nil {
		t.Errorf("the Matchup's opponent %v, want none like the bug", *got)
	}
}

// A side none of whose starters has kicked off, in a game under way, has
// its projected final: its Proj, so the card's two figures are both drawn.
// The Lineup's figure is the bug's: the lineup as set and its score (fix
// round 1, MEDIUM-5).
func TestProjectedFinalOnceTheGameHasStarted(t *testing.T) {
	f, projection := liveFixture(t)
	projection.Players["p001"] = boards.ProjectedPoints{PPR: 12, Half: 12, Standard: 12}
	sunday := time.Date(2026, 10, 18, 13, 0, 0, 0, east)
	monday := time.Date(2026, 10, 19, 20, 15, 0, 0, east)
	for i, g := range f.data.Games {
		if g.Week != 6 {
			continue
		}
		// Team 2's DAL and DEN back to Sunday, final; team 1's CLE to Monday night.
		switch g.Team {
		case "DAL", "DEN":
			f.data.Games[i].Kickoff, f.data.Games[i].Final = sunday, true
		case "CIN", "CLE":
			f.data.Games[i].Kickoff, f.data.Games[i].Final = monday, false
		}
	}
	s := liveService(t, f, projection)
	game := scoreboardOf(t, s).Games[0]
	mine := game.Sides[0].ProjectedFinal
	if mine == nil || *mine != 62 {
		t.Fatalf("the member's projected final %v, want 50 so far plus h001's 12.0", mine)
	}
	if lineup := lineupOf(t, s); lineup.ProjectedFinal == nil || *lineup.ProjectedFinal != *mine {
		t.Errorf("the Lineup's projected final %v, the bug's %v", lineup.ProjectedFinal, *mine)
	}
}
