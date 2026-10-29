package inseason

import (
	"testing"
)

// The builder checks a trade on the finder's own reckoning: every trade
// the finder lists answers the finder's numbers and drop, both rosters
// filling every slot.
func TestCheckGivesTheFindersNumbers(t *testing.T) {
	config := twelveTeamPPR(t)
	mine, theirs := deepAtBack(), deepAtReceiver()
	held := map[string]bool{"m-wr4": true}
	me, them := Squad{Players: mine, Held: held}, Squad{Players: theirs}
	found := pairTrades(config, SeasonGames, me, them, "", 1000)
	if len(found) == 0 {
		t.Fatal("the finder found no trade")
	}
	for _, tr := range found {
		got := pairCheck(config, SeasonGames, me, them, tr.Give, tr.Get)
		words := tradeWords(tr, mine, theirs)
		if got.MyGain != tr.MyGain || got.TheirGain != tr.TheirGain || got.Drop != tr.Drop {
			t.Fatalf("%s: checked %+v, the finder %+v", words, got.Trade, tr)
		}
		if !got.Mine.Fills || !got.Theirs.Fills || got.Mine.Open >= 0 || got.Theirs.Open >= 0 {
			t.Fatalf("%s: fills %+v %+v", words, got.Mine, got.Theirs)
		}
	}
}

// A trade the finder would never offer is still answered: the member's
// lineup loses, said as a gain below zero.
func TestCheckAnswersALoss(t *testing.T) {
	mine, theirs := deepAtBack(), deepAtReceiver()
	// His best back for their third.
	got := pairCheck(twelveTeamPPR(t), SeasonGames, Squad{Players: mine}, Squad{Players: theirs}, []int{1}, []int{2})
	if got.MyGain >= 0 || got.TheirGain <= 0 {
		t.Fatalf("m-rb1 for t-rb2: mine %v, theirs %v", got.MyGain, got.TheirGain)
	}
	if !got.Mine.Fills || !got.Theirs.Fills {
		t.Fatalf("fills %+v %+v", got.Mine, got.Theirs)
	}
}

// A trade that empties a slot says which: both tight ends for a receiver
// leaves the member's TE open, and theirs fills.
func TestCheckNamesTheSlotItEmpties(t *testing.T) {
	config := twelveTeamPPR(t)
	mine, theirs := deepAtBack(), deepAtReceiver()
	got := pairCheck(config, SeasonGames, Squad{Players: mine}, Squad{Players: theirs}, []int{8, 12}, []int{3})
	if got.Mine.Fills || got.Mine.Open < 0 || SlotLabel(Slots(config), got.Mine.Open) != "TE" {
		t.Fatalf("mine %+v", got.Mine)
	}
	if !got.Theirs.Fills || got.Theirs.Open >= 0 {
		t.Fatalf("theirs %+v", got.Theirs)
	}
}

// Two for two is the builder's reach: no drop, both gains reckoned.
func TestCheckTwoForTwo(t *testing.T) {
	mine, theirs := deepAtBack(), deepAtReceiver()
	got := pairCheck(twelveTeamPPR(t), SeasonGames, Squad{Players: mine}, Squad{Players: theirs}, []int{3, 4}, []int{6, 7})
	if got.Drop >= 0 || !positive(got.MyGain) || !positive(got.TheirGain) {
		t.Fatalf("m-rb3+m-rb4 for t-wr4+t-wr5: %+v", got.Trade)
	}
}

// A two-for-one into a full roster names the drop even when the member's
// lineup loses: the roster still needs the room.
func TestCheckNamesTheDropOnALoss(t *testing.T) {
	mine, theirs := deepAtBack(), deepAtReceiver()
	got := pairCheck(twelveTeamPPR(t), SeasonGames, Squad{Players: mine}, Squad{Players: theirs}, []int{1}, []int{2, 11})
	if got.MyGain >= 0 || got.Drop < 0 {
		t.Fatalf("m-rb1 for t-rb2+t-rb3: %+v", got.Trade)
	}
}

func TestSlotLabels(t *testing.T) {
	slots := Slots(tenTeamHalfSuperflex(t))
	var got []string
	for i := range slots {
		got = append(got, SlotLabel(slots, i))
	}
	want := []string{"QB", "RB1", "RB2", "WR1", "WR2", "TE", "Flex", "Superflex", "K", "DEF"}
	if len(got) != len(want) {
		t.Fatalf("labels %v", got)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("labels %v, want %v", got, want)
		}
	}
}

// A two-for-one into a full roster where every player it could drop is
// held has no room: no drop named, Room false. With a player free to
// drop it has room and names him. Their side is reckoned the same way.
func TestCheckSaysWhenARosterHasNoRoom(t *testing.T) {
	config := twelveTeamPPR(t)
	mine, theirs := deepAtBack(), deepAtReceiver()
	held := map[string]bool{}
	for _, c := range mine {
		held[c.ID] = true
	}
	got := pairCheck(config, SeasonGames, Squad{Players: mine, Held: held}, Squad{Players: theirs}, []int{1}, []int{2, 11})
	if got.Mine.Room || got.Drop >= 0 || !got.Mine.Fills {
		t.Fatalf("all held: %+v drop %d", got.Mine, got.Drop)
	}
	free := pairCheck(config, SeasonGames, Squad{Players: mine}, Squad{Players: theirs}, []int{1}, []int{2, 11})
	if !free.Mine.Room || free.Drop < 0 {
		t.Fatalf("none held: %+v drop %d", free.Mine, free.Drop)
	}
	back := pairCheck(config, SeasonGames, Squad{Players: mine}, Squad{Players: theirs}, []int{3, 4}, []int{6})
	if !back.Theirs.Room || !back.Mine.Room {
		t.Fatalf("two for one of theirs: %+v %+v", back.Mine, back.Theirs)
	}
}
