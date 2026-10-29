package inseason

import (
	"testing"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/draft"
)

// dartRoster is deepAtBack with the Dart case (sweep X8): the second
// quarterback is the least on our rest-of-season order, so the old drop
// was his, but his Proj is the highest this week, so the Lineup screen
// starts him at QB.
func dartRoster() []Candidate {
	out := rosterWithProj(deepAtBack(), 5)
	return set(out, "m-qb2", func(c Candidate) Candidate { c.Value, c.Proj = -5, 25; return c })
}

// The finder never drops a player this week's lineup starts while a
// bench player is droppable (Lane 66u): the trades that grow the roster
// drop a bench player instead.
func TestTradesKeepThisWeeksStarters(t *testing.T) {
	config := twelveTeamPPR(t)
	mine, theirs := dartRoster(), deepAtReceiver()
	// The same roster with his Proj low: the old rule's drop was his.
	benched := set(mine, "m-qb2", func(c Candidate) Candidate { c.Proj = 1; return c })
	dropsHim := false
	for _, tr := range pairTrades(config, SeasonGames, Squad{Players: benched}, Squad{Players: theirs}, "", 1000) {
		dropsHim = dropsHim || (tr.Drop >= 0 && benched[tr.Drop].ID == "m-qb2")
	}
	if !dropsHim {
		t.Fatal("the case is gone: no trade drops the benched m-qb2")
	}
	drops := 0
	for _, tr := range pairTrades(config, SeasonGames, Squad{Players: mine}, Squad{Players: theirs}, "", 1000) {
		if tr.Drop < 0 {
			continue
		}
		drops++
		if mine[tr.Drop].ID == "m-qb2" {
			t.Fatalf("%s drops m-qb2, this week's starting QB, with a bench player droppable", tradeWords(tr, mine, theirs))
		}
		if tr.DropFor >= 0 || tr.ForSlot >= 0 {
			t.Fatalf("%s says its return takes a bench player's spot", tradeWords(tr, mine, theirs))
		}
	}
	if drops == 0 {
		t.Fatal("no trade grows the roster")
	}
}

// When the only drop is one of this week's starters, the trade is kept
// only when the lineup stays full and a player it brings in starts, and
// it says who and where (Lane 66u): with every bench player but m-qb2
// held, bringing in a quarterback drops him and the quarterback takes his
// spot; giving m-qb, the other quarterback, for two receivers has no room.
func TestAStarterGoesOnlyForHisSpot(t *testing.T) {
	config := twelveTeamPPR(t)
	slots := Slots(config)
	mine := dartRoster()
	theirs := set(deepAtReceiver(), "t-qb", func(c Candidate) Candidate { return withProj(c, 22) })
	held := map[string]bool{"m-rb4": true, "m-wr4": true, "m-te2": true, "m-rb5": true}
	seen := map[string]Trade{}
	for _, tr := range pairTrades(config, SeasonGames, Squad{Players: mine, Held: held}, Squad{Players: theirs}, "", 1000) {
		words := tradeWords(tr, mine, theirs)
		seen[words] = tr
		if tr.Drop < 0 {
			continue
		}
		switch mine[tr.Drop].ID {
		case "m-qb2":
			if tr.DropFor < 0 || tr.ForSlot < 0 || !slots[tr.ForSlot].accepts(theirs[tr.Get[tr.DropFor]].Position) {
				t.Fatalf("%s drops this week's starting QB and names nobody who starts in his place", words)
			}
		case "m-qb":
			// On the bench this week: the drop that keeps the lineup full
			// when nobody brought in starts.
			if tr.DropFor >= 0 {
				t.Fatalf("%s names a spot for a bench drop", words)
			}
		default:
			t.Fatalf("%s drops %s, a held player", words, mine[tr.Drop].ID)
		}
	}
	// m-qb for t-qb+t-wr5 costs them far more rest of season than it
	// brings, so the finder leaves it out (Lane 269); the builder still
	// answers it with the drop, and refuses one that leaves the QB spot
	// empty this week.
	if tr, ok := seen["m-qb for t-qb+t-wr5"]; ok {
		t.Fatalf("the finder lists m-qb for t-qb+t-wr5: %+v", tr)
	}
	checked := pairCheck(config, SeasonGames, Squad{Players: mine, Held: held}, Squad{Players: theirs}, []int{0}, []int{0, 7})
	if checked.Drop < 0 || mine[checked.Drop].ID != "m-qb2" || checked.DropFor != 0 ||
		SlotLabel(slots, checked.DropSlot) != "QB" || checked.ForSlot != checked.DropSlot {
		t.Fatalf("the builder's drop %d for %d: %+v, want t-qb in m-qb2's QB spot", checked.Drop, checked.DropFor, checked.Trade)
	}
	if Acceptable(checked.TheirRest, SeasonGames) {
		t.Fatalf("m-qb for t-qb+t-wr5 reads acceptable to them: %v", checked.TheirRest)
	}
	empty := pairCheck(config, SeasonGames, Squad{Players: mine, Held: held}, Squad{Players: theirs}, []int{0}, []int{6, 7})
	if empty.Mine.Room || empty.Drop >= 0 {
		t.Fatalf("m-qb for two receivers drops %d with no one at QB this week", empty.Drop)
	}
}

