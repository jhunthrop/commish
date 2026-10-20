package inseason

import (
	"testing"

	"github.com/jhunthrop/commish/api/internal/boards"
)

// A starter in play adds the rest of his projection (round 2, L6): his
// Proj less his points so far, never below zero, at the live Sunday's
// fixed clock. h001 (CLE, in play) is the member's only starter not
// final, 50 points so far.
func TestProjectedFinalAddsTheRestOfAStarterInPlay(t *testing.T) {
	cases := []struct {
		name   string
		points *float64
		want   float64
	}{
		{"below his Proj", ptr(5), 57},  // 50 + (12.0 - 5.0)
		{"above his Proj", ptr(15), 50}, // 50 + 0
		// No points for him from the platform (team points alone): nothing more.
		{"no points by player", nil, 50},
	}
	for _, c := range cases {
		f, projection := liveFixture(t)
		projection.Players["p001"] = boards.ProjectedPoints{PPR: 12, Half: 12, Standard: 12}
		if c.points != nil {
			f.league.Snap.Matchups[0].PlayerPoints["h001"] = *c.points
		}
		s := liveService(t, f, projection)
		got := scoreboardOf(t, s).Games[0].Sides[0].ProjectedFinal
		if got == nil || *got != c.want {
			t.Errorf("%s: projected final %v, want %v", c.name, got, c.want)
		}
		if box := matchupOf(t, s); box.Sides[0].ProjectedFinal == nil || *box.Sides[0].ProjectedFinal != c.want {
			t.Errorf("%s: the Matchup's %v, want the bug's %v", c.name, box.Sides[0].ProjectedFinal, c.want)
		}
	}
}
