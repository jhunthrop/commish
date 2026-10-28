package sheets

import (
	"fmt"
	"strings"
	"testing"

	"github.com/jhunthrop/commish/api/internal/boards"
	"github.com/jhunthrop/commish/api/internal/draft"
)

// board is web/src/lib/sheet/paste.test.ts's board, with two players who
// share a name and a player with an accent and a suffix.
func board() *boards.Raw {
	return &boards.Raw{Players: []boards.Player{
		{ID: "4429795", Name: "Jahmyr Gibbs", Position: draft.RB, Team: "DET"},
		{ID: "3055899", Name: "Brandon Aubrey", Position: draft.K, Team: "DAL"},
		{ID: "DST-BUF", Name: "Buffalo Bills", Position: draft.DEF, Team: "BUF"},
		{ID: "DST-KC", Name: "Kansas City Chiefs", Position: draft.DEF, Team: "KC"},
		{ID: "DST-LAR", Name: "Los Angeles Rams", Position: draft.DEF, Team: "LAR"},
		{ID: "DST-LAC", Name: "Los Angeles Chargers", Position: draft.DEF, Team: "LAC"},
		{ID: "wr-1", Name: "Michael Thomas", Position: draft.WR, Team: "NO"},
		{ID: "te-1", Name: "Michael Thomas", Position: draft.TE, Team: "FA"},
		{ID: "rb-2", Name: "Travis Etienne Jr.", Position: draft.RB, Team: "JAX"},
		{ID: "wr-2", Name: "Audric Estimé", Position: draft.WR, Team: ""},
	}}
}

// found is the player one pasted line finds, or the reason it was skipped.
func found(line string) string {
	rows, skipped := ReadList(line, board())
	if len(rows) > 0 {
		return rows[0].PlayerId
	}
	if len(skipped) > 0 {
		return skipped[0].Reason
	}
	return "nothing"
}

func TestAKickerIsFoundByNameWithOrWithoutPosition(t *testing.T) {
	for _, line := range []string{"Brandon Aubrey", "Brandon Aubrey, K", "7. Brandon Aubrey (PK, DAL)"} {
		if got := found(line); got != "3055899" {
			t.Errorf("%q found %q", line, got)
		}
	}
}

func TestADefenseIsFoundByNameClubNicknameOrCity(t *testing.T) {
	for _, line := range []string{"Buffalo Bills", "Bills D/ST", "BUF DST", "Buffalo Defense", "Bills, DEF", "14. BUF D/ST", "Bills"} {
		if got := found(line); got != "DST-BUF" {
			t.Errorf("%q found %q", line, got)
		}
	}
	for line, want := range map[string]string{"Chiefs D/ST": "DST-KC", "Kansas City Chiefs DST": "DST-KC", "KC": "DST-KC"} {
		if got := found(line); got != want {
			t.Errorf("%q found %q, want %q", line, got, want)
		}
	}
}

func TestACityTwoClubsShareIsNeverGuessed(t *testing.T) {
	if got := found("Los Angeles D/ST"); got != "Two clubs share this city. Write the club, like LAR" {
		t.Errorf("found %q", got)
	}
	if got := found("Rams D/ST"); got != "DST-LAR" {
		t.Errorf("found %q", got)
	}
	if got := found("LAC DST"); got != "DST-LAC" {
		t.Errorf("found %q", got)
	}
}

func TestASkillPlayerNeedsHisWholeName(t *testing.T) {
	if got := found("Jahmyr Gibbs, RB"); got != "4429795" {
		t.Errorf("found %q", got)
	}
	if got := found("Gibbs"); got != reasonNoPlayer {
		t.Errorf("found %q", got)
	}
}

func TestANameSharedByTwoPlayersNeedsAPosition(t *testing.T) {
	if got := found("Michael Thomas"); got != reasonTwoPlayers {
		t.Errorf("found %q", got)
	}
	if got := found("Michael Thomas, TE"); got != "te-1" {
		t.Errorf("found %q", got)
	}
	if got := found("3) Michael Thomas (WR, NO)"); got != "wr-1" {
		t.Errorf("found %q", got)
	}
}

func TestCaseAccentsPunctuationAndSuffixAreSetAside(t *testing.T) {
	for line, want := range map[string]string{
		"travis etienne": "rb-2", "Travis Etienne Jr": "rb-2", "TRAVIS ETIENNE, JR.": "rb-2",
		"Audric Estime": "wr-2", "audric  estimé": "wr-2",
	} {
		if got := found(line); got != want {
			t.Errorf("%q found %q, want %q", line, got, want)
		}
	}
}

func TestAListKeepsOrderSkipsRepeatsAndUnknownsByLine(t *testing.T) {
	body := "1. Jahmyr Gibbs\r\n\r\n2. Nobody Real\n3. Brandon Aubrey\n4. Gibbs, RB\n5. Jahmyr Gibbs\n6. Michael Thomas"
	rows, skipped := ReadList(body, board())
	var ids []string
	for _, r := range rows {
		ids = append(ids, r.PlayerId)
	}
	if got := strings.Join(ids, ","); got != "4429795,3055899" {
		t.Errorf("read %s", got)
	}
	want := "3: " + reasonNoPlayer + "|5: " + reasonNoPlayer + "|6: " + reasonRepeat + "|7: " + reasonTwoPlayers
	var got []string
	for _, s := range skipped {
		got = append(got, fmt.Sprintf("%d: %s", s.Line, s.Reason))
	}
	if strings.Join(got, "|") != want {
		t.Errorf("skipped %v", got)
	}
}

func TestADefenseRowIsStoredAsDSTWithItsClub(t *testing.T) {
	rows, _ := ReadList("Bills D/ST", board())
	if len(rows) != 1 || rows[0].Position != "DST" || rows[0].Team == nil || *rows[0].Team != "BUF" {
		t.Fatalf("read %+v", rows)
	}
	free, _ := ReadList("Audric Estime", board())
	if len(free) != 1 || free[0].Team != nil {
		t.Fatalf("a free agent has no club: %+v", free)
	}
}

func TestASheetHoldsAtMostItsLimit(t *testing.T) {
	raw := &boards.Raw{}
	var lines []string
	for i := 0; i < MaxRows+1; i++ {
		name := fmt.Sprintf("Player %s", strings.Repeat("x", i%7)+fmt.Sprint(i))
		raw.Players = append(raw.Players, boards.Player{ID: fmt.Sprint(i), Name: name, Position: draft.WR})
		lines = append(lines, name)
	}
	rows, skipped := ReadList(strings.Join(lines, "\n"), raw)
	if len(rows) != MaxRows || len(skipped) != 1 || skipped[0].Reason != fmt.Sprintf(reasonSheetIsFull, MaxRows) {
		t.Fatalf("read %d, skipped %v", len(rows), skipped)
	}
}

func TestACSVIsToldFromAList(t *testing.T) {
	cases := map[string]bool{
		"rank,player_id,name,position\n1,a,B,QB": true,
		"\uFEFF  RANK,Player_ID,Name,Position":   true,
		"name,team\nJa'Marr Chase,CIN":           false,
		"1. Puka Nacua":                          false,
		"":                                       false,
	}
	for body, want := range cases {
		if got := looksLikeCSV(body); got != want {
			t.Errorf("looksLikeCSV(%q) = %v", body, got)
		}
	}
}