// weekPlayer is a candidate with this week's Proj, every other key alike.
func weekPlayer(id string, p draft.Position, proj float64) Candidate {
	return withProj(player(id, p, 50, 10), proj)
}

// "Takes his spot" is the lineup kept full with a player brought in
// starting, the chain of moves included, and the slot named is the one he
// actually takes (review 66u, finding 2): a FLEX and a superflex league,
// each with a chain that fills the lineup and one that does not.
func TestTakesHisSpotFollowsTheChain(t *testing.T) {
	special := []Candidate{weekPlayer("k", draft.K, 8), weekPlayer("df", draft.DEF, 7)}
	flexFull := append([]Candidate{weekPlayer("q", draft.QB, 20), weekPlayer("a", draft.RB, 18), weekPlayer("b", draft.RB, 12),
		weekPlayer("c", draft.RB, 10), weekPlayer("w1", draft.WR, 15), weekPlayer("w2", draft.WR, 14), weekPlayer("w3", draft.WR, 13),
		weekPlayer("t", draft.TE, 9), weekPlayer("w4", draft.WR, 2), weekPlayer("q2", draft.QB, 1)}, special...)
	flexShort := append([]Candidate{weekPlayer("q", draft.QB, 20), weekPlayer("a", draft.RB, 18), weekPlayer("b", draft.RB, 12),
		weekPlayer("w1", draft.WR, 15), weekPlayer("w2", draft.WR, 14), weekPlayer("w3", draft.WR, 13), weekPlayer("w4", draft.WR, 11),
		weekPlayer("t", draft.TE, 9), weekPlayer("te2", draft.TE, 3), weekPlayer("q2", draft.QB, 1)}, special...)
	superflex := append([]Candidate{weekPlayer("q1", draft.QB, 20), weekPlayer("q2", draft.QB, 18), weekPlayer("a", draft.RB, 15),
		weekPlayer("b", draft.RB, 13), weekPlayer("w1", draft.WR, 14), weekPlayer("w2", draft.WR, 12), weekPlayer("f", draft.WR, 11),
		weekPlayer("t", draft.TE, 9), weekPlayer("r3", draft.RB, 2)}, special...)
	cases := []struct {
		name   string
		config []draft.SlotConfig
		roster []Candidate
		drop   string
		in     Candidate
		// want is the slot the incoming player takes, "" for no room; spot
		// is the dropped starter's.
		want, spot string
	}{
		{"FLEX: the flex back slides to RB2 and the receiver takes the flex", twelveTeamPPR(t), flexFull, "b",
			weekPlayer("x", draft.WR, 12.5), "Flex", "RB2"},
		{"FLEX: no back is left for RB2", twelveTeamPPR(t), flexShort, "b", weekPlayer("x", draft.WR, 12), "", "RB2"},
		{"superflex: a quarterback takes the superflex", tenTeamHalfSuperflex(t), superflex, "q2", weekPlayer("x", draft.QB, 16),
			"Superflex", "Superflex"},
		{"superflex: the quarterback starts but the TE spot is empty", tenTeamHalfSuperflex(t), superflex, "t",
			weekPlayer("x", draft.QB, 16), "", "TE"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			slots := Slots(tc.config)
			r := newDropRule(tc.config, Squad{Players: tc.roster}, nil)
			d := indexOf(tc.roster, tc.drop)
			if !r.startsThisWeek(d) || SlotLabel(slots, r.spotOf(d)) != tc.spot {
				t.Fatalf("%s starts at slot %d this week, want %s", tc.drop, r.spotOf(d), tc.spot)
			}
			// The path the searches run: the drop offered to recommend alone.
			got, ok := r.recommend([]dropOption{{at: d, spot: noSpot}}, nil, []Candidate{tc.in})
			if tc.want == "" {
				if ok {
					t.Fatalf("kept with %s at %s", tc.in.ID, SlotLabel(slots, got.spot.slot))
				}
				return
			}
			if !ok || got.at != d || got.spot.by != 0 || SlotLabel(slots, got.spot.slot) != tc.want {
				t.Fatalf("%+v (%v), want x at %s", got, ok, tc.want)
			}
		})
	}
}

