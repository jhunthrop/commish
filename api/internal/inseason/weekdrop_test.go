package inseason

import (
	"strings"
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
		if tr.DropFor >= 0 {
			t.Fatalf("%s says its return takes a bench player's spot", tradeWords(tr, mine, theirs))
		}
	}
	if drops == 0 {
		t.Fatal("no trade grows the roster")
	}
}

// When the only drop is one of this week's starters, the trade is kept
// only when its return takes his spot, and it says who does (Lane 66u):
// with every bench player but m-qb2 held, a two-for-one that brings in a
// quarterback who starts at QB drops him; one that brings in two
// receivers has no room.
func TestAStarterGoesOnlyForHisSpot(t *testing.T) {
	config := twelveTeamPPR(t)
	mine := dartRoster()
	theirs := set(deepAtReceiver(), "t-qb", func(c Candidate) Candidate { return withProj(c, 22) })
	held := map[string]bool{"m-rb4": true, "m-wr4": true, "m-te2": true, "m-rb5": true}
	got := Trades(config, SeasonGames, Squad{Players: mine, Held: held}, Squad{Players: theirs}, "", 1000)
	seen := map[string]bool{}
	for _, tr := range got {
		words := tradeWords(tr, mine, theirs)
		seen[words] = true
		if tr.Drop < 0 {
			continue
		}
		if mine[tr.Drop].ID != "m-qb2" {
			t.Fatalf("%s drops %s, a held or starting player", words, mine[tr.Drop].ID)
		}
		if tr.DropFor < 0 || theirs[tr.Get[tr.DropFor]].Position != draft.QB {
			t.Fatalf("%s drops this week's starting QB and nobody it brings in takes his spot", words)
		}
		if SlotLabel(Slots(config), tr.DropSlot) != "QB" {
			t.Fatalf("%s: his spot is %s", words, SlotLabel(Slots(config), tr.DropSlot))
		}
	}
	if !seen["m-qb for t-qb+t-wr5"] {
		t.Fatalf("trades %v miss m-qb for t-qb+t-wr5, which brings in this week's QB", seen)
	}
	for words := range seen {
		if strings.HasSuffix(words, "t-wr4+t-wr5") {
			t.Fatalf("%s has no room: its only drop starts this week and two receivers do not take his spot", words)
		}
	}
	// The builder answers the same trade the same way.
	checked := Check(config, SeasonGames, Squad{Players: mine, Held: held}, Squad{Players: theirs}, []int{0}, []int{0, 7})
	if checked.Drop < 0 || mine[checked.Drop].ID != "m-qb2" || checked.DropFor != 0 {
		t.Fatalf("the builder's drop %d for %d", checked.Drop, checked.DropFor)
	}
}

// Waivers reads the same rule: a player this week's lineup starts is
// dropped only for an add who takes his spot this week, so a receiver's
// drops never list the starting QB.
func TestWaiversKeepThisWeeksStarters(t *testing.T) {
	config := twelveTeamPPR(t)
	mine := dartRoster()
	pool := []Candidate{withProj(player("x-wr", draft.WR, 5, 140), 15), withProj(player("x-qb", draft.QB, 2, 90), 30)}
	for _, w := range Waivers(config, SeasonGames, Squad{Players: mine}, pool) {
		lists := false
		for _, d := range w.Drops {
			lists = lists || mine[d.At].ID == "m-qb2"
		}
		switch pool[w.Add].ID {
		case "x-wr":
			if lists || (w.Drop >= 0 && mine[w.Drop].ID == "m-qb2") {
				t.Fatal("a receiver's drops list this week's starting QB")
			}
		case "x-qb":
			if !lists {
				t.Fatal("a quarterback who takes the QB spot this week cannot replace the starter there")
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
		return person{cand: Candidate{ID: id, Position: pos}, line: apitypes.PlayerLine{Player: apitypes.LeaguePlayer{HostId: id, Name: name}}, words: Line{Name: name, Position: pos}}
	}
	mine := []person{who("dart", "Jaxson Dart", draft.QB), who("rodgers", "Aaron Rodgers", draft.QB)}
	theirs := []person{who("mahomes", "Patrick Mahomes", draft.QB), who("back", "Pierre Strong", draft.RB)}
	row := a.tradeRow(mine, theirs, Trade{Give: []int{1}, Get: []int{0, 1}, Drop: 0, DropFor: 0, DropSlot: 0}, tradeWeek{})
	if row.DropReason == nil || *row.DropReason != "Dart starts at QB for you this week, and Mahomes takes that spot after the trade." {
		t.Fatalf("drop reason %v", row.DropReason)
	}
	bench := a.tradeRow(mine, theirs, Trade{Give: []int{1}, Get: []int{0, 1}, Drop: 0, DropFor: -1, DropSlot: -1}, tradeWeek{})
	if bench.DropReason != nil {
		t.Fatalf("a bench drop says %q", *bench.DropReason)
	}
}

// The trade's sentence says the drop starts this week and who takes his
// spot.
func TestTradeDropSentence(t *testing.T) {
	w := &Writer{}
	got := w.TradeDrop(Line{Name: "Jaxson Dart"}, Line{Name: "Patrick Mahomes"}, "QB")
	want := "Dart starts at QB for you this week, and Mahomes takes that spot after the trade."
	if got != want {
		t.Fatalf("sentence %q, want %q", got, want)
	}
}
