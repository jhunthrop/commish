package inseason

import (
	"fmt"
	"testing"

	"github.com/jhunthrop/commish/api/internal/draft"
)

// Lane 287: each roster's profile in a synthetic 12-team league, its
// needs against the median team, its surplus, and the trade finder that
// reads them. Every figure is points over replacement over the season.

// standardConfig is a 1QB lineup: QB, two RB, two WR, TE, a flex, K, DEF
// and seven on the bench (the founder's league's shape).
var standardConfig = founderConfig

// superflexConfig is the same lineup with a superflex.
var superflexConfig = withSlot(standardConfig, draft.SlotConfig{Slot: draft.SlotSuperflex, Count: 1,
	EligiblePositions: []draft.Position{draft.QB, draft.RB, draft.WR, draft.TE}})

// twoQBConfig starts two quarterbacks.
var twoQBConfig = func() []draft.SlotConfig {
	out := append([]draft.SlotConfig(nil), standardConfig...)
	out[0] = draft.SlotConfig{Slot: draft.SlotQB, Count: 2, EligiblePositions: []draft.Position{draft.QB}}
	return out
}()

// withSlot is config with c before the kicker.
func withSlot(config []draft.SlotConfig, c draft.SlotConfig) []draft.SlotConfig {
	var out []draft.SlotConfig
	for _, s := range config {
		if s.Slot == draft.SlotK {
			out = append(out, c)
		}
		out = append(out, s)
	}
	return out
}

// leagueTeam is team i of the synthetic league: a starter at each spot a
// little weaker the later the team, backups at every position. qb2 is
// its second quarterback's figure.
func leagueTeam(i int, qb2 float64) []Candidate {
	d := float64(i) * 0.5
	id := func(s string) string { return fmt.Sprintf("t%d-%s", i, s) }
	return []Candidate{
		player(id("qb1"), draft.QB, 8, 60-d), player(id("qb2"), draft.QB, 24, qb2),
		player(id("rb1"), draft.RB, 6, 90-d), player(id("rb2"), draft.RB, 20, 50-d), player(id("rb3"), draft.RB, 40, 10), player(id("rb4"), draft.RB, 60, 0),
		player(id("wr1"), draft.WR, 6, 95-d), player(id("wr2"), draft.WR, 24, 55-d), player(id("wr3"), draft.WR, 50, 15), player(id("wr4"), draft.WR, 70, 5),
		player(id("te1"), draft.TE, 8, 30-d), player(id("te2"), draft.TE, 30, 0),
		{ID: id("k"), Position: draft.K}, {ID: id("def"), Position: draft.DEF},
	}
}

// noQB is team 0 with no quarterback worth starting and a deep backfield:
// two backs on the bench who would start for most teams.
func noQB(qb2 float64) []Candidate {
	team := leagueTeam(0, qb2)
	team = set(team, "t0-qb1", func(c Candidate) Candidate { c.Value, c.Rank = -40, 40; return c })
	team = set(team, "t0-rb3", func(c Candidate) Candidate { c.Value, c.Rank = 60, 15; return c })
	return set(team, "t0-rb4", func(c Candidate) Candidate { c.Value, c.Rank = 55, 18; return c })
}

// deepAtQB is team 1 with a second quarterback who would start for most
// teams and a hole at its second back.
func deepAtQB(qb2 float64) []Candidate {
	return set(leagueTeam(1, qb2), "t1-rb2", func(c Candidate) Candidate { c.Value = 5; return c })
}

// syntheticLeague is the 12 teams: the member's first, the deep
// quarterback's second, every other team's second quarterback at qb2.
func syntheticLeague(config []draft.SlotConfig, member []Candidate, qb2 float64) (TradeLeague, []Squad) {
	squads := []Squad{{Players: member, Open: true}, {Players: deepAtQB(45), Open: true}}
	for i := 2; i < 12; i++ {
		squads = append(squads, Squad{Players: leagueTeam(i, qb2), Open: true})
	}
	return NewTradeLeague(config, SpanOf(SeasonGames, SeasonGames), squads), squads
}

// slotOf is the first slot of the type in the league's lineup.
func slotOf(l TradeLeague, typ draft.SlotType) int {
	for i, s := range l.slots {
		if s.Type == typ {
			return i
		}
	}
	return -1
}