// valued is weekPlayer with his rest-of-season value, the last tie-break.
func valued(id string, p draft.Position, proj, value float64) Candidate {
	return withProj(player(id, p, 50, value), proj)
}

// Each of recommend's tie-breaks decides a case alone (rereview 66u N1):
// between drops whose gains print alike, the higher Proj this week's
// lineup keeps, then a bench player before a starter, then the player our
// order values least. Every case adds a quarterback who starts at QB.
func TestRecommendBreaksTiesInOrder(t *testing.T) {
	config := twelveTeamPPR(t)
	roster := func(qValue, w4Value, q2Value float64) []Candidate {
		return []Candidate{valued("q", draft.QB, 20, qValue), valued("a", draft.RB, 18, 10), valued("b", draft.RB, 12, 10),
			valued("c", draft.RB, 10, 10), valued("w1", draft.WR, 15, 10), valued("w2", draft.WR, 14, 10), valued("w3", draft.WR, 13, 10),
			valued("t", draft.TE, 9, 10), valued("w4", draft.WR, 2, w4Value), valued("q2", draft.QB, 1, q2Value),
			valued("k", draft.K, 8, 0), valued("df", draft.DEF, 7, 0)}
	}
	in := []Candidate{weekPlayer("x", draft.QB, 30)}
	cases := []struct {
		name   string
		roster []Candidate
		offer  []string
		want   string
	}{
		// Both still start once x does; dropping w3 brings w4 (2) into WR3
		// for 13, dropping c brings him into the flex for 10: c keeps more.
		// Our order alone would drop w3 (c is ahead on the id).
		{"the higher Proj kept", roster(10, 10, 10), []string{"w3", "c"}, "c"},
		// q is benched by x and his place is taken; w4 sits either way: both
		// keep the same Proj. Our order alone would drop q, valued least.
		{"a bench player before a starter", roster(1, 10, 10), []string{"q", "w4"}, "w4"},
		// Two bench players, alike in all but value.
		{"the player our order values least", roster(10, 5, 1), []string{"w4", "q2"}, "q2"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			r := newDropRule(config, Squad{Players: tc.roster}, nil)
			options := make([]dropOption, len(tc.offer))
			for i, id := range tc.offer {
				options[i] = dropOption{at: indexOf(tc.roster, id), gain: 1.23, spot: noSpot}
			}
			got, ok := r.recommend(options, nil, in)
			if !ok || tc.roster[got.at].ID != tc.want {
				t.Fatalf("recommends %v (%v), want %s", got, ok, tc.want)
			}
			// The order the options come in decides nothing.
			for i, j := 0, len(options)-1; i < j; i, j = i+1, j-1 {
				options[i], options[j] = options[j], options[i]
			}
			if again, _ := r.recommend(options, nil, in); again.at != got.at {
				t.Fatalf("reversed, recommends %s", tc.roster[again.at].ID)
			}
		})
	}
}

// Waivers marks this week's starters in the drop panel and keeps every
// one of them (review 66u, finding 1); only the row's own drop follows the
// starter rule, so a receiver's move never drops the starting QB.
func TestWaiversMarkThisWeeksStarters(t *testing.T) {
	config := twelveTeamPPR(t)
	mine := dartRoster()
	pool := []Candidate{withProj(player("x-wr", draft.WR, 5, 140), 15), withProj(player("x-qb", draft.QB, 2, 90), 30)}
	players := 0
	for _, c := range mine {
		if skill(c.Position) {
			players++
		}
	}
	for _, w := range Waivers(config, SeasonGames, Squad{Players: mine}, pool) {
		// Nothing hidden: every skill player is in the panel, the
		// rest-of-season starters too (coordinator's ruling).
		if len(w.Drops) != players {
			t.Fatalf("%s: the panel lists %d of %d players", pool[w.Add].ID, len(w.Drops), players)
		}
		marked := false
		for _, d := range w.Drops {
			if mine[d.At].ID == "m-qb2" {
				marked = d.StartsThisWeek
			}
		}
		if !marked {
			t.Fatalf("%s: the drop panel does not list m-qb2 marked as this week's starter", pool[w.Add].ID)
		}
		switch pool[w.Add].ID {
		case "x-wr":
			if w.Drop >= 0 && mine[w.Drop].ID == "m-qb2" {
				t.Fatal("a receiver's move drops this week's starting QB")
			}
		case "x-qb":
			if w.Drop < 0 {
				t.Fatal("a quarterback who keeps the lineup full has no drop")
			}
		}
	}
}

