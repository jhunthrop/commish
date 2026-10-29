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
// the finder's ideas fill them, and fewer teams answer no idea than the
// seven his screen showed.
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
		listed := Trades(l, mine, tm.Squad, "", TradesPerTeam)
		if len(listed) == 0 {
			none++
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
			t.Log(founderWords(f, mine, tm.Squad, tr))
		}
	}
	if receivers == 0 {
		t.Fatal("no idea fills a receiver spot")
	}
	if none > 5 {
		t.Fatalf("%d teams with no idea, the founder's screen showed 7 and this read 6 before", none)
	}
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
