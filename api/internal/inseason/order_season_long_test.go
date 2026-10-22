package inseason

import (
	"testing"
	"time"

	"github.com/jhunthrop/commish/api/internal/boards"
	"github.com/jhunthrop/commish/api/internal/draft"
)

// The in-season order never ranks a player on a season-long list as
// playing (the 2026-10-16 ruling, Lane 128 fix round 1): at a position and
// across positions he comes after every available player, numbered on
// from them, his line unranked and his value unchanged. A week's
// designation moves nothing.
func TestTheOrderPlacesSeasonLongPlayersAfterTheAvailable(t *testing.T) {
	f := restOfSeasonFixture(t)
	asOf := fixtureNow.Add(-24 * time.Hour)
	// Team 1's lead back on IR, two receivers suspended and out for the
	// season, a third receiver questionable.
	f.data.Designations["p001"] = boards.Designation{Code: "IR", AsOf: asOf}
	f.data.Designations["p003"] = boards.Designation{Code: "SUSP", AsOf: asOf}
	f.data.Designations["p004"] = boards.Designation{Code: "O", AsOf: asOf, Note: "Out for the season (knee)"}
	f.data.Designations["p005"] = boards.Designation{Code: "Q", AsOf: asOf}
	listed := map[string]bool{"p001": true, "p003": true, "p004": true}
	a := newFixtureAdvisor(t, f, nil)
	for _, position := range []draft.Position{draft.RB, draft.WR, ""} {
		out := a.Order(orderQuery{position: position, limit: MaxOrderRows}, a.tradeTargets)
		seen, foot := 0, false
		for i, row := range out.Rows {
			id := *row.Line.Player.BoardId
			if row.Rank != i+1 {
				t.Fatalf("%q row %d (%s) numbered %d", position, i, id, row.Rank)
			}
			if listed[id] {
				foot = true
				seen++
				if row.Line.PositionRank != nil {
					t.Fatalf("%q: %s on a season-long list is ranked %d", position, id, *row.Line.PositionRank)
				}
				if d := row.Line.Facts.Designation; d == nil || d.SeasonLong == nil || !*d.SeasonLong {
					t.Fatalf("%q: %s's designation does not say season-long: %+v", position, id, d)
				}
				continue
			}
			if foot {
				t.Fatalf("%q: available %s at %d after a season-long player", position, id, row.Rank)
			}
		}
		want := map[draft.Position]int{draft.RB: 1, draft.WR: 2, "": 3}[position]
		if seen != want {
			t.Fatalf("%q: %d season-long rows, want %d", position, seen, want)
		}
	}
	// The questionable receiver keeps his rank and is not marked.
	wr := a.Order(orderQuery{position: draft.WR, limit: MaxOrderRows}, a.tradeTargets)
	for _, row := range wr.Rows {
		if *row.Line.Player.BoardId == "p005" {
			if row.Line.PositionRank == nil || row.Line.Facts.Designation.SeasonLong != nil {
				t.Fatalf("the questionable receiver: rank %v, designation %+v", row.Line.PositionRank, row.Line.Facts.Designation)
			}
			return
		}
	}
	t.Fatal("no row for p005")
}
