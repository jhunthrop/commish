package inseason

import (
	"encoding/json"
	"os"
	"strings"
	"testing"

	"github.com/jhunthrop/commish/api/internal/draft"
)

// The founder's league whole (Lane 287, ruling 4): every roster's active
// players as the advisor read them on 2026-10-28T04:09Z from the one-shot
// scratch copy (lane269_real, never production), each with his
// rest-of-season points over replacement on the board published
// 2026-10-27, his waiver level and his club's weeks to play through week
// 18. A 1QB league: QB, two RB, two WR, TE, a flex, K, DEF, seven on the
// bench, no superflex. Player names are kept for the table; team names
// are not.

const founderLeaguePath = "testdata/founder-league-2026-10-28.json"

// founderLeagueFile is the recorded league.
type founderLeagueFile struct {
	Config []draft.SlotConfig `json:"config"`
	Span   Span               `json:"span"`
	Me     int                `json:"me"`
	Teams  []founderTeam      `json:"teams"`
	Names  map[string]string  `json:"names"`
}

type founderTeam struct {
	Roster int   `json:"roster"`
	Squad  Squad `json:"squad"`
}

func loadFounderLeague(t *testing.T) (founderLeagueFile, TradeLeague, Squad) {
	t.Helper()
	raw, err := os.ReadFile(founderLeaguePath)
	if err != nil {
		t.Fatal(err)
	}
	var f founderLeagueFile
	if err := json.Unmarshal(raw, &f); err != nil {
		t.Fatal(err)
	}
	squads := make([]Squad, len(f.Teams))
	var mine Squad
	for i, tm := range f.Teams {
		squads[i] = tm.Squad
		if tm.Roster == f.Me {
			mine = tm.Squad
		}
	}
	return f, NewTradeLeague(f.Config, f.Span, squads), mine
}

// The founder's case: his lineup's weak spots are at receiver (his
// quarterback slot sits at the league's median over the weeks left: C.J.
// Stroud is the league's seventh, on bye the week the page addresses),
// the finder's ideas fill them, and none leaves him a hole he did not
// have (fix round HIGH-1: no idea sends out Stroud with no quarterback
// back). On this read that leaves ideas with three teams: eight answer no
// idea, where his screen showed seven and the old finder six.
func TestTheFoundersLeague(t *testing.T) {
	f, l, mine := loadFounderLeague(t)
	if l.Weeks() != 11 || f.Span != (Span{First: 8, Last: 18}) {
		t.Fatalf("span %+v", f.Span)
	}
	needs := l.Needs(l.Profile(mine.Players))
	if len(needs) == 0 || l.slots[needs[0].Slot].Type != draft.SlotWR {
		t.Fatalf("needs %+v, want a receiver first", needs)
	}
	for _, n := range needs {
		if l.slots[n.Slot].Type == draft.SlotQB {
			t.Fatalf("a QB need %+v", n)
		}
	}
	none, receivers := 0, 0
	for _, tm := range f.Teams {
		if tm.Roster == f.Me {
			continue
		}
		found := Find(l, mine, tm.Squad)
		listed := Narrow(found.Trades, mine, tm.Squad, "", TradesPerTeam)
		if len(listed) == 0 {
			none++
		}
		// Lane 290 (B283): each empty team's reason, as Lane 287's report reads the recorded league.
		if want := founderEmpty[tm.Roster]; found.Empty != want {
			t.Errorf("roster %d: empty reason %q, want %q", tm.Roster, found.Empty, want)
		}
		for _, tr := range listed {
			if tr.Fills >= 0 && l.slots[tr.Fills].Type == draft.SlotWR {
				receivers++
			}
			if !Acceptable(tr.MyRest, l.Weeks()) || !sideTakes(tr.TheirRest, tr.TheirGain, tr.TheirFills, l.Weeks()) || !positive(tr.MyGain) {
				t.Fatalf("listed %s", founderWords(f, mine, tm.Squad, tr))
			}
			if len(tr.Give) == 1 && f.Names[mine.Players[tr.Give[0]].ID] == "Bucky Irving" && strings.Contains(founderWords(f, mine, tm.Squad, tr), "Puka Nacua") {
				t.Fatalf("the refused trade is back: %s", founderWords(f, mine, tm.Squad, tr))
			}
			if slot, ok := openedSlot(l, mine, tm.Squad, tr); ok {
				t.Fatalf("%s leaves %s below the median team", founderWords(f, mine, tm.Squad, tr), SlotLabel(l.slots, slot))
			}
			t.Log(founderWords(f, mine, tm.Squad, tr))
		}
	}
	if receivers == 0 {
		t.Fatal("no idea fills a receiver spot")
	}
	if none != 8 {
		t.Fatalf("%d teams with no idea, the recorded read gives 8", none)
	}
}

// founderEmpty is why each of the recorded read's eight teams has no idea
// (Lane 287's report, fix round): Roar, Stroke and RayRay need receivers
// as he does; 3 Putt Par and The usal suspect need nothing; Fayettenam,
// JerkinGoff and Whats my name need a quarterback he cannot spare, so
// their ideas are dropped. Every other team lists one ("").
var founderEmpty = map[int]EmptyReason{
	1: EmptySameNeed, 9: EmptySameNeed, 12: EmptySameNeed,
	2: EmptyNoNeed, 6: EmptyNoNeed,
	7: EmptyDropped, 10: EmptyDropped, 11: EmptyDropped,
}

// openedSlot is a starting slot the trade leaves short of the median team
// by CloseCall a week or more where it was not before, or shorter by that
// much again, reckoned here from the rosters themselves (not the finder's
// own opens).
func openedSlot(l TradeLeague, mine, theirs Squad, tr Trade) (int, bool) {
	out := tr.Give
	if tr.Drop >= 0 {
		out = append(append([]int(nil), tr.Give...), tr.Drop)
	}
	before := l.Profile(mine.Players).Slots
	after := l.Profile(Swapped(mine.Players, out, candidatesOf(theirs.Players, tr.Get))).Slots
	least := CloseCall * float64(l.Weeks())
	for i := range l.slots {
		shortBefore, shortAfter := max(0, l.Median[i]-before[i]), l.Median[i]-after[i]
		if skillSlot(l.slots[i]) && shortAfter >= least && shortAfter-shortBefore >= least {
			return i, true
		}
	}
	return -1, false
}

// founderWords is a trade with each side's figures, as the report's table
// prints it.
func founderWords(f founderLeagueFile, mine, theirs Squad, tr Trade) string {
	names := func(players []Candidate, at []int) string {
		out := make([]string, len(at))
		for i, p := range at {
			out[i] = f.Names[players[p].ID]
		}
		return strings.Join(out, " + ")
	}
	return names(mine.Players, tr.Give) + " for " + names(theirs.Players, tr.Get) +
		" | lineup a week " + fmtTenth(tr.MyGain) + "/" + fmtTenth(tr.TheirGain) +
		" | rest of season " + fmtTenth(tr.MyRest) + "/" + fmtTenth(tr.TheirRest)
}

func fmtTenth(v float64) string {
	b, _ := json.Marshal(roundTenth(v))
	return string(b)
}
