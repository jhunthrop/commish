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
		if !Acceptable(tr.TheirRest, SeasonGames) {
			t.Fatalf("the finder lists %s, costing them %v", tradeWords(tr, mine, theirs), tr.TheirRest)
		}
	}
}

// A balanced two-for-one passes: two of the member's backs for a
// receiver of theirs, more rest of season to them than they give.
func TestABalancedTwoForOnePasses(t *testing.T) {
	config := twelveTeamPPR(t)
	mine, theirs := deepAtBack(), deepAtReceiver()
	found := map[string]Trade{}
	for _, tr := range Trades(config, SeasonGames, Squad{Players: mine}, Squad{Players: theirs}, "", 1000) {
		found[tradeWords(tr, mine, theirs)] = tr
	}
	tr, ok := found["m-rb3+m-rb4 for t-wr2"]
	if !ok {
		t.Fatalf("the finder misses m-rb3+m-rb4 for t-wr2 among %d", len(found))
	}
	// They take in 170 for 120, their drop counted against them.
	if tr.TheirRest < 0 || tr.TheirRest > 50 {
		t.Fatalf("their rest of season %v", tr.TheirRest)
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
	if got, want := RestOfSeasonBasis(RestOfSeason, 9, h, true),
		"Rest of season is the points over replacement of the players a side gets less those it gives and drops, weeks 9 to 17. We list a trade only when theirs falls by 9.0 or less."; got != want {
		t.Fatalf("finder %q", got)
	}
	if got := RestOfSeasonBasis(RestOfSeason, 9, h, false); !strings.HasSuffix(got, "A side takes a trade that costs it 9.0 or less.") {
		t.Fatalf("builder %q", got)
	}
	pre := RestOfSeasonBasis(boards.OrderPreseason, SeasonGames, h, true)
	if !strings.Contains(pre, "over the season's 17 weeks on our preseason number") || !strings.HasSuffix(pre, "17.0 or less.") {
		t.Fatalf("preseason %q", pre)
	}
	for _, s := range []string{pre, RestOfSeasonBasis(RestOfSeason, 9, h, false)} {
		for _, w := range []string{"value", "price", "worth", "market"} {
			if strings.Contains(strings.ToLower(s), w) {
				t.Fatalf("%q says %q", s, w)
			}
		}
	}
}
