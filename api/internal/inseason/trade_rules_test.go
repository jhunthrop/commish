package inseason

import (
	"testing"

	"github.com/jhunthrop/commish/api/internal/apitypes"
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

// emptied is a team whose every player scores nothing over replacement:
// it needs every slot, and no player of its would gain the member.
func emptied(team []Candidate) []Candidate {
	out := make([]Candidate, len(team))
	for i, c := range team {
		c.Value = 0
		out[i] = c
	}
	return out
}

// Lane 290 (B283): a team the finder lists no trade with says why, from
// the search's own reading: no need of theirs, only the member's own
// need, ideas that gained him and were dropped, or nothing found. Each
// case is one change from the median league, and each reason fails when
// its branch of emptyReason is taken out.
func TestTheEmptyReasons(t *testing.T) {
	short := func(team []Candidate, id string) []Candidate {
		return set(team, id, func(c Candidate) Candidate { c.Value = 5; return c })
	}
	for _, c := range []struct {
		name          string
		member, other []Candidate
		want          EmptyReason
	}{
		{"they need nothing", leagueTeam(0, 5), leagueTeam(1, 5), EmptyNoNeed},
		{"they need the receiver he needs", short(leagueTeam(0, 5), "t0-wr2"), short(leagueTeam(1, 5), "t1-wr2"), EmptySameNeed},
		{"his ideas open his own back", short(leagueTeam(0, 5), "t0-wr2"), short(leagueTeam(1, 5), "t1-rb2"), EmptyDropped},
		{"no idea gains him", leagueTeam(0, 5), emptied(leagueTeam(1, 5)), EmptyNothing},
	} {
		t.Run(c.name, func(t *testing.T) {
			l, squads := syntheticLeague(standardConfig, c.member, 5)
			squads[1] = Squad{Players: c.other, Open: true}
			l = NewTradeLeague(standardConfig, l.Span, squads)
			got := Find(l, squads[0], squads[1])
			if len(got.Trades) != 0 {
				t.Fatalf("lists %d trades, the case wants none", len(got.Trades))
			}
			if got.Empty != c.want {
				t.Fatalf("empty reason %q, want %q", got.Empty, c.want)
			}
		})
	}
	// A team the finder lists a trade with gives no reason.
	l, squads := syntheticLeague(standardConfig, noQB(5), 5)
	if got := Find(l, squads[0], squads[1]); len(got.Trades) == 0 || got.Empty != "" {
		t.Fatalf("a listed team: %d trades, reason %q", len(got.Trades), got.Empty)
	}
}

// The answer carries the reason on a team with no listed trade and on no
// other (Lane 290): the search's own, or nothing where a player asked for
// narrows every kept trade away; a team the search never ran for says
// none.
func TestTheAnswerSaysWhyATeamIsEmpty(t *testing.T) {
	kept := Found{Trades: []Trade{{}}}
	if got := emptyReasonOf(kept, 1); got != nil {
		t.Fatalf("a listed team says %q", *got)
	}
	if got := emptyReasonOf(kept, 0); got == nil || *got != apitypes.TradeTeamEmptyReasonNothing {
		t.Fatalf("narrowed away: %v", got)
	}
	if got := emptyReasonOf(Found{Empty: EmptySameNeed}, 0); got == nil || *got != apitypes.TradeTeamEmptyReasonSameNeed {
		t.Fatalf("the search's reason: %v", got)
	}
	if got := emptyReasonOf(Found{}, 0); got != nil {
		t.Fatalf("no search says %q", *got)
	}
	a := newFixtureAdvisor(t, newFixture(t), nil)
	out, ok := a.Trades("")
	if !ok {
		t.Fatal("no answer")
	}
	for _, team := range out.Teams {
		if (len(team.Trades) == 0) != (team.EmptyReason != nil) {
			t.Fatalf("%s lists %d trades with reason %v", team.Name, len(team.Trades), team.EmptyReason)
		}
		if team.EmptyReason != nil && !team.EmptyReason.Valid() {
			t.Fatalf("%s: reason %q", team.Name, *team.EmptyReason)
		}
	}
}
