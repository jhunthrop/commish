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

// James Conner's IR designation on the captured lineup page marks him IR;
// no other player there carries one.
func TestLineupReadsTheIRDesignation(t *testing.T) {
	l, err := ParseLineup(fixture(t, "ffpc-team-lineup.html"))
	if err != nil {
		t.Fatal(err)
	}
	var marked []string
	for _, p := range append(append([]Player{}, l.Starters...), l.Bench...) {
		if p.IR {
			marked = append(marked, p.Name)
		}
	}
	if !slices.Equal(marked, []string{"James Conner"}) {
		t.Fatalf("marked IR: %v", marked)
	}
}

// Inferred, not yet seen in a capture (2026-10-14): the captured rosters
// page has no IR, taxi or other column and no player under a team's
// name, so this test writes them into it. A column headed IR files its
// players as reserve, one headed Taxi as taxi, and any other column or a
// line under the team's name as rostered with no mark, its heading named.
// Each player keeps the team written beside him, two in one cell too.
func TestRostersReadInferredSlots(t *testing.T) {
	page := string(fixture(t, "ffpc-rosters.html"))
	header := `<th class="center" scope="col">DF</th>`
	page = strings.Replace(page, header, header+
		`<th class="center" scope="col">IR</th><th class="center" scope="col">Taxi</th><th class="center" scope="col">Suspended</th>`, 1)
	row0 := strings.Index(page, `trTeamNameAndRoster_0"`)
	end := row0 + strings.Index(page[row0:], `</tr>`)
	page = page[:end] +
		`<td><div><a href="PlayerProfile.aspx?playerID=28991&amp;leagueID=104870">De'Von Achane</a>&nbsp;(MIA) RB</div></td>` +
		`<td><div><a href="PlayerProfile.aspx?playerID=29999&amp;leagueID=104870">Kyle Monangai Jr.</a>&nbsp;(CHI) RB</div></td>` +
		`<td><div><a href="PlayerProfile.aspx?playerID=28001&amp;leagueID=104870">Rashee Rice</a>&nbsp;(KC) WR</div></td>` +
		page[end:]
	page = strings.Replace(page, `IR: 0</i>`, `IR: 1</i><br><a href="PlayerProfile.aspx?playerID=26916&amp;leagueID=104870">James Conner</a>&nbsp;(ARI)`+
		`<br><a href="PlayerProfile.aspx?playerID=27001&amp;leagueID=104870">Nick Chubb</a>&nbsp;(HOU) RB`, 1)
	got, err := ParseRostersPage([]byte(page))
	if err != nil {
		t.Fatal(err)
	}
	if !slices.Equal(got.OtherColumns, []string{"Suspended"}) {
		t.Fatalf("other columns %v", got.OtherColumns)
	}
	r := got.Teams[0]
	if r.ReserveCount != 1 || len(r.Players) != 23 {
		t.Fatalf("IR %d, %d rostered unmarked", r.ReserveCount, len(r.Players))
	}
	for _, want := range []Player{
		{ID: "26916", Name: "James Conner", Team: "ARI"},
		{ID: "27001", Name: "Nick Chubb", Position: RB, Team: "HOU"},
	} {
		if !slices.Contains(r.Players, want) {
			t.Fatalf("%s under the team's name is not rostered as written: %+v", want.Name, r.Players)
		}
	}
	if !slices.Contains(r.Players, Player{ID: "28001", Name: "Rashee Rice", Position: WR, Team: "KC"}) {
		t.Fatalf("the unknown column's player is not rostered: %+v", r.Players)
	}
	if !slices.Equal(r.Reserve, []Player{{ID: "28991", Name: "De'Von Achane", Position: RB, Team: "MIA"}}) {
		t.Fatalf("reserve %+v", r.Reserve)
	}
	if len(r.Taxi) != 1 || r.Taxi[0] != (Player{ID: "29999", Name: "Kyle Monangai Jr.", Position: RB, Team: "CHI"}) {
		t.Fatalf("taxi %+v", r.Taxi)
	}
}

// Inferred, not yet seen in a capture (2026-10-14): a lineup table other
// than the starting lineup and the bench files its players by its name,
// an IR table as reserve, a taxi table as taxi, any other on the bench.
func TestLineupReadsInferredTables(t *testing.T) {
	lineup := string(fixture(t, "ffpc-team-lineup.html"))
	for rep, slot := range map[string]string{"rptInjuredReserve": SlotReserve, "rptTaxiSquad": SlotTaxi, "rptSuspended": SlotBench} {
		l, err := ParseLineup([]byte(strings.ReplaceAll(lineup, "rptBench", rep)))
		if err != nil {
			t.Fatal(err)
		}
		got := map[string]int{SlotReserve: len(l.Reserve), SlotTaxi: len(l.Taxi), SlotBench: len(l.Bench)}
		if got[slot] != 10 || len(l.Reserve)+len(l.Taxi)+len(l.Bench) != 10 || len(l.Starters) != 10 {
			t.Fatalf("%s: %v with %d starters", rep, got, len(l.Starters))
		}
	}
}
