package boards

import (
	"encoding/json"
	"os"
	"strings"
	"testing"
)

// designationCodes is the table both lanes read the provider's codes by:
// research/nightly/designations.py pins the same file.
type designationCodes struct {
	Codes           map[string]string `json:"codes"`
	SeasonLong      []string          `json:"season_long"`
	OutForTheSeason string            `json:"out_for_the_season"`
}

func readDesignationCodes(t *testing.T) designationCodes {
	t.Helper()
	raw, err := os.ReadFile("../../testdata/designation-codes.json")
	if err != nil {
		t.Fatal(err)
	}
	var table designationCodes
	if err := json.Unmarshal(raw, &table); err != nil {
		t.Fatal(err)
	}
	return table
}

func TestStatusOfReadsTheSharedTable(t *testing.T) {
	table := readDesignationCodes(t)
	for code, want := range table.Codes {
		if got := StatusOf(code); got != want {
			t.Errorf("StatusOf(%q) = %q, want %q", code, got, want)
		}
		if got := StatusOf(" " + strings.ToLower(code) + " "); got != want {
			t.Errorf("StatusOf(%q) padded and lower case = %q", code, got)
		}
	}
	if got := StatusOf("x"); got != "" {
		t.Errorf("an unknown code reads %q, want none", got)
	}
	if len(designationCodeTable()) != len(table.Codes) {
		t.Errorf("the Go table has %d codes, the shared file %d", len(designationCodeTable()), len(table.Codes))
	}
	season := map[string]bool{}
	for _, s := range table.SeasonLong {
		season[s] = true
	}
	for _, status := range Statuses() {
		if SeasonLong(status, "") != season[status] {
			t.Errorf("SeasonLong(%q) disagrees with the shared file (%v)", status, season[status])
		}
	}
	if table.OutForTheSeason != outForTheSeason {
		t.Errorf("the note's words are %q here, %q in the shared file", outForTheSeason, table.OutForTheSeason)
	}
}

func TestOutForTheSeasonByTheNote(t *testing.T) {
	for _, tc := range []struct {
		status, note string
		want         bool
	}{
		{StatusOut, "Out for the season (knee)", true},
		{StatusOut, "Placed on IR, OUT FOR THE SEASON.", true},
		{StatusOut, "Out this week (ankle)", false},
		{StatusDoubtful, "out for the season", false},
		{StatusInjuredReserve, "", true},
	} {
		if got := SeasonLong(tc.status, tc.note); got != tc.want {
			t.Errorf("SeasonLong(%q, %q) = %v", tc.status, tc.note, got)
		}
	}
}

// The codes a season-long status is listed under, for the run read.
func TestSeasonLongCodes(t *testing.T) {
	codes, statuses := seasonLongCodes()
	if len(codes) != len(statuses) || len(codes) == 0 {
		t.Fatalf("codes %v statuses %v", codes, statuses)
	}
	for i, code := range codes {
		if StatusOf(code) != statuses[i] || !SeasonLong(statuses[i], "") {
			t.Errorf("%q lists %q", code, statuses[i])
		}
	}
}
