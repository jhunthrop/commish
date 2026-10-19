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
	for _, tr := range Trades(config, SeasonGames, Squad{Players: benched}, Squad{Players: theirs}, "", 1000) {
		dropsHim = dropsHim || (tr.Drop >= 0 && benched[tr.Drop].ID == "m-qb2")
	}
	if !dropsHim {
		t.Fatal("the case is gone: no trade drops the benched m-qb2")
	}
	drops := 0
	for _, tr := range Trades(config, SeasonGames, Squad{Players: mine}, Squad{Players: theirs}, "", 1000) {
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
	for _, tr := range Trades(config, SeasonGames, Squad{Players: mine, Held: held}, Squad{Players: theirs}, "", 1000) {
		words := tradeWords(tr, mine, theirs)
		seen[words] = tr
		if tr.Drop < 0 {
			continue
		}
		if mine[tr.Drop].ID != "m-qb2" {
			t.Fatalf("%s drops %s, a held or starting player", words, mine[tr.Drop].ID)
		}
		if tr.DropFor < 0 || tr.ForSlot < 0 || !slots[tr.ForSlot].accepts(theirs[tr.Get[tr.DropFor]].Position) {
			t.Fatalf("%s drops this week's starting QB and names nobody who starts in his place", words)
		}
	}
	tr, ok := seen["m-qb for t-qb+t-wr5"]
	if !ok || tr.DropFor != 0 || SlotLabel(slots, tr.DropSlot) != "QB" || tr.ForSlot != tr.DropSlot {
		t.Fatalf("m-qb for t-qb+t-wr5: %+v (found %v), want t-qb in m-qb2's QB spot", tr, ok)
	}
	// The builder answers the same trade the same way, and refuses one that
	// leaves the QB spot empty this week.
	checked := Check(config, SeasonGames, Squad{Players: mine, Held: held}, Squad{Players: theirs}, []int{0}, []int{0, 7})
	if checked.Drop < 0 || mine[checked.Drop].ID != "m-qb2" || checked.DropFor != 0 {
		t.Fatalf("the builder's drop %d for %d", checked.Drop, checked.DropFor)
	}
	empty := Check(config, SeasonGames, Squad{Players: mine, Held: held}, Squad{Players: theirs}, []int{0}, []int{6, 7})
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
			got := r.takesHisSpot(d, nil, []Candidate{tc.in})
			if tc.want == "" {
				if got.by >= 0 {
					t.Fatalf("kept with %s at %s", tc.in.ID, SlotLabel(slots, got.slot))
				}
				return
			}
			if got.by != 0 || SlotLabel(slots, got.slot) != tc.want {
				t.Fatalf("%+v, want x at %s", got, tc.want)
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
	for _, w := range Waivers(config, SeasonGames, Squad{Players: mine}, pool) {
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
		got := w.TradeDrop(Line{Name: "Jaxson Dart"}, Line{Name: "Patrick Mahomes"}, tc.slot, tc.bySlot)
		if got != tc.want {
			t.Errorf("sentence %q, want %q", got, tc.want)
		}
		guard(t, got)
	}
}
