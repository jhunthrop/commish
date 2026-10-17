package inseason

import (
	"strings"
	"testing"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/boards"
	"github.com/jhunthrop/commish/api/internal/draft"
)

// rosterWithProj gives every player in a roster the same Proj, so a swap's
// change is the incoming player's against the one he replaces.
func rosterWithProj(roster []Candidate, proj float64) []Candidate {
	out := make([]Candidate, len(roster))
	for i, c := range roster {
		c.Proj, c.HasProj = proj, true
		out[i] = c
	}
	return out
}

// The week's Proj total is the lineup the Lineup screen sets, so a
// quarterback with the higher Proj traded in starts and the total moves
// by the difference; one on a bye never starts and moves nothing; the
// roster the swap reads is never changed (Lane 66g).
func TestWeekProjFollowsTheLineup(t *testing.T) {
	config := twelveTeamPPR(t)
	roster := rosterWithProj(deepAtBack(), 5)
	before := WeekProj(config, roster, nil)
	starter := 0 // m-qb
	in := Candidate{ID: "x-qb", Position: draft.QB, Proj: 25, HasProj: true, Tier: Available}
	if got := WeekProj(config, Swapped(roster, []int{starter}, []Candidate{in}), nil) - before; roundTenth(got) != 20 {
		t.Fatalf("a 25 Proj quarterback for a 5: %v", got)
	}
	in.Tier = Out
	if got := WeekProj(config, Swapped(roster, []int{starter}, []Candidate{in}), nil) - before; roundTenth(got) != 0 {
		t.Fatalf("a quarterback on a bye starts: %v", got)
	}
	if len(roster) != len(deepAtBack()) || roster[starter].ID != "m-qb" {
		t.Fatal("the swap changed the roster it read")
	}
}

// fixtureProjection is a week 6 Proj for every rostered player on the
// fixture's board, varied by name so lineups differ.
func fixtureProjection(f fixture) boards.WeekProjection {
	players := map[string]boards.ProjectedPoints{}
	for _, team := range f.league.Snap.Teams {
		for _, h := range team.Players {
			if p := f.league.Player(h); p.BoardId != nil {
				players[*p.BoardId] = boards.ProjectedPoints{PPR: 4 + float64(len(p.Name)%9)*1.7}
			}
		}
	}
	return boards.WeekProjection{Week: 6, ReadAt: fixtureNow.Add(-1), Players: players}
}

// Every finder row carries each side's change in this week's Proj, the
// builder's check of the same trade carries it again with the totals it
// is a change in, and its rest-of-season totals differ by the gain to
// the tenth; the trade verb copies the offer on Sleeper, the line under
// it naming the platform.
func TestTradeAnswersCarryTheWeekAndTheTotals(t *testing.T) {
	f := newFixture(t)
	a, err := newAdvisor(f.league, f.data, fixtureProjection(f), nil, fixtureNow)
	if err != nil {
		t.Fatal(err)
	}
	advice, ok := a.Trades("")
	if !ok {
		t.Fatal("no advice")
	}
	if advice.Moves.Propose != apitypes.TradeMovesProposeUnavailable || advice.Moves.Reason == nil ||
		!strings.HasPrefix(*advice.Moves.Reason, "Sleeper does not take trade proposals from here") {
		t.Fatalf("moves %+v", advice.Moves)
	}
	if !strings.Contains(advice.Basis, "best for you first") {
		t.Fatalf("basis %q", advice.Basis)
	}
	checked := 0
	for _, team := range advice.Teams {
		for _, row := range team.Trades {
			if row.MyProjChange == nil || row.TheirProjChange == nil {
				t.Fatalf("%s: a row with no week's change", team.Name)
			}
			got, r, ok := a.CheckTrade(apitypes.TradeCheckInput{Team: team.RosterId, Give: hostIDs(row.Give), Get: hostIDs(row.Get)})
			if !ok || r != nil {
				t.Fatalf("%s: %+v", team.Name, r)
			}
			for _, side := range []struct {
				name   string
				totals apitypes.TradeSideTotals
				gain   float64
				change *float64
			}{{"yours", got.Totals.Yours, row.MyGain, row.MyProjChange}, {"theirs", got.Totals.Theirs, row.TheirGain, row.TheirProjChange}} {
				tot := side.totals
				if roundTenth(tot.SeasonAfter-tot.SeasonBefore) != side.gain {
					t.Fatalf("%s %s: season %v to %v, gain %v", team.Name, side.name, tot.SeasonBefore, tot.SeasonAfter, side.gain)
				}
				if tot.ProjBefore == nil || tot.ProjAfter == nil || roundTenth(*tot.ProjAfter-*tot.ProjBefore) != *side.change {
					t.Fatalf("%s %s: Proj %v to %v, the finder's change %v", team.Name, side.name, deref(tot.ProjBefore), deref(tot.ProjAfter), *side.change)
				}
			}
			checked++
		}
	}
	if checked == 0 {
		t.Fatal("the fixture found no trade")
	}
}

// With no projection read the week's figures are absent, never a zero.
func TestTradeWeekIsNullWithoutAProjection(t *testing.T) {
	f := newFixture(t)
	a := newFixtureAdvisor(t, f, nil)
	advice, _ := a.Trades("")
	for _, team := range advice.Teams {
		for _, row := range team.Trades {
			if row.MyProjChange != nil || row.TheirProjChange != nil {
				t.Fatalf("%s: a week's change with no projection read", team.Name)
			}
			got, _, _ := a.CheckTrade(apitypes.TradeCheckInput{Team: team.RosterId, Give: hostIDs(row.Give), Get: hostIDs(row.Get)})
			if got.Totals.Yours.ProjBefore != nil || got.Totals.Theirs.ProjAfter != nil {
				t.Fatalf("%s: Proj totals with no projection read", team.Name)
			}
			return
		}
	}
	t.Fatal("the fixture found no trade")
}
