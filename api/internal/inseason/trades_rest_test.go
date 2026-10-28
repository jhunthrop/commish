package inseason

import (
	"strings"
	"testing"

	"github.com/jhunthrop/commish/api/internal/boards"
	"github.com/jhunthrop/commish/api/internal/draft"
)

// irvingMember is the member's roster in the founder's case (2026-10-28):
// two good backs, Irving first, thin at receiver, a full bench.
func irvingMember() []Candidate {
	return []Candidate{
		player("m-qb", draft.QB, 8, 60), player("m-irving", draft.RB, 16, 100), player("m-rb2", draft.RB, 18, 95),
		player("m-rb3", draft.RB, 40, 40), player("m-wr1", draft.WR, 30, 50), player("m-wr2", draft.WR, 40, 40),
		player("m-wr3", draft.WR, 50, 30), player("m-te", draft.TE, 10, 20), player("m-k", draft.K, 3, 0),
		player("m-def", draft.DEF, 3, 0), player("m-wr4", draft.WR, 70, 2), player("m-te2", draft.TE, 30, 1),
		player("m-qb2", draft.QB, 30, 1), player("m-rb5", draft.RB, 60, 1), player("m-wr5", draft.WR, 80, 1),
	}
}

// irvingOther is the other team's: Nacua and five receivers behind him
// nearly as good, Love their second back.
func irvingOther() []Candidate {
	return []Candidate{
		player("t-qb", draft.QB, 9, 55), player("t-rb1", draft.RB, 20, 80), player("t-love", draft.RB, 30, 30),
		player("t-nacua", draft.WR, 5, 120), player("t-wr2", draft.WR, 12, 72), player("t-wr3", draft.WR, 14, 70),
		player("t-wr4", draft.WR, 16, 66), player("t-wr5", draft.WR, 18, 64), player("t-te", draft.TE, 8, 25),
		player("t-k", draft.K, 8, 0), player("t-def", draft.DEF, 8, 0), player("t-rb3", draft.RB, 60, 2),
		player("t-te2", draft.TE, 28, 1), player("t-qb2", draft.QB, 28, 1), player("t-wr6", draft.WR, 90, 1),
	}
}

// Irving for Nacua and Love lifts both lineups, so the old finder listed
// it, but it costs the other side far more rest of season than it brings:
// the finder drops it and the builder answers it unacceptable to them.
func TestIrvingForNacuaAndLoveIsDropped(t *testing.T) {
	config := twelveTeamPPR(t)
	mine, theirs := irvingMember(), irvingOther()
	me, them := Squad{Players: mine}, Squad{Players: theirs}
	give := []int{indexOf(mine, "m-irving")}
	get := []int{indexOf(theirs, "t-nacua"), indexOf(theirs, "t-love")}
	got := Check(config, SeasonGames, me, them, give, get)
	if !positive(got.MyGain) || !positive(got.TheirGain) {
		t.Fatalf("the shape lifts both lineups: mine %v, theirs %v", got.MyGain, got.TheirGain)
	}
	t.Logf("gains a week: mine %.1f, theirs %.1f; rest of season: mine %.1f, theirs %.1f", got.MyGain, got.TheirGain, got.MyRest, got.TheirRest)
	// They take in 100 and send out 150.
	if roundTenth(got.TheirRest) != -50 {
		t.Fatalf("their rest of season %v, want -50", got.TheirRest)
	}
	if Acceptable(got.TheirRest, SeasonGames) {
		t.Fatalf("they give up %v over %d weeks and read as taking it", got.TheirRest, SeasonGames)
	}
	if !Acceptable(got.MyRest, SeasonGames) {
		t.Fatalf("the member gains %v and reads as refusing it", got.MyRest)
	}
	for _, tr := range Trades(config, SeasonGames, me, them, "", 1000) {
		if words := tradeWords(tr, mine, theirs); words == "m-irving for t-nacua+t-love" || words == "m-irving for t-love+t-nacua" {
			t.Fatalf("the finder lists %s", words)
		}
		if !Acceptable(tr.TheirRest, SeasonGames) || !Acceptable(tr.MyRest, SeasonGames) {
			t.Fatalf("the finder lists %s, rest of season %v and %v", tradeWords(tr, mine, theirs), tr.MyRest, tr.TheirRest)
		}
	}
}