// A slot's points follow the byes week by week: a quarterback off in week
// 4 has his backup start that week, the backup's other games count on the
// bench.
func TestTheProfileCountsTheByes(t *testing.T) {
	starter := player("qb1", draft.QB, 1, 30)
	starter.Plays = PlaysIn([]int{1, 2, 3})
	backup := player("qb2", draft.QB, 20, 8)
	l := NewTradeLeague(standardConfig, Span{First: 1, Last: 4}, nil)
	got := l.Profile([]Candidate{starter, backup})
	// 10 a game for three weeks, then the backup's 2.
	if qb := got.Slots[slotOf(l, draft.SlotQB)]; roundTenth(qb) != 32 {
		t.Fatalf("QB slot %v, want 32", qb)
	}
	if got.Bench[draft.QB] != 8 {
		t.Fatalf("bench %v, want the backup's 8 at QB", got.Bench)
	}
	// A schedule read with no game left counts none; an unread one every week.
	gone := player("qb3", draft.QB, 2, 30)
	gone.Plays = PlaysIn(nil)
	if s := (Span{First: 1, Last: 4}); s.games(&gone) != 0 || s.games(&backup) != 4 {
		t.Fatalf("games %d and %d", s.games(&gone), s.games(&backup))
	}
}

// An empty slot counts the best free agent's level a week at its
// positions: the player its team would pick up.
func TestAnEmptySlotCountsTheWaiverLevel(t *testing.T) {
	team := []Candidate{player("rb", draft.RB, 1, 40)}
	team[0].FreeLevel = -17
	qb := player("free-qb", draft.QB, 0, 0)
	qb.FreeLevel = -34
	l := NewTradeLeague(standardConfig, SpanOf(SeasonGames, SeasonGames), []Squad{{Players: append(team, qb)}})
	got := l.Profile(team)
	if v := got.Slots[slotOf(l, draft.SlotQB)]; roundTenth(v) != -34 {
		t.Fatalf("empty QB %v, want the free quarterback's -34", v)
	}
	if v := got.Slots[slotOf(l, draft.SlotFlex)]; roundTenth(v) != -17 {
		t.Fatalf("empty flex %v, want the free back's -17 (the best of its positions read)", v)
	}
}

// The superflex starts a second quarterback; a two-QB lineup starts two.
func TestTheProfileFillsSuperflexAndTwoQB(t *testing.T) {
	team := leagueTeam(0, 45)
	super, _ := syntheticLeague(superflexConfig, team, 40)
	if v := super.Profile(team).Slots[slotOf(super, draft.SlotSuperflex)]; roundTenth(v) != 45 {
		t.Fatalf("superflex %v, want the second quarterback's 45", v)
	}
	two, _ := syntheticLeague(twoQBConfig, team, 40)
	got := two.Profile(team)
	if roundTenth(got.Slots[0]) != 60 || roundTenth(got.Slots[1]) != 45 || two.slots[1].Type != draft.SlotQB {
		t.Fatalf("two QB slots %v", got.Slots[:2])
	}
	if got.Bench[draft.QB] != 0 {
		t.Fatalf("bench %v, both quarterbacks start", got.Bench)
	}
}

// The team with no quarterback needs one first; its bench backs are its
// surplus; the median team needs nothing.
func TestNeedsAndSurplus(t *testing.T) {
	member := noQB(5)
	l, squads := syntheticLeague(standardConfig, member, 5)
	needs := l.Needs(l.Profile(member))
	if len(needs) == 0 || needs[0].Slot != slotOf(l, draft.SlotQB) {
		t.Fatalf("needs %+v, want the QB first", needs)
	}
	surplus := l.Surplus(member)
	if len(surplus) != 1 || member[surplus[0]].ID != "t0-rb2" {
		t.Fatalf("surplus %v, want the bench back t0-rb2 (t0-rb3 and t0-rb4 start, one in the flex)", surplus)
	}
	if got := l.Needs(l.Profile(squads[6].Players)); len(got) != 0 {
		t.Fatalf("the median team needs %+v", got)
	}
	// A second quarterback at 58 would start for the median team (57.25);
	// at 45 he would not.
	if got := l.Surplus(deepAtQB(58)); len(got) != 1 || deepAtQB(58)[got[0]].ID != "t1-qb2" || len(l.Surplus(deepAtQB(45))) != 0 {
		t.Fatalf("the deep quarterback's surplus %v", got)
	}
}

