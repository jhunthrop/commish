package inseason

import (
	"strings"
	"testing"

	"github.com/jhunthrop/commish/api/internal/draft"
)

// Lane 103 (B43): the screens agree. A trade that sends out the player our
// order ranks first at his position is listed only when it gains the
// member 1.0 a week or more as the page prints it, or fills a need.

func TestProposableKeepsTheTopPlayerUnlessTheTradeEarnsIt(t *testing.T) {
	mine := []Candidate{player("rb1", draft.RB, 1, 150), player("rb2", draft.RB, 2, 140), player("wr", draft.WR, 9, 80)}
	for _, c := range []struct {
		name string
		tr   Trade
		want bool
	}{
		{"the top back for under a point, no need", Trade{Give: []int{0}, MyGain: 0.8, Need: -1}, false},
		{"the top back for 0.95, printed 1.0", Trade{Give: []int{0}, MyGain: 0.95, Need: -1}, true},
		{"the top back for 1.0", Trade{Give: []int{0}, MyGain: 1.0, Need: -1}, true},
		{"the top back in a two-for-one for under a point", Trade{Give: []int{2, 0}, MyGain: 0.4, Need: -1}, false},
		{"the top back for under a point, filling an empty spot", Trade{Give: []int{0}, MyGain: 0.2, Need: 3}, true},
		{"no kept player for under a point", Trade{Give: []int{1, 2}, MyGain: 0.2, Need: -1}, true},
	} {
		if got := proposable(c.tr, mine); got != c.want {
			t.Errorf("%s: proposable %v, want %v", c.name, got, c.want)
		}
	}
}

// Through the search: ranking the member's best back first at his
// position drops exactly the trades that give him for under 1.0 with no
// need, and keeps every other trade as it was.
func TestTradesDropTheTopPlayerForUnderAPoint(t *testing.T) {
	config, theirs := twelveTeamPPR(t), deepAtReceiver()
	second := deepAtBack()
	top := set(second, "m-rb1", func(c Candidate) Candidate { c.Rank = 1; return c })
	all := Trades(config, SeasonGames, Squad{Players: second}, Squad{Players: theirs}, "", 1000)
	kept := Trades(config, SeasonGames, Squad{Players: top}, Squad{Players: theirs}, "", 1000)
	listed := map[string]bool{}
	for _, tr := range kept {
		listed[tradeWords(tr, top, theirs)] = true
	}
	dropped := 0
	for _, tr := range all {
		words := tradeWords(tr, second, theirs)
		gives := false
		for _, g := range tr.Give {
			gives = gives || second[g].ID == "m-rb1"
		}
		want := !gives || roundTenth(tr.MyGain) >= KeepGain || tr.Need >= 0
		if listed[words] != want {
			t.Errorf("%s (gain %.2f, need %d): listed %v, want %v", words, tr.MyGain, tr.Need, listed[words], want)
		}
		if !want {
			dropped++
		}
	}
	if dropped == 0 || len(kept) != len(all)-dropped {
		t.Fatalf("%d dropped, %d kept of %d", dropped, len(kept), len(all))
	}
}

