package draftroom

import (
	"testing"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/boards"
	"github.com/jhunthrop/commish/api/internal/mock"
	"github.com/jhunthrop/commish/api/internal/tenth"
)

// The pool's Gap (review 81 finding 2): drafters' ADP less his place on our
// board, the ADP the column prints less the place, so the row adds up as
// the board's Gap does. A player with no place (a kicker, a defense) or no
// ADP has none.
func TestThePoolsGapIsTheADPLessOurPlace(t *testing.T) {
	s := reportSettings(t)
	slots, err := mock.SlotConfig(s.League)
	if err != nil {
		t.Fatal(err)
	}
	b, err := boards.For(rawFor(s.Pool), 12, slots)
	if err != nil {
		t.Fatal(err)
	}
	ranks := boardRanks(b)
	carried, absent := 0, 0
	// A kicker and a defense are on the board with an ADP and no place: each must send no gap
	// (rereview 1), asserted directly rather than only through the count.
	market := map[apitypes.PlayerPosition]bool{}
	for _, p := range BoardView(b, nil).Players {
		if (p.Position == apitypes.PlayerPositionK || p.Position == apitypes.PlayerPositionDEF) && p.Adp != nil {
			if p.Gap != nil {
				t.Fatalf("%s %s: a gap %v", p.Position, p.Id, *p.Gap)
			}
			market[p.Position] = true
		}
		rank, ranked := ranks[p.Id]
		if !ranked || p.Adp == nil {
			if p.Gap != nil {
				t.Fatalf("%s: a gap %v with no place or no ADP", p.Id, *p.Gap)
			}
			absent++
			continue
		}
		want := tenth.Round(*p.Adp - float64(rank))
		if p.Gap == nil || *p.Gap != want || !isTenth(*p.Gap) {
			t.Fatalf("%s: ADP %v place %d gap %v, want %v", p.Id, *p.Adp, rank, p.Gap, want)
		}
		carried++
	}
	if !market[apitypes.PlayerPositionK] || !market[apitypes.PlayerPositionDEF] {
		t.Fatalf("the board holds a kicker %v and a defense %v with an ADP: the test needs both", market[apitypes.PlayerPositionK], market[apitypes.PlayerPositionDEF])
	}
	if carried == 0 || absent == 0 {
		t.Fatalf("%d players carry a gap and %d none: the test does not see both", carried, absent)
	}
}