// The finder targets the need (Lane 287): the team with no quarterback
// gets one first, and gives a back from its depth.
func TestATeamWithNoQBGetsAQBFirst(t *testing.T) {
	member := noQB(5)
	l, squads := syntheticLeague(standardConfig, member, 5)
	got := Trades(l, squads[0], squads[1], "", TradesPerTeam)
	if len(got) == 0 {
		t.Fatal("no trade with the team deep at quarterback")
	}
	first := got[0]
	if first.Fills != slotOf(l, draft.SlotQB) || !getsAt(first, squads[1].Players, draft.QB) {
		t.Fatalf("first trade %+v, want a quarterback filling the QB", first)
	}
	if first.Gives != draft.RB {
		t.Fatalf("first trade gives %q, want from the depth at RB", first.Gives)
	}
	for _, tr := range got {
		if tr.Fills < 0 && tr.TheirFills < 0 {
			t.Fatalf("%+v fills no need on either side", tr)
		}
		if !Acceptable(tr.MyRest, l.Weeks()) || !sideTakes(tr.TheirRest, tr.TheirGain, tr.TheirFills, l.Weeks()) {
			t.Fatalf("%+v is not one both sides take", tr)
		}
	}
}

// A team at the median everywhere with nothing to give finds no trade:
// none fills a need on either side.
func TestNoNeedNoTrade(t *testing.T) {
	l, squads := syntheticLeague(standardConfig, leagueTeam(0, 5), 5)
	for _, other := range squads[2:] {
		if got := Trades(l, squads[0], other, "", TradesPerTeam); len(got) != 0 {
			t.Fatalf("median teams trade %+v", got)
		}
	}
}

// A superflex league values a second quarterback: the same roster with
// one starting quarterback needs the superflex there and gets a
// quarterback for it, where a 1QB league sees no quarterback need.
func TestSuperflexValuesASecondQB(t *testing.T) {
	// Two backs who start in the flex and the superflex, where most teams
	// start a second quarterback at 40.
	member := set(leagueTeam(0, 0), "t0-rb3", func(c Candidate) Candidate { c.Value = 30; return c })
	member = set(member, "t0-rb4", func(c Candidate) Candidate { c.Value = 28; return c })
	super, squads := syntheticLeague(superflexConfig, member, 40)
	// Their third quarterback sits behind two who start.
	squads[1].Players = append(squads[1].Players, player("t1-qb3", draft.QB, 26, 42))
	needs := super.Needs(super.Profile(member))
	if len(needs) == 0 || needs[0].Slot != slotOf(super, draft.SlotSuperflex) {
		t.Fatalf("superflex needs %+v, want the superflex first", needs)
	}
	got := Trades(super, squads[0], squads[1], "", TradesPerTeam)
	if len(got) == 0 || got[0].Fills != slotOf(super, draft.SlotSuperflex) || !getsAt(got[0], squads[1].Players, draft.QB) {
		t.Fatalf("superflex trades %+v, want a quarterback for the superflex first", got)
	}
	one, squads1 := syntheticLeague(standardConfig, member, 40)
	for _, n := range one.Needs(one.Profile(member)) {
		if one.slots[n.Slot].accepts(draft.QB) {
			t.Fatalf("1QB needs %+v", n)
		}
	}
	for _, tr := range Trades(one, squads1[0], squads1[1], "", TradesPerTeam) {
		if tr.Fills >= 0 && one.slots[tr.Fills].Type == draft.SlotQB {
			t.Fatalf("1QB trade fills the QB: %+v", tr)
		}
	}
}

// A trade that adds a player who changes nothing is the same idea: the
// finder lists the smaller one only.
func TestThePaddedTradeIsLeftOut(t *testing.T) {
	member := noQB(5)
	l, squads := syntheticLeague(standardConfig, member, 5)
	got := AllTrades(l, squads[0], squads[1])
	for _, tr := range got {
		for _, smaller := range got {
			if pads(tr, smaller) {
				t.Fatalf("%+v pads %+v", tr, smaller)
			}
		}
	}
}

// getsAt is whether the trade brings the member a player at p.
func getsAt(tr Trade, theirs []Candidate, p draft.Position) bool {
	for _, g := range tr.Get {
		if theirs[g].Position == p {
			return true
		}
	}
	return false
}
