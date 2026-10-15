package espn

import (
	"os"
	"strings"
	"testing"
)

// The documented shape may differ from the live one: abbrev in any case,
// seasonId and groupId as a number or a numeric string. Nothing is
// invented: a value that is neither reads as absent and the entry is
// skipped.
func TestParseMyLeaguesToleratesLiveVariants(t *testing.T) {
	raw, err := os.ReadFile("testdata/fan-2026.json")
	if err != nil {
		t.Fatal(err)
	}
	fan := string(raw)
	cases := map[string]string{
		"upper abbrev":    strings.Replace(fan, `"abbrev": "ffl"`, `"abbrev": "FFL"`, 1),
		"string seasonId": strings.Replace(fan, `"seasonId": 2026`, `"seasonId": "2026"`, 1),
		"string groupId":  strings.Replace(fan, `"groupId": 48153503`, `"groupId": "48153503"`, 1),
		"all three": strings.NewReplacer(
			`"abbrev": "ffl"`, `"abbrev": "Ffl"`, `"seasonId": 2026`, `"seasonId": "2026"`, `"groupId": 48153503`, `"groupId": "48153503"`,
		).Replace(fan),
	}
	for name, body := range cases {
		if body == fan {
			t.Fatalf("%s: the variant changed nothing", name)
		}
		list, err := ParseMyLeagues([]byte(body), 2026)
		if err != nil || len(list) != 1 || list[0].LeagueID != "48153503" || list[0].Teams != 14 {
			t.Fatalf("%s: %+v, %v", name, list, err)
		}
	}
}

// A value that is no whole number reads as absent, so the entry is
// skipped and the answer is not an error.
func TestParseMyLeaguesSkipsWhatIsNoNumber(t *testing.T) {
	const entry = `{"preferences":[{"metaData":{"entry":{"abbrev":"ffl","seasonId":%s,"groups":[{"groupId":%s}]}}}]}`
	for _, pair := range [][2]string{{`"x"`, `9`}, {`true`, `9`}, {`null`, `9`}, {`{}`, `9`}, {`"20.5"`, `9`}, {`2026`, `"nine"`}, {`2026`, `9.5`}, {`2026`, `[]`}} {
		body := strings.Replace(strings.Replace(entry, "%s", pair[0], 1), "%s", pair[1], 1)
		if list, err := ParseMyLeagues([]byte(body), 2026); err != nil || len(list) != 0 {
			t.Fatalf("season %s, group %s: %+v, %v", pair[0], pair[1], list, err)
		}
	}
}