// The row on the wire carries the sentence when the drop starts this
// week, and none for a bench drop.
func TestTradeRowSaysWhoTakesTheSpot(t *testing.T) {
	config := twelveTeamPPR(t)
	a := &advisor{config: config, slots: Slots(config)}
	who := func(id, name string, pos draft.Position) person {
		return person{cand: Candidate{ID: id, Position: pos}, line: apitypes.PlayerLine{Player: apitypes.LeaguePlayer{HostId: id, Name: name}},
			words: Line{Name: name, Position: pos}}
	}
	mine := []person{who("dart", "Jaxson Dart", draft.QB), who("rodgers", "Aaron Rodgers", draft.QB)}
	theirs := []person{who("mahomes", "Patrick Mahomes", draft.QB), who("back", "Pierre Strong", draft.RB)}
	row := a.tradeRow(mine, theirs, Trade{Give: []int{1}, Get: []int{0, 1}, Drop: 0, DropFor: 0, DropSlot: 0, ForSlot: 0}, tradeWeek{})
	if row.DropReason == nil || *row.DropReason != "Dart starts at QB for you this week, and Mahomes takes that spot after the trade." {
		t.Fatalf("drop reason %v", row.DropReason)
	}
	bench := a.tradeRow(mine, theirs, Trade{Give: []int{1}, Get: []int{0, 1}, Drop: 0, DropFor: -1, DropSlot: -1, ForSlot: -1}, tradeWeek{})
	if bench.DropReason != nil {
		t.Fatalf("a bench drop says %q", *bench.DropReason)
	}
}

// The trade's sentence names the slot the incoming player takes: his
// spot, or another with the lineup kept full by a chain.
func TestTradeDropSentence(t *testing.T) {
	w := &Writer{}
	for _, tc := range []struct{ slot, bySlot, want string }{
		{"QB", "QB", "Dart starts at QB for you this week, and Mahomes takes that spot after the trade."},
		{"RB2", "Flex", "Dart starts at RB2 for you this week. After the trade Mahomes starts at Flex and your lineup stays full."},
	} {
		got := w.StarterDrop(Line{Name: "Jaxson Dart"}, Line{Name: "Patrick Mahomes"}, tc.slot, tc.bySlot, TradeMove)
		if got != tc.want {
			t.Errorf("sentence %q, want %q", got, tc.want)
		}
		guard(t, got)
	}
}

// The recommended drop is the largest rest-of-season gain among the drops
// that keep this week's lineup full (coordinator's ruling, Lane 66u): with
// every bench player but m-qb held, dropping m-qb, the rest-of-season QB,
// costs the season, while dropping m-qb2, who starts at QB this week, costs
// nothing once m-qb takes his spot; so the starter beats the bench player,
// in the trade finder and on Waivers alike.
func TestAStarterDropBeatsTheBestBenchDrop(t *testing.T) {
	config := twelveTeamPPR(t)
	mine := dartRoster()
	held := map[string]bool{"m-rb4": true, "m-wr4": true, "m-te2": true, "m-rb5": true}
	theirs := rosterWithProj(deepAtReceiver(), 6)
	squad := Squad{Players: mine, Held: held}
	// m-rb3 for t-wr4 and t-wr5, two receivers who start this week.
	checked := pairCheck(config, SeasonGames, squad, Squad{Players: theirs}, []int{3}, []int{6, 7})
	if checked.Drop < 0 || mine[checked.Drop].ID == "m-qb" || checked.DropFor < 0 {
		t.Fatalf("the trade drops %d (for %d), want a starter with a player who starts for him", checked.Drop, checked.DropFor)
	}
	f := newFiller(Slots(config), SeasonGames)
	base, _ := f.strength(pointers(mine))
	without := func(drop string) float64 {
		after := Swapped(mine, []int{3, indexOf(mine, drop)}, []Candidate{theirs[6], theirs[7]})
		s, _ := f.strength(pointers(after))
		return s - base
	}
	if dropped := mine[checked.Drop].ID; !(without(dropped) > without("m-qb")) || !near(checked.MyGain, without(dropped)) {
		t.Fatalf("gains: %s %v, m-qb %v, the trade's %v", dropped, without(dropped), without("m-qb"), checked.MyGain)
	}
	add := []Candidate{withProj(player("x-wr", draft.WR, 5, 140), 15)}
	for _, w := range Waivers(config, SeasonGames, squad, add) {
		if w.Drop < 0 || mine[w.Drop].ID == "m-qb" || w.DropSlot < 0 || w.ForSlot < 0 {
			t.Fatalf("the waiver move drops %d (%d, %d), want a starter with his spot", w.Drop, w.DropSlot, w.ForSlot)
		}
	}
}
