package inseason

import (
	"testing"
	"time"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/boards"
	"github.com/jhunthrop/commish/api/internal/draft"
)

// The order offers no move for a free agent Waivers does not list (Lane
// 128): on injured reserve with no return week he is neither a row nor a
// stash there, so no Add opens Waivers on him; with a return week the
// Stash group holds him and he keeps Add.
func TestTheOrderOffersNoAddForAnUndatedIRFreeAgent(t *testing.T) {
	f := restOfSeasonFixture(t)
	f.data.Games = append(f.data.Games, game(7, "CLE", "CIN", time.Date(2026, 10, 25, 13, 0, 0, 0, east), false)...)
	f.data.Games = append(f.data.Games, game(8, "CLE", "CIN", time.Date(2026, 11, 1, 13, 0, 0, 0, east), false)...)
	asOf := fixtureNow.Add(-24 * time.Hour)
	// Two free backs (the fixture's extras): p180 on IR with no return
	// date, p185 on IR due back in week 8.
	f.data.Designations["p180"] = boards.Designation{Code: "IR", AsOf: asOf}
	f.data.Designations["p185"] = boards.Designation{Code: "IR", AsOf: asOf, ReturnOn: eastDay(time.October, 27)}
	a := newFixtureAdvisor(t, f, nil)
	out := a.Order(orderQuery{position: draft.RB, limit: MaxOrderRows}, a.tradeTargets)
	moves := map[string]*apitypes.OrderRowMove{}
	free := map[string]bool{}
	for _, row := range out.Rows {
		if id := row.Line.Player.BoardId; id != nil {
			moves[*id] = row.Move
			free[*id] = row.Roster != nil && row.Roster.Kind == apitypes.RosterMarkKindFree
		}
	}
	if !free["p180"] || moves["p180"] != nil {
		t.Fatalf("the undated IR free agent: free %v, move %v; want no move", free["p180"], moves["p180"])
	}
	if !free["p185"] || moves["p185"] == nil || *moves["p185"] != apitypes.OrderRowMoveAdd {
		t.Fatalf("the IR free agent due back: free %v, move %v; want Add", free["p185"], moves["p185"])
	}
	// A free back on no list keeps Add.
	for id, move := range moves {
		if free[id] && id != "p180" && id != "p185" && f.data.Designations[id].Code == "" && (move == nil || *move != apitypes.OrderRowMoveAdd) {
			t.Fatalf("free %s has move %v", id, move)
		}
	}
}