// A balanced two-for-one passes: m-rb3 (90) and m-wr2 (25) for t-wr2
// (120) is 5 to the member and 6 from them (their drop, t-wr6, counted),
// both inside the 17 the season allows.
func TestABalancedTwoForOnePasses(t *testing.T) {
	config := twelveTeamPPR(t)
	mine, theirs := deepAtBack(), deepAtReceiver()
	found := map[string]Trade{}
	for _, tr := range Trades(config, SeasonGames, Squad{Players: mine}, Squad{Players: theirs}, "", 1000) {
		found[tradeWords(tr, mine, theirs)] = tr
	}
	tr, ok := found["m-rb3+m-wr2 for t-wr2"]
	if !ok {
		t.Fatalf("the finder misses m-rb3+m-wr2 for t-wr2 among %d", len(found))
	}
	if roundTenth(tr.MyRest) != 5 || roundTenth(tr.TheirRest) != -6 {
		t.Fatalf("rest of season mine %v, theirs %v", tr.MyRest, tr.TheirRest)
	}
}

// An idea both would take (coordinator's ruling, Lane 269 fix round 1):
// m-rb3+m-rb4 for t-wr2 lifts both lineups and suits them, but costs the
// member 50 against 17, so the finder leaves it out; the builder still
// answers it, unacceptable to him.
func TestTheFinderAsksBothSides(t *testing.T) {
	config := twelveTeamPPR(t)
	mine, theirs := deepAtBack(), deepAtReceiver()
	me, them := Squad{Players: mine}, Squad{Players: theirs}
	for _, tr := range Trades(config, SeasonGames, me, them, "", 1000) {
		if tradeWords(tr, mine, theirs) == "m-rb3+m-rb4 for t-wr2" {
			t.Fatalf("the finder lists m-rb3+m-rb4 for t-wr2: %+v", tr)
		}
	}
	got := Check(config, SeasonGames, me, them, []int{3, 4}, []int{4})
	if !positive(got.MyGain) || !positive(got.TheirGain) || roundTenth(got.MyRest) != -50 ||
		Acceptable(got.MyRest, SeasonGames) || !Acceptable(got.TheirRest, SeasonGames) {
		t.Fatalf("m-rb3+m-rb4 for t-wr2: %+v", got.Trade)
	}
}

// The two figures part where a starter is under replacement (review
// LOW-1): the lineup gain counts t-te's -5 as he starts, the rest of
// season counts him none, since the side could pick up as good free.
func TestTheTwoFiguresPartUnderReplacement(t *testing.T) {
	config := twelveTeamPPR(t)
	mine := deepAtBack()
	theirs := set(deepAtReceiver(), "t-te", func(c Candidate) Candidate { c.Value = -5; return c })
	got := Check(config, SeasonGames, Squad{Players: mine}, Squad{Players: theirs}, []int{8}, []int{8})
	// m-te (15) for t-te (-5): each starts at TE after the trade.
	if roundTenth(got.TheirGain*SeasonGames) != 20 || roundTenth(got.TheirRest) != 15 {
		t.Fatalf("theirs: lineup %v over the season, rest of season %v", got.TheirGain*SeasonGames, got.TheirRest)
	}
	if roundTenth(got.MyGain*SeasonGames) != -20 || roundTenth(got.MyRest) != -15 {
		t.Fatalf("mine: lineup %v over the season, rest of season %v", got.MyGain*SeasonGames, got.MyRest)
	}
}

