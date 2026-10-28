package inseason

import (
	"encoding/json"
	"net/http"
	"sort"
	"strings"
	"testing"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/draft"
)

// The waiver level is the best free agent's points over replacement at
// each position, from the pool the Waivers screen reads, and every
// rostered candidate carries his position's (Lane 269 fix round 1).
func TestTheWaiverLevelIsTheBestFreeAgent(t *testing.T) {
	f := newFixture(t)
	a := newFixtureAdvisor(t, f, nil)
	levels := a.levels()
	if !levels.read || len(levels.lacking(a.slots)) > 0 {
		t.Fatalf("the fixture's free agents read %v, lacking %v", levels.read, levels.lacking(a.slots))
	}
	for _, position := range []draft.Position{draft.QB, draft.RB, draft.WR, draft.TE} {
		best, seen := 0.0, false
		for _, p := range a.pool(position) {
			if p.cand.HasValue && listedAdd(p) && (!seen || p.cand.Value > best) {
				best, seen = p.cand.Value, true
			}
		}
		if !seen || levels.of(position) != best {
			t.Fatalf("%s: level %v, the pool's best %v (%v)", position, levels.of(position), best, seen)
		}
	}
	team, _ := a.Snap.TeamByRoster(a.Me)
	for _, p := range a.active(team) {
		if p.cand.FreeLevel != levels.of(p.cand.Position) {
			t.Fatalf("%s carries %v, his position's level %v", p.cand.ID, p.cand.FreeLevel, levels.of(p.cand.Position))
		}
	}
}

// With no read of the league's free agents the level is the last
// starter's, 0, and the line says so.
func TestNoFreeAgentReadFallsBackToTheLastStarter(t *testing.T) {
	f := newFixture(t)
	f.league.HeldBy = nil
	a := newFixtureAdvisor(t, f, nil)
	if l := a.levels(); l.read || len(l.lacking(a.slots)) == 0 || l.of(draft.RB) != 0 {
		t.Fatalf("levels %+v", l)
	}
	out, ok := a.Trades("")
	if !ok || out.RestOfSeasonBasis == nil || !strings.Contains(*out.RestOfSeasonBasis, "as we have no read of the league's free agents") {
		t.Fatalf("the line %v", out.RestOfSeasonBasis)
	}
}

// The order page's trade marks (review LOW-3) come from the finder's
// search, so they hold only players of ideas both sides would take: a
// trade the other side refuses marks nobody.
func TestTheOrdersTradeMarksAreIdeasBothTake(t *testing.T) {
	a := newFixtureAdvisor(t, restOfSeasonFixture(t), nil)
	targets := a.tradeTargets()
	if len(targets) == 0 {
		t.Fatal("the finder brings in nobody, so the test proves nothing")
	}
	listed := map[string]bool{}
	for roster, trades := range a.found() {
		other, _ := a.Snap.TeamByRoster(roster)
		theirs := a.active(other)
		for _, tr := range trades {
			if !Acceptable(tr.MyRest, a.weeks) || !Acceptable(tr.TheirRest, a.weeks) {
				t.Fatalf("the search keeps a refused trade with %d: %v and %v", roster, tr.MyRest, tr.TheirRest)
			}
			for _, i := range tr.Get {
				listed[*theirs[i].line.Player.BoardId] = true
			}
		}
	}
	for id := range targets {
		if !listed[id] {
			t.Fatalf("%s is marked with no trade both would take", id)
		}
	}
}

// A trade the other side refuses is answered on the wire in full (review
// LOW-2): its gains, totals and both rest-of-season figures, with
// acceptable.theirs false. The member gives his least player for team
// 2's two best, in the league with no free agents (so the level is the
// last starter's, and the line says so).
func TestTradeCheckAnswersATradeTheyRefuse(t *testing.T) {
	f := newFixtureOf(t, 0)
	s := fixtureService(t, f.league, f.data, &fakeHolds{})
	_, env := serve(t, s, leaguePath+"trades")
	var advice apitypes.TradeAdvice
	if err := json.Unmarshal(env.Data, &advice); err != nil {
		t.Fatal(err)
	}
	var two apitypes.TradeTeam
	for _, team := range advice.Teams {
		if team.RosterId == 2 {
			two = team
		}
	}
	give := bySeason(advice.Roster)
	get := bySeason(two.Roster)
	if len(give) == 0 || len(get) < 2 {
		t.Fatalf("rosters %d and %d", len(give), len(get))
	}
	body := checkBody(t, 2, []string{give[len(give)-1].Player.HostId}, []string{get[0].Player.HostId, get[1].Player.HostId})
	code, env := post(t, s, leaguePath+"trades/check", body)
	if code != http.StatusOK {
		t.Fatalf("%d %+v", code, env.Error)
	}
	var got apitypes.TradeCheck
	if err := json.Unmarshal(env.Data, &got); err != nil {
		t.Fatal(err)
	}
	if got.Acceptable == nil || got.Acceptable.Theirs || !got.Acceptable.Yours {
		t.Fatalf("acceptable %+v", got.Acceptable)
	}
	if got.Trade.MyRestOfSeason == nil || got.Trade.TheirRestOfSeason == nil || *got.Trade.TheirRestOfSeason >= 0 ||
		len(got.Trade.Give) != 1 || len(got.Trade.Get) != 2 || got.Totals.Theirs.SeasonBefore == 0 || got.RestOfSeasonBasis == nil ||
		!strings.Contains(*got.RestOfSeasonBasis, "At QB, RB, WR and TE it is over the last starter league-wide, as the league has no free quarterback, running back, receiver or tight end.") {
		t.Fatalf("the answer %+v", got)
	}
}

// bySeason is a roster's skill players, most points over replacement a
// week first.
func bySeason(roster []apitypes.PlayerLine) []apitypes.PlayerLine {
	var out []apitypes.PlayerLine
	for _, l := range roster {
		if l.PointsOverReplacement != nil && skill(draft.Position(l.Player.Position)) {
			out = append(out, l)
		}
	}
	sort.SliceStable(out, func(i, j int) bool { return *out[i].PointsOverReplacement > *out[j].PointsOverReplacement })
	return out
}