// A trade that brings in a receiver who plays this week while every one
// of the member's sits fills his empty WR1, said so, and the need keeps a
// sub-point trade of his top back listed.
func TestATradeNamesTheNeedItFills(t *testing.T) {
	config, theirs := twelveTeamPPR(t), deepAtReceiver()
	mine := deepAtBack()
	for _, id := range []string{"m-wr1", "m-wr2", "m-wr3", "m-wr4"} {
		mine = set(mine, id, func(c Candidate) Candidate { return withTier(c, Out) })
	}
	slots := Slots(config)
	got := Trades(config, SeasonGames, Squad{Players: mine}, Squad{Players: theirs}, "", 1000)
	found := false
	for _, tr := range got {
		receiver := false
		for _, h := range tr.Get {
			receiver = receiver || theirs[h].Position == draft.WR
		}
		if receiver != (tr.Need >= 0) {
			t.Errorf("%s: need %d, brings a receiver %v", tradeWords(tr, mine, theirs), tr.Need, receiver)
		}
		if receiver && SlotLabel(slots, tr.Need) == "WR1" {
			found = true
		}
	}
	if !found {
		t.Fatal("no trade fills the empty WR1")
	}
	// The need keeps listed a trade of his top back the keep rule would drop.
	top := set(mine, "m-rb1", func(c Candidate) Candidate { c.Rank = 1; return c })
	needed := Trades(config, SeasonGames, Squad{Players: top}, Squad{Players: theirs}, "", 1000)
	for _, tr := range needed {
		if !proposable(tr, top) {
			t.Fatalf("%s listed against the rule", tradeWords(tr, top, theirs))
		}
	}
}

// A trade that fills one empty spot and leaves a full one empty fills no
// need: the member's only playing back for a receiver.
func TestANeedLeavesNoOtherSpotEmpty(t *testing.T) {
	config := twelveTeamPPR(t)
	mine := deepAtBack()
	for _, id := range []string{"m-wr1", "m-wr2", "m-wr3", "m-wr4", "m-rb2", "m-rb3", "m-rb4", "m-rb5"} {
		mine = set(mine, id, func(c Candidate) Candidate { return withTier(c, Out) })
	}
	s := newSearch(config, SeasonGames, Squad{Players: mine}, Squad{Players: deepAtReceiver()})
	rb1, wr1 := indexOf(mine, "m-rb1"), indexOf(deepAtReceiver(), "t-wr1")
	if got := s.need([]int{rb1}, -1, []int{wr1}); got != -1 {
		t.Fatalf("need %d for a trade that empties the RB spot", got)
	}
	if got := s.need([]int{indexOf(mine, "m-rb2")}, -1, []int{wr1}); got < 0 || SlotLabel(Slots(config), got) != "WR1" {
		t.Fatalf("need %d for a benched back on bye", got)
	}
}

// Through the fixture league's read: no row the Trades screen lists sends
// out a player the row ranks first at his position for under 1.0 a week
// without naming the need it fills, and the footer says the rule.
func TestTheTradesScreenAgreesWithThePlayerPage(t *testing.T) {
	out, ok := newFixtureAdvisor(t, newFixture(t), nil).Trades("")
	if !ok {
		t.Fatal("no trades answer")
	}
	kept, needs := 0, 0
	for _, team := range out.Teams {
		for _, tr := range team.Trades {
			if tr.Need != nil {
				needs++
				if !strings.HasPrefix(*tr.Need, "Fills your empty ") {
					t.Errorf("need %q", *tr.Need)
				}
			}
			for _, g := range tr.Give {
				if g.PositionRank != nil && *g.PositionRank == 1 {
					kept++
					if tr.MyGain < KeepGain && tr.Need == nil {
						t.Errorf("%s given for %.1f with no need", g.Player.Name, tr.MyGain)
					}
				}
			}
		}
	}
	t.Logf("%d rows give a top player, %d name a need", kept, needs)
	if !strings.Contains(out.Basis, "rank first at his position") {
		t.Fatalf("basis %q", out.Basis)
	}
}

func TestTradeNeedWords(t *testing.T) {
	gibbs := Line{Name: "Jahmyr Gibbs"}
	for _, c := range []struct {
		got, want string
	}{
		{TradeNeedWords("WR2", &gibbs, 6, false), "Fills your empty WR2 while Gibbs sits on bye."},
		{TradeNeedWords("FLEX", nil, 6, false), "Fills your empty FLEX this week."},
		{TradeNeedWords("FLEX", nil, 7, true), "Fills your empty FLEX in week 7."},
	} {
		if c.got != c.want {
			t.Errorf("got %q, want %q", c.got, c.want)
		}
	}
}
