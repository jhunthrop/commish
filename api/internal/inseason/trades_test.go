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
	got := pairTrades(twelveTeamPPR(t), SeasonGames, Squad{Players: mine}, Squad{Players: theirs}, "", 1000)
	if len(got) == 0 {
		t.Fatal("no trade found between a team deep at back and one deep at receiver")
	}
	seen := map[string]bool{}
	for _, tr := range got {
		words := tradeWords(tr, mine, theirs)
		seen[words] = true
		// Theirs rises, or holds for a weak spot the trade fills (Lane 287).
		if !positive(tr.MyGain) || !sideTakes(tr.TheirRest, tr.TheirGain, tr.TheirFills, SeasonGames) {
			t.Fatalf("%s: gains %v and %v, theirs fills %d", words, tr.MyGain, tr.TheirGain, tr.TheirFills)
		}
		if tr.Fills < 0 && tr.TheirFills < 0 {
			t.Fatalf("%s fills no weak spot on either side", words)
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
		same := got[i].CloseForThem() == got[i-1].CloseForThem() && (got[i].Fills >= 0) == (got[i-1].Fills >= 0)
		if same && roundTenth(got[i].MyGain) > roundTenth(got[i-1].MyGain) {
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
	got := pairTrades(twelveTeamPPR(t), SeasonGames, Squad{Players: mine, Held: map[string]bool{"m-rb3": true}}, Squad{Players: theirs}, "", 1000)
	for _, tr := range got {
		words := tradeWords(tr, mine, theirs)
		if strings.Contains(words, "m-rb3") || strings.Contains(words, "t-wr4") || strings.Contains(words, "-k") || strings.Contains(words, "-def") {
			t.Fatalf("%s trades a held, injured reserve, kicker or defense player", words)
		}
	}
}

func TestTradesNarrowToOnePlayer(t *testing.T) {
	mine, theirs := deepAtBack(), deepAtReceiver()
	got := pairTrades(twelveTeamPPR(t), SeasonGames, Squad{Players: mine}, Squad{Players: theirs}, "t-wr5", 1000)
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

// A two-for-one that grows a full roster names who the member drops to
// make room (§5.2's drop: the player it costs least to lose, never held,
// never a starter, never one of the two he gets), and the gain is after
// the drop. An open spot takes the extra player with no drop.
func TestTwoForOneNamesTheDrop(t *testing.T) {
	mine, theirs := deepAtBack(), deepAtReceiver()
	held := map[string]bool{"m-wr4": true}
	full := pairTrades(twelveTeamPPR(t), SeasonGames, Squad{Players: mine, Held: held}, Squad{Players: theirs}, "", 1000)
	grows := 0
	for _, tr := range full {
		words := tradeWords(tr, mine, theirs)
		if len(tr.Get) <= len(tr.Give) {
			if tr.Drop >= 0 {
				t.Fatalf("%s drops %s with no room needed", words, mine[tr.Drop].ID)
			}
			continue
		}
		grows++
		if tr.Drop < 0 {
			t.Fatalf("%s grows a full roster with no drop", words)
		}
		drop := mine[tr.Drop]
		if held[drop.ID] || contains(tr.Give, tr.Drop) || drop.Position == draft.K || drop.Position == draft.DEF {
			t.Fatalf("%s drops %s", words, drop.ID)
		}
		f := newFiller(Slots(twelveTeamPPR(t)), SeasonGames)
		base, _ := f.strength(pointers(mine))
		var after []*Candidate
		for i := range mine {
			if !contains(tr.Give, i) && i != tr.Drop {
				after = append(after, &mine[i])
			}
		}
		for _, h := range tr.Get {
			after = append(after, &theirs[h])
		}
		strength, _ := f.strength(after)
		if !near(tr.MyGain, strength-base) {
			t.Fatalf("%s gain %v, after the drop %v", words, tr.MyGain, strength-base)
		}
	}
	if grows == 0 {
		t.Fatal("no two-for-one the member gets two in")
	}
	for _, tr := range pairTrades(twelveTeamPPR(t), SeasonGames, Squad{Players: mine, Open: true}, Squad{Players: theirs}, "", 1000) {
		if tr.Drop >= 0 {
			t.Fatalf("%s drops with an open spot", tradeWords(tr, mine, theirs))
		}
	}
}

// A trade that leaves a side unable to fill a slot is never offered:
// the member's only tight end stays.
func TestTradesFillEverySlot(t *testing.T) {
	mine := without(deepAtBack(), []int{12})
	theirs := deepAtReceiver()
	for _, tr := range pairTrades(twelveTeamPPR(t), SeasonGames, Squad{Players: mine}, Squad{Players: theirs}, "", 1000) {
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

// bigLeague is n rosters of 24, a deep bench league, every player with a
// week's Proj so this week's lineup decides the drops (Lane 66u N3).
func bigLeague(n int) []Squad {
	positions := []draft.Position{draft.QB, draft.RB, draft.RB, draft.WR, draft.WR, draft.WR, draft.TE, draft.RB,
		draft.K, draft.DEF, draft.QB, draft.RB, draft.WR, draft.TE, draft.WR, draft.RB, draft.WR, draft.RB, draft.WR,
		draft.QB, draft.TE, draft.RB, draft.WR, draft.WR}
	out := make([]Squad, n)
	for team := range out {
		players := make([]Candidate, len(positions))
		for i, p := range positions {
			value := float64((team*37+i*53)%150) + 1
			proj := float64((team*13+i*29)%25) + 1
			players[i] = withProj(player(fmt.Sprintf("t%d-%d", team, i), p, 1+(team*7+i*11)%60, value), proj)
		}
		out[team] = Squad{Players: players}
	}
	return out
}

// BenchmarkTradesReadTwentyFour is one league read's search, run once and
// kept (Service.finds): the member's 24 against the other eleven's.
func BenchmarkTradesReadTwentyFour(b *testing.B) {
	config := twelveTeamPPR(b)
	teams := bigLeague(12)
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		for _, other := range teams[1:] {
			pairAllTrades(config, SeasonGames, teams[0], other)
		}
	}
}

// BenchmarkTradesRequestTwentyFour is a /trades request once the read's
// search is kept: each team's best ten narrowed from it.
func BenchmarkTradesRequestTwentyFour(b *testing.B) {
	config := twelveTeamPPR(b)
	teams := bigLeague(12)
	found := make([][]Trade, len(teams))
	for i, other := range teams[1:] {
		found[i+1] = pairAllTrades(config, SeasonGames, teams[0], other)
	}
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		for t, other := range teams[1:] {
			Narrow(found[t+1], teams[0], other, "", TradesPerTeam)
		}
	}
}

// Narrow over one search is the answer Trades gives with the same focus
// and limit (Lane 66u N3: the kept search serves every request).
func TestNarrowIsTheSearchWithItsFocus(t *testing.T) {
	config := twelveTeamPPR(t)
	mine, theirs := Squad{Players: deepAtBack()}, Squad{Players: deepAtReceiver()}
	all := pairAllTrades(config, SeasonGames, mine, theirs)
	for _, focus := range []string{"", "t-wr5", "m-rb3"} {
		for _, limit := range []int{1, TradesPerTeam, 1000} {
			want := pairTrades(config, SeasonGames, mine, theirs, focus, limit)
			if got := Narrow(all, mine, theirs, focus, limit); fmt.Sprint(got) != fmt.Sprint(want) {
				t.Fatalf("focus %q limit %d: %d trades, Trades %d", focus, limit, len(got), len(want))
			}
		}
	}
}

// BenchmarkTradesFifteenAgainstFifteen is one team's search: 15 against
// 15, every one-for-one and two-for-one pair both ways.
func BenchmarkTradesFifteenAgainstFifteen(b *testing.B) {
	config := twelveTeamPPR(b)
	teams := league(2)
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		pairTrades(config, SeasonGames, teams[0], teams[1], "", TradesPerTeam)
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
			pairTrades(config, SeasonGames, teams[0], other, "", TradesPerTeam)
		}
	}
}

// A trade's gains are on the rest of the season: a player on bye this
// week changes nothing.
func TestTradeGainsIgnoreThisWeek(t *testing.T) {
	theirs := deepAtReceiver()
	healthy := pairTrades(twelveTeamPPR(t), SeasonGames, Squad{Players: deepAtBack()}, Squad{Players: theirs}, "m-rb1", 1000)
	bye := set(deepAtBack(), "m-rb1", func(c Candidate) Candidate { return withTier(c, Out) })
	got := pairTrades(twelveTeamPPR(t), SeasonGames, Squad{Players: bye}, Squad{Players: theirs}, "m-rb1", 1000)
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
