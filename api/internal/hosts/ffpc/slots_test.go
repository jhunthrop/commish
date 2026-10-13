package ffpc

import (
	"slices"
	"strings"
	"testing"
)

// The slot kinds the captured pages carry. The rosters page files each
// team's active players under six position columns (QB RB WR TE PK DF)
// and says "Rostered: 20" and "IR: 0" under every team's name: no team
// had a player on injured reserve when it was captured, and the page has
// no IR or taxi column. The lineup page has two tables, the starting
// lineup and the bench; an injury designation (James Conner's "IR") is a
// mark on a bench row, not a slot. De'Von Achane is on no roster of
// #104870 in this capture.
func TestSlotKindsInTheCapture(t *testing.T) {
	list, err := ParseRosters(fixture(t, "ffpc-rosters.html"))
	if err != nil {
		t.Fatal(err)
	}
	for _, r := range list {
		if r.ReserveCount != 0 || len(r.Reserve) != 0 || len(r.Taxi) != 0 {
			t.Fatalf("team %d: IR %d, %d reserve, %d taxi", r.TeamID, r.ReserveCount, len(r.Reserve), len(r.Taxi))
		}
		for _, p := range r.Players {
			if strings.Contains(p.Name, "Achane") {
				t.Fatalf("Achane on team %d", r.TeamID)
			}
		}
	}
	lineup := fixture(t, "ffpc-team-lineup.html")
	doc, err := parse(lineup)
	if err != nil {
		t.Fatal(err)
	}
	if got := otherRepeaters(doc); len(got) != 0 {
		t.Fatalf("tables beyond the starting lineup and bench: %v", got)
	}
	if !strings.Contains(string(lineup), `>IR</span>`) {
		t.Fatal("the lineup capture lost its IR designation")
	}
}

// A player the rosters page files outside a position column (an IR or
// taxi column, or a line under the team's name) is rostered, on the slot
// the column names, with his position read from his line when it is
// written there.
func TestRostersReadEverySlot(t *testing.T) {
	page := string(fixture(t, "ffpc-rosters.html"))
	header := `<th class="center" scope="col">DF</th>`
	page = strings.Replace(page, header, header+`<th class="center" scope="col">IR</th><th class="center" scope="col">Taxi</th>`, 1)
	row0 := strings.Index(page, `trTeamNameAndRoster_0"`)
	end := row0 + strings.Index(page[row0:], `</tr>`)
	page = page[:end] +
		`<td><div><a href="PlayerProfile.aspx?playerID=28991&amp;leagueID=104870">De'Von Achane</a>&nbsp;(MIA) RB</div></td>` +
		`<td><div><a href="PlayerProfile.aspx?playerID=29999&amp;leagueID=104870">Kyle Monangai Jr.</a>&nbsp;(CHI) RB</div></td>` +
		page[end:]
	page = strings.Replace(page, `IR: 0</i>`, `IR: 1</i><br><a href="PlayerProfile.aspx?playerID=26916&amp;leagueID=104870">James Conner</a>&nbsp;(ARI)`, 1)
	list, err := ParseRosters([]byte(page))
	if err != nil {
		t.Fatal(err)
	}
	r := list[0]
	if len(r.Players) != 20 || r.ReserveCount != 1 {
		t.Fatalf("%d active, IR %d", len(r.Players), r.ReserveCount)
	}
	wantReserve := []Player{
		{ID: "26916", Name: "James Conner", Team: "ARI"},
		{ID: "28991", Name: "De'Von Achane", Position: RB, Team: "MIA"},
	}
	if !slices.Equal(r.Reserve, wantReserve) {
		t.Fatalf("reserve %+v", r.Reserve)
	}
	if len(r.Taxi) != 1 || r.Taxi[0] != (Player{ID: "29999", Name: "Kyle Monangai Jr.", Position: RB, Team: "CHI"}) {
		t.Fatalf("taxi %+v", r.Taxi)
	}
}

// A lineup table other than the starting lineup and the bench files its
// players by its name: a taxi table as taxi, any other as reserve.
func TestLineupReadsEveryTable(t *testing.T) {
	lineup := string(fixture(t, "ffpc-team-lineup.html"))
	for rep, slot := range map[string]string{"rptInjuredReserve": SlotReserve, "rptTaxiSquad": SlotTaxi} {
		l, err := ParseLineup([]byte(strings.ReplaceAll(lineup, "rptBench", rep)))
		if err != nil {
			t.Fatal(err)
		}
		got := map[string]int{SlotReserve: len(l.Reserve), SlotTaxi: len(l.Taxi), SlotBench: len(l.Bench)}
		if got[slot] != 10 || got[SlotBench] != 0 || len(l.Starters) != 10 {
			t.Fatalf("%s: %v with %d starters", rep, got, len(l.Starters))
		}
	}
}
