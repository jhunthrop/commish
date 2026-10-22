package inseason

import (
	"testing"
	"time"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/boards"
	"github.com/jhunthrop/commish/api/internal/draft"
)

// A line on a season-long list carries no rest-of-season rank (Lane 128,
// B106): the in-season order never ranks a player on injured reserve as
// playing (the 2026-10-16 ruling). The capture's IR and the platform's
// own IR mark both count; a week's designation keeps his rank.
func TestASeasonLongLineCarriesNoRank(t *testing.T) {
	f := newFixture(t)
	listed := fixtureNow.Add(-24 * time.Hour)
	// Team 1's starting RB (p001) on the capture's IR, its starting WR
	// (p003) questionable, and its backup QB (h010) on Sleeper's IR mark.
	f.data.Designations["p001"] = boards.Designation{Code: "IR", AsOf: listed}
	f.data.Designations["p003"] = boards.Designation{Code: "Q", AsOf: listed}
	player := f.league.Player
	f.league.Player = func(id string) apitypes.LeaguePlayer {
		lp := player(id)
		if id == "h010" {
			lp.InjuredReserve = true
		}
		return lp
	}
	a := newFixtureAdvisor(t, f, nil)
	advice, ok := a.Lineup()
	if !ok {
		t.Fatal("no lineup")
	}
	lines := map[string]apitypes.PlayerLine{}
	for _, slot := range advice.Slots {
		lines[slot.Ours.Player.HostId] = slot.Ours
		if slot.Host != nil {
			lines[slot.Host.Player.HostId] = *slot.Host
		}
	}
	for _, line := range append(append([]apitypes.PlayerLine(nil), advice.Bench...), advice.Reserve...) {
		lines[line.Player.HostId] = line
	}
	for _, id := range []string{"h001", "h010"} {
		line, found := lines[id]
		if !found {
			t.Fatalf("%s is on no line of the lineup", id)
		}
		if line.PositionRank != nil {
			t.Fatalf("%s on injured reserve is ranked %d", id, *line.PositionRank)
		}
		if line.Facts.Designation == nil || line.Facts.Designation.Status != apitypes.DesignationStatusInjuredReserve {
			t.Fatalf("%s carries %+v", id, line.Facts.Designation)
		}
	}
	if q := lines["h003"]; q.PositionRank == nil || *q.PositionRank != a.Board.PositionRanks["p003"] {
		t.Fatalf("a questionable starter's rank %v, the board's %d", q.PositionRank, a.Board.PositionRanks["p003"])
	}
	// The order still places him (its own # column), his line unranked.
	order := a.Order(orderQuery{position: draft.RB, limit: MaxOrderRows}, a.tradeTargets)
	for _, row := range order.Rows {
		if row.Line.Player.BoardId != nil && *row.Line.Player.BoardId == "p001" {
			if row.Rank == 0 || row.Line.PositionRank != nil {
				t.Fatalf("the order's row: rank %d, line rank %v", row.Rank, row.Line.PositionRank)
			}
			return
		}
	}
	t.Fatal("the order holds no row for p001")
}