// The waiver level (coordinator's ruling, Lane 269 fix round 1): a
// player counts what he scores over the best free agent at his position.
// Their backup back, under the last starter (-8), counts none on that
// level and 22 over a free back at -30, which turns a trade they would
// take into one they refuse. A back for a back cancels the level out.
func TestTheWaiverLevelCountsTheBench(t *testing.T) {
	config := twelveTeamPPR(t)
	mine := set(deepAtBack(), "m-wr1", func(c Candidate) Candidate { c.Value = 80; return c })
	theirs := set(deepAtReceiver(), "t-rb3", func(c Candidate) Candidate { c.Value = -8; return c })
	// m-wr1 (80) for t-wr5 (85) and t-rb3.
	give, get := []int{5}, []int{7, 11}
	last := Check(config, SeasonGames, Squad{Players: mine}, Squad{Players: theirs}, give, get)
	if roundTenth(last.TheirRest) != -5 || !Acceptable(last.TheirRest, SeasonGames) {
		t.Fatalf("on the last starter's level: %v", last.TheirRest)
	}
	level := func(roster []Candidate) []Candidate {
		out := append([]Candidate(nil), roster...)
		for i := range out {
			if out[i].Position == draft.RB {
				out[i].FreeLevel = -30
			}
		}
		return out
	}
	free := Check(config, SeasonGames, Squad{Players: level(mine)}, Squad{Players: level(theirs)}, give, get)
	if roundTenth(free.TheirRest) != -27 || Acceptable(free.TheirRest, SeasonGames) {
		t.Fatalf("on the waiver level: %v, want -27 and refused", free.TheirRest)
	}
	// m-rb4 (80) for t-wr5 and t-rb3: 110 in over the free back, 85 and 22 out.
	backs := Check(config, SeasonGames, Squad{Players: level(mine)}, Squad{Players: level(theirs)}, []int{4}, get)
	if roundTenth(backs.TheirRest) != 3 {
		t.Fatalf("a back for a back: %v, want 3", backs.TheirRest)
	}
}

// A superflex league (review LOW-5): quarterbacks are scarce, the best
// free one far under the last starter, so a backup quarterback counts
// against the side that gives him and the finder lists only trades both
// sides take.
func TestSuperflexCountsTheBackupQuarterback(t *testing.T) {
	config := tenTeamHalfSuperflex(t)
	qbs := func(roster []Candidate) []Candidate {
		out := append([]Candidate(nil), roster...)
		for i := range out {
			if out[i].Position == draft.QB {
				out[i].FreeLevel = -40
			}
		}
		return out
	}
	mine, theirs := qbs(deepAtBack()), qbs(deepAtReceiver())
	// m-rb4 (80) for t-wr4 (95) and t-qb2 (2, so 42 over the free one).
	got := Check(config, SeasonGames, Squad{Players: mine}, Squad{Players: theirs}, []int{4}, []int{6, 13})
	if roundTenth(got.TheirRest) != -57 || Acceptable(got.TheirRest, SeasonGames) {
		t.Fatalf("their rest of season %v, want -57 and refused", got.TheirRest)
	}
	for _, tr := range Trades(config, SeasonGames, Squad{Players: mine}, Squad{Players: theirs}, "", 1000) {
		if !Acceptable(tr.MyRest, SeasonGames) || !Acceptable(tr.TheirRest, SeasonGames) {
			t.Fatalf("the finder lists %s at %v and %v", tradeWords(tr, mine, theirs), tr.MyRest, tr.TheirRest)
		}
	}
}

// A trade that costs the other side within the tolerance passes: m-rb3
// (90) for t-wr4 (95) costs them 5 over 17 weeks, under 17.
func TestACostWithinTheTolerancePasses(t *testing.T) {
	config := twelveTeamPPR(t)
	mine, theirs := deepAtBack(), deepAtReceiver()
	for _, tr := range Trades(config, SeasonGames, Squad{Players: mine}, Squad{Players: theirs}, "", 1000) {
		if tradeWords(tr, mine, theirs) != "m-rb3 for t-wr4" {
			continue
		}
		if roundTenth(tr.TheirRest) != -5 || roundTenth(tr.MyRest) != 5 {
			t.Fatalf("rest of season mine %v, theirs %v", tr.MyRest, tr.TheirRest)
		}
		return
	}
	t.Fatal("the finder misses m-rb3 for t-wr4")
}

