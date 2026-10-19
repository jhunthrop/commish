package inseason

import (
	"strings"
	"testing"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/boards"
	"github.com/jhunthrop/commish/api/internal/draft"
	"github.com/jhunthrop/commish/api/internal/leaguesync"
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
	// A bye as the advisor builds it: out this week and no Proj at all.
	bye := Candidate{ID: "x-qb", Position: draft.QB, Tier: Out}
	if got := WeekProj(config, Swapped(roster, []int{starter}, []Candidate{bye}), nil) - before; roundTenth(got) != 0 {
		t.Fatalf("a quarterback on a bye starts: %v", got)
	}
	if len(roster) != len(deepAtBack()) || roster[starter].ID != "m-qb" {
		t.Fatal("the swap changed the roster it read")
	}
}

// A player traded in whose game has kicked off is not one of the member's
// starters, so he cannot be moved in and adds no Proj (review L3).
func TestALockedIncomingPlayerDoesNotStart(t *testing.T) {
	config := twelveTeamPPR(t)
	roster := rosterWithProj(deepAtBack(), 5)
	starters := []string{"m-qb", "m-rb1", "m-rb2", "m-wr1", "m-wr2", "m-wr3", "m-te", "m-k", "m-def"}
	before := WeekProj(config, roster, starters)
	locked := Candidate{ID: "x-qb", Position: draft.QB, Proj: 30, HasProj: true, Tier: Available, Locked: true}
	if got := WeekProj(config, Swapped(roster, nil, []Candidate{locked}), starters) - before; roundTenth(got) != 0 {
		t.Fatalf("a locked quarterback traded in moved the week by %v", got)
	}
	locked.Locked = false
	if got := WeekProj(config, Swapped(roster, nil, []Candidate{locked}), starters) - before; roundTenth(got) != 25 {
		t.Fatalf("the same quarterback unlocked moved the week by %v", got)
	}
}

// The member's drop leaves his lineup with the trade (review L3, the Dart
// case): Dart starts at QB before; giving Rodgers and dropping Dart for a
// back leaves Mahomes at QB and the back in an empty RB spot, so the week
// moves by 18 + 10 - 20, not by the back's 10 alone.
func TestTheMembersDropLeavesTheWeekFigure(t *testing.T) {
	who := func(id string, pos draft.Position, proj float64) person {
		return person{cand: Candidate{ID: id, Position: pos, Proj: proj, HasProj: true, Tier: Available}}
	}
	mine := []person{who("dart", draft.QB, 20), who("mahomes", draft.QB, 18), who("rodgers", draft.QB, 15)}
	theirs := []person{who("back", draft.RB, 10)}
	a := &advisor{config: twelveTeamPPR(t), projection: boards.WeekProjection{ReadAt: fixtureNow}}
	week := a.tradeWeek(leaguesync.Team{}, leaguesync.Team{}, mine, theirs, Trade{Give: []int{2}, Get: []int{0}, Drop: 0})
	if got := week.mine.change(); got == nil || *got != 8 {
		t.Fatalf("the member's week change with Dart dropped: %v", deref(got))
	}
	if got := week.theirs.change(); got == nil || *got != 5 {
		t.Fatalf("their week change, Rodgers in for a back: %v", deref(got))
	}
}

// The finder's basis keeps the board's own words for what the gains are on
// (review M2): the preseason number never names the rest of the season.
func TestTradesBasisSaysItsOrder(t *testing.T) {
	if rest := TradesBasis(RestOfSeason, 12); !strings.Contains(rest, "left on our order.") {
		t.Fatalf("rest of season: %q", rest)
	}
	pre := TradesBasis(Preseason, 17)
	if !strings.HasSuffix(pre, "on our preseason number.") || strings.Contains(pre, "rest of the season") || strings.Contains(pre, "rest-of-season") {
		t.Fatalf("preseason: %q", pre)
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
	if advice.ProjectionReadAt == nil || advice.ProjectionScoring.Format == "" {
		t.Fatalf("the projection's read and scoring: %v %+v", advice.ProjectionReadAt, advice.ProjectionScoring)
	}
	if !strings.Contains(advice.Basis, "The other team decides.") {
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
