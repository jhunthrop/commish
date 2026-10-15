package inseason

import (
	"fmt"
	"strings"
	"testing"

	"github.com/jhunthrop/commish/api/internal/draft"
)

// deepAtBack is the member's roster: four starting-grade backs, thin at
// receiver.
func deepAtBack() []Candidate {
	return []Candidate{
		player("m-qb", draft.QB, 6, 70), player("m-rb1", draft.RB, 3, 150), player("m-rb2", draft.RB, 8, 110),
		player("m-rb3", draft.RB, 12, 90), player("m-rb4", draft.RB, 14, 80), player("m-wr1", draft.WR, 20, 60),
		player("m-wr2", draft.WR, 40, 25), player("m-wr3", draft.WR, 50, 15), player("m-te", draft.TE, 10, 15),
		player("m-k", draft.K, 3, 0), player("m-def", draft.DEF, 3, 0), player("m-wr4", draft.WR, 70, 2),
		player("m-te2", draft.TE, 30, 1), player("m-qb2", draft.QB, 30, 1), player("m-rb5", draft.RB, 60, 1),
	}
}

// deepAtReceiver is the other team's: five starting-grade receivers, thin
// at back.
func deepAtReceiver() []Candidate {
	return []Candidate{
		player("t-qb", draft.QB, 8, 60), player("t-rb1", draft.RB, 30, 30), player("t-rb2", draft.RB, 40, 15),
		player("t-wr1", draft.WR, 2, 160), player("t-wr2", draft.WR, 6, 120), player("t-wr3", draft.WR, 10, 100),
		player("t-wr4", draft.WR, 12, 95), player("t-wr5", draft.WR, 16, 85), player("t-te", draft.TE, 6, 30),
		player("t-k", draft.K, 8, 0), player("t-def", draft.DEF, 8, 0), player("t-rb3", draft.RB, 55, 3),
		player("t-te2", draft.TE, 25, 2), player("t-qb2", draft.QB, 28, 2), player("t-wr6", draft.WR, 80, 1),
	}
}

func tradeWords(tr Trade, mine, theirs []Candidate) string {
	var give, get []string
	for _, g := range tr.Give {
		give = append(give, mine[g].ID)
	}
	for _, h := range tr.Get {
		get = append(get, theirs[h].ID)
	}
	return strings.Join(give, "+") + " for " + strings.Join(get, "+")
}

func TestTradesHelpBothLineups(t *testing.T) {
	mine, theirs := deepAtBack(), deepAtReceiver()
	got := Trades(twelveTeamPPR(t), Squad{Players: mine}, Squad{Players: theirs}, "", 1000)
	if len(got) == 0 {
		t.Fatal("no trade found between a team deep at back and one deep at receiver")
	}
	seen := map[string]bool{}
	for _, tr := range got {
		words := tradeWords(tr, mine, theirs)
		seen[words] = true
		if !positive(tr.MyGain) || !positive(tr.TheirGain) {
			t.Fatalf("%s: gains %v and %v, both must rise", words, tr.MyGain, tr.TheirGain)
		}
		for _, g := range tr.Give {
			if !skill(mine[g].Position) {
				t.Fatalf("%s gives a %s", words, mine[g].Position)
			}
		}
	}
	// The plain one: the fourth back for the fourth receiver. Their flex
	// had a receiver worth 85; ours a back worth 80.
	if !seen["m-rb3 for t-wr4"] {
		t.Fatalf("trades %v miss m-rb3 for t-wr4", seen)
	}
	for i := 1; i < len(got); i++ {
		if got[i].CloseForThem() == got[i-1].CloseForThem() && got[i].MyGain > got[i-1].MyGain {
			t.Fatalf("not ordered by the member's gain at %d", i)
		}
		if got[i-1].CloseForThem() && !got[i].CloseForThem() {
			t.Fatalf("a close call for them leads a trade they gain from at %d", i)
		}
	}
}

func TestTradesKeepHeldInjuredAndKickers(t *testing.T) {
	mine := deepAtBack()
	theirs := set(deepAtReceiver(), "t-wr4", func(c Candidate) Candidate { c.InjuredReserve = true; return c })
	got := Trades(twelveTeamPPR(t), Squad{Players: mine, Held: map[string]bool{"m-rb3": true}}, Squad{Players: theirs}, "", 1000)
	for _, tr := range got {
		words := tradeWords(tr, mine, theirs)
		if strings.Contains(words, "m-rb3") || strings.Contains(words, "t-wr4") || strings.Contains(words, "-k") || strings.Contains(words, "-def") {
			t.Fatalf("%s trades a held, injured reserve, kicker or defense player", words)
		}
	}
}