// The tolerance is GiveUpPerWeek for each week, on the printed tenth.
func TestAcceptableAtTheEdge(t *testing.T) {
	for _, c := range []struct {
		rest  float64
		weeks int
		want  bool
	}{
		{-17, 17, true}, {-17.04, 17, true}, {-17.1, 17, false}, {-9, 9, true}, {-9.1, 9, false},
		{-1, 0, true}, {-1.1, 0, false}, {40, 9, true},
	} {
		if got := Acceptable(c.rest, c.weeks); got != c.want {
			t.Errorf("Acceptable(%v, %d) = %v, want %v", c.rest, c.weeks, got, c.want)
		}
	}
}

// A drop to make room counts against the side that makes it; a player
// under replacement counts as replacement, so dropping him costs none.
func TestTheDropCountsAgainstItsSide(t *testing.T) {
	config := twelveTeamPPR(t)
	mine := set(deepAtBack(), "m-rb5", func(c Candidate) Candidate { c.Value = -4; return c })
	theirs := deepAtReceiver()
	held := map[string]bool{"m-wr4": true, "m-te2": true, "m-qb2": true}
	drops := 0
	for _, tr := range Trades(config, SeasonGames, Squad{Players: mine, Held: held}, Squad{Players: theirs}, "", 1000) {
		in := 0.0
		for _, h := range tr.Get {
			in += theirs[h].Value
		}
		out := 0.0
		for _, g := range tr.Give {
			out += max(0, mine[g].Value)
		}
		want := in - out
		if tr.Drop >= 0 {
			drops++
			want -= max(0, mine[tr.Drop].Value)
		}
		if roundTenth(tr.MyRest) != roundTenth(want) {
			t.Fatalf("%s drop %d: rest of season %v, want %v", tradeWords(tr, mine, theirs), tr.Drop, tr.MyRest, want)
		}
	}
	if drops == 0 {
		t.Fatal("no trade drops a player")
	}
	// The builder's drop counts the same: one for two into a full roster.
	got := Check(config, SeasonGames, Squad{Players: mine, Held: held}, Squad{Players: theirs}, []int{1}, []int{2, 11})
	if got.Drop < 0 {
		t.Fatalf("m-rb1 for t-rb2+t-rb3 names no drop: %+v", got.Trade)
	}
	want := theirs[2].Value + theirs[11].Value - mine[1].Value - max(0, mine[got.Drop].Value)
	if roundTenth(got.MyRest) != roundTenth(want) {
		t.Fatalf("the builder's rest of season %v, want %v", got.MyRest, want)
	}
}

// The rest-of-season line names the weeks and the rule, each in the
// finder's or the builder's voice, and never a trading word.
func TestRestOfSeasonBasis(t *testing.T) {
	h := Horizon{Last: LastWeek}
	if got, want := RestOfSeasonBasis(RestOfSeason, 9, h, true, true, nil),
		"Rest of season is what the players a side gets score over the best free agent at their position, less the same for those it gives and drops, weeks 9 to 17. We list a trade only when neither side falls by more than 9.0."; got != want {
		t.Fatalf("finder %q", got)
	}
	if got := RestOfSeasonBasis(RestOfSeason, 9, h, true, false, nil); !strings.Contains(got, "over the last starter at their position league-wide, as we have no read of the league's free agents,") {
		t.Fatalf("with no free agents read %q", got)
	}
	if got := RestOfSeasonBasis(RestOfSeason, 9, h, false, true, nil); !strings.HasSuffix(got, "A side takes a trade that costs it 9.0 or less.") {
		t.Fatalf("builder %q", got)
	}
	pre := RestOfSeasonBasis(boards.OrderPreseason, SeasonGames, h, true, true, nil)
	if !strings.Contains(pre, "over the season's 17 weeks on our preseason number") || !strings.HasSuffix(pre, "more than 17.0.") {
		t.Fatalf("preseason %q", pre)
	}
	for _, s := range []string{pre, RestOfSeasonBasis(RestOfSeason, 9, h, false, true, nil), RestOfSeasonBasis(RestOfSeason, 9, h, false, false, nil)} {
		for _, w := range []string{"value", "price", "worth", "market"} {
			if strings.Contains(strings.ToLower(s), w) {
				t.Fatalf("%q says %q", s, w)
			}
		}
	}
}
