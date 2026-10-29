package inseason

import (
	"testing"

	"github.com/jhunthrop/commish/api/internal/draft"
)

// Lane 287 fix round (HIGH-2): each rule of the finder with a case that
// fails without it, on the synthetic league of profile_test.go.

// listedAlone is whether the finder lists exactly give for get, by id.
func listedAlone(l TradeLeague, mine, theirs Squad, give, get string) bool {
	for _, tr := range AllTrades(l, mine, theirs) {
		if len(tr.Give) == 1 && len(tr.Get) == 1 && mine.Players[tr.Give[0]].ID == give && theirs.Players[tr.Get[0]].ID == get {
			return true
		}
	}
	return false
}

// needsQBDeepAtBack is team 1 with no quarterback worth starting and two
// backs to spare.
func needsQBDeepAtBack() []Candidate {
	team := set(leagueTeam(1, 5), "t1-qb1", func(c Candidate) Candidate { c.Value, c.Rank = -40, 40; return c })
	team = set(team, "t1-rb3", func(c Candidate) Candidate { c.Value, c.Rank = 60, 15; return c })
	return set(team, "t1-rb4", func(c Candidate) Candidate { c.Value, c.Rank = 55, 18; return c })
}

// The finder never sends out the one player who can start at a spot this
// week: the member's second quarterback goes for a back while his starter
// plays, never while his starter is on bye.
func TestTheOnlyStarterThisWeekStays(t *testing.T) {
	member := set(leagueTeam(0, 58), "t0-rb2", func(c Candidate) Candidate { c.Value = 5; return c })
	league := func(mine []Candidate) (TradeLeague, Squad, Squad) {
		l, squads := syntheticLeague(standardConfig, mine, 5)
		squads[1] = Squad{Players: needsQBDeepAtBack(), Open: true}
		return NewTradeLeague(standardConfig, l.Span, squads), squads[0], squads[1]
	}
	l, mine, theirs := league(member)
	if !listedAlone(l, mine, theirs, "t0-qb2", "t1-rb2") {
		t.Fatal("the second quarterback for a back is not listed while the starter plays")
	}
	onBye := set(member, "t0-qb1", func(c Candidate) Candidate { c.Tier = Out; return c })
	l, mine, theirs = league(onBye)
	if listedAlone(l, mine, theirs, "t0-qb2", "t1-rb2") {
		t.Fatal("the finder sends out the only quarterback who can start this week")
	}
}

// A trade never makes a hole to fill another: the member's starting
// quarterback goes for a receiver only when his backup still starts for
// the median team.
func TestATradeOpensNoNeed(t *testing.T) {
	theirs := set(leagueTeam(1, 5), "t1-qb1", func(c Candidate) Candidate { c.Value, c.Rank = -40, 40; return c })
	theirs = set(theirs, "t1-wr3", func(c Candidate) Candidate { c.Value, c.Rank = 72, 14; return c })
	theirs = set(theirs, "t1-qb2", func(c Candidate) Candidate { c.Value = -45; return c })
	listed := func(qb2 float64) bool {
		member := set(leagueTeam(0, qb2), "t0-wr2", func(c Candidate) Candidate { c.Value = 5; return c })
		l, squads := syntheticLeague(standardConfig, member, 5)
		squads[1] = Squad{Players: theirs, Open: true}
		l = NewTradeLeague(standardConfig, l.Span, squads)
		return listedAlone(l, squads[0], squads[1], "t0-qb1", "t1-wr3")
	}
	if !listed(58) {
		t.Fatal("the starter for a receiver is not listed with a backup who starts for the median team")
	}
	if listed(45) {
		t.Fatal("the finder opens a QB need to fill the WR")
	}
}

// The other side takes a trade its lineup holds even on only for a need
// it fills; a loss, or more rest of season given up than the rule allows,
// it never takes.
func TestTheirSideHoldsEvenOnlyForANeed(t *testing.T) {
	for _, c := range []struct {
		rest, gain float64
		fills      int
		want       bool
	}{
		{0, 0.04, 2, true},
		{0, 0.04, -1, false},
		{0, -0.06, 2, false},
		{0, 0.06, -1, true},
		{-20, 1, 2, false},
	} {
		if got := sideTakes(c.rest, c.gain, c.fills, SeasonGames); got != c.want {
			t.Errorf("rest %v gain %v fills %d: %v", c.rest, c.gain, c.fills, got)
		}
	}
}

// A trade that fills one of the member's needs leads one that fills none,
// whatever their gains; equal gains to the tenth go by this week's change.
func TestTheOrderFillsFirstThenThisWeek(t *testing.T) {
	trades := []Trade{
		{MyGain: 1.0, TheirGain: 1, Fills: -1},
		{MyGain: 0.51, TheirGain: 2, Fills: 3, MyWeek: 1},
		{MyGain: 0.49, TheirGain: 1, Fills: 3, MyWeek: 3},
	}
	orderTrades(trades)
	if trades[0].MyWeek != 3 || trades[1].MyWeek != 1 || trades[2].Fills != -1 {
		t.Fatalf("order %+v", trades)
	}
}

// A need is filled only when the trade makes up half its gap: 15 of a
// 40-point gap is not a fill, 20 is.
func TestAFillMakesUpHalfTheGap(t *testing.T) {
	l := NewTradeLeague(standardConfig, SpanOf(SeasonGames, SeasonGames), nil)
	needs := []Need{{Slot: 0, Short: 40}}
	before := make([]float64, len(l.slots))
	after := make([]float64, len(l.slots))
	after[0] = 15
	if got := l.filled(needs, before, after); got != -1 {
		t.Fatalf("15 of 40 fills %d", got)
	}
	after[0] = 20
	if got := l.filled(needs, before, after); got != 0 {
		t.Fatalf("20 of 40 fills %d", got)
	}
	if l.slots[0].Type != draft.SlotQB {
		t.Fatalf("slot 0 is %s", l.slots[0].Type)
	}
}