func TestTradesNarrowToOnePlayer(t *testing.T) {
	mine, theirs := deepAtBack(), deepAtReceiver()
	got := Trades(twelveTeamPPR(t), Squad{Players: mine}, Squad{Players: theirs}, "t-wr5", 1000)
	if len(got) == 0 {
		t.Fatal("no trade holds t-wr5")
	}
	twoForOne := false
	for _, tr := range got {
		words := tradeWords(tr, mine, theirs)
		if !strings.Contains(words, "t-wr5") {
			t.Fatalf("%s does not hold t-wr5", words)
		}
		if len(tr.Give) == 2 || len(tr.Get) == 2 {
			twoForOne = true
		}
	}
	if !twoForOne {
		t.Fatalf("no two-for-one among %d trades", len(got))
	}
}

// A trade that leaves a side unable to fill a slot is never offered:
// the member's only tight end stays.
func TestTradesFillEverySlot(t *testing.T) {
	mine := without(deepAtBack(), []int{12})
	theirs := deepAtReceiver()
	for _, tr := range Trades(twelveTeamPPR(t), Squad{Players: mine}, Squad{Players: theirs}, "", 1000) {
		for _, g := range tr.Give {
			if mine[g].ID == "m-te" {
				gotTE := false
				for _, h := range tr.Get {
					gotTE = gotTE || theirs[h].Position == draft.TE
				}
				if !gotTE {
					t.Fatalf("%s leaves the member with no tight end", tradeWords(tr, mine, theirs))
				}
			}
		}
	}
}

// league is n fixture rosters of 15 for the benchmark: the member's and
// n-1 others, values spread so many trades are kept.
func league(n int) []Squad {
	positions := []draft.Position{draft.QB, draft.RB, draft.RB, draft.WR, draft.WR, draft.WR, draft.TE, draft.RB,
		draft.K, draft.DEF, draft.QB, draft.RB, draft.WR, draft.TE, draft.WR}
	out := make([]Squad, n)
	for team := range out {
		players := make([]Candidate, len(positions))
		for i, p := range positions {
			value := float64((team*37+i*53)%150) + 1
			players[i] = player(fmt.Sprintf("t%d-%d", team, i), p, 1+(team*7+i*11)%60, value)
		}
		out[team] = Squad{Players: players}
	}
	return out
}

// BenchmarkTradesFifteenAgainstFifteen is one team's search: 15 against
// 15, every one-for-one and two-for-one pair both ways.
func BenchmarkTradesFifteenAgainstFifteen(b *testing.B) {
	config := twelveTeamPPR(b)
	teams := league(2)
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		Trades(config, teams[0], teams[1], "", TradesPerTeam)
	}
}

// BenchmarkTradesTwelveTeams is the route's whole search: the member
// against the other eleven.
func BenchmarkTradesTwelveTeams(b *testing.B) {
	config := twelveTeamPPR(b)
	teams := league(12)
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		for _, other := range teams[1:] {
			Trades(config, teams[0], other, "", TradesPerTeam)
		}
	}
}

// A trade's gains are on the rest of the season: a player on bye this
// week changes nothing.
func TestTradeGainsIgnoreThisWeek(t *testing.T) {
	theirs := deepAtReceiver()
	healthy := Trades(twelveTeamPPR(t), Squad{Players: deepAtBack()}, Squad{Players: theirs}, "m-rb1", 1000)
	bye := set(deepAtBack(), "m-rb1", func(c Candidate) Candidate { return withTier(c, Out) })
	got := Trades(twelveTeamPPR(t), Squad{Players: bye}, Squad{Players: theirs}, "m-rb1", 1000)
	if len(got) != len(healthy) {
		t.Fatalf("%d trades with him on bye, %d healthy", len(got), len(healthy))
	}
	for i := range got {
		if tradeWords(got[i], bye, theirs) != tradeWords(healthy[i], bye, theirs) || !near(got[i].MyGain, healthy[i].MyGain) ||
			!near(got[i].TheirGain, healthy[i].TheirGain) {
			t.Fatalf("trade %d: %s %v, healthy %s %v", i, tradeWords(got[i], bye, theirs), got[i].MyGain,
				tradeWords(healthy[i], bye, theirs), healthy[i].MyGain)
		}
	}
}

// The trades the other team gains from lead, by the member's gain; the
// close calls for them follow, by the member's gain too (H3).
func TestTradesLeadWithOnesTheyGainFrom(t *testing.T) {
	trades := []Trade{{MyGain: 4.5, TheirGain: 0.04}, {MyGain: 1.5, TheirGain: 0.6}, {MyGain: 2, TheirGain: 1},
		{MyGain: 3, TheirGain: 0.44}, {MyGain: 1, TheirGain: 0.46}}
	orderTrades(trades)
	var got []string
	for _, tr := range trades {
		got = append(got, fmt.Sprintf("%.1f/%.2f", tr.MyGain, tr.TheirGain))
	}
	want := "2.0/1.00 1.5/0.60 1.0/0.46 4.5/0.04 3.0/0.44"
	if strings.Join(got, " ") != want {
		t.Fatalf("order %v, want %s", got, want)
	}
	if (Trade{TheirGain: 0.46}).CloseForThem() || !(Trade{TheirGain: 0.44}).CloseForThem() {
		t.Fatal("a close call is judged on the gain a page prints")
	}
}
