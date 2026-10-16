package mfl

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func replay(t *testing.T, name string) []byte {
	t.Helper()
	b, err := os.ReadFile(filepath.Join("..", "leaguesync", "replay", "mfl", name))
	if err != nil {
		t.Fatal(err)
	}
	return b
}

// The recorded league (2026-10-13) states its last regular-season week
// (14) and its last week (17); the recorded status its completed week (5).
func TestLeagueAndStatusCalendar(t *testing.T) {
	l, err := DecodeLeague(replay(t, "league.json"), 2026, "10010")
	if err != nil {
		t.Fatal(err)
	}
	if l.LastRegularSeasonWeek != 14 || l.EndWeek != 17 {
		t.Fatalf("regular season to week %d, season to week %d", l.LastRegularSeasonWeek, l.EndWeek)
	}
	st, err := DecodeStatus(replay(t, "status.json"))
	if err != nil || st.CompletedWeek != 5 || st.CurrentWeek != 6 {
		t.Fatalf("status %+v (%v)", st, err)
	}
}

// Draft results as MyFantasyLeague's export documents them (TYPE=
// draftResults: draftResults.draftUnit, one unit or a list, each with its
// draftPick list, a pick not yet made carrying no player). Constructed,
// not recorded: no recorded league's draft results were captured.
func TestDecodeDraftResults(t *testing.T) {
	cases := []struct {
		name        string
		body        string
		picks, made int
	}{
		{"every pick made",
			`{"draftResults":{"draftUnit":{"unit":"LEAGUE","draftType":"SDRAFT","draftPick":[` +
				`{"franchise":"0001","round":"01","pick":"01","player":"13604","timestamp":"1788130860"},` +
				`{"franchise":"0002","round":"01","pick":"02","player":"14777","timestamp":"1788130920"}]}}}`, 2, 2},
		{"one made of two",
			`{"draftResults":{"draftUnit":{"unit":"LEAGUE","draftPick":[` +
				`{"franchise":"0001","round":"01","pick":"01","player":"13604","timestamp":"1788130860"},` +
				`{"franchise":"0002","round":"01","pick":"02","player":"","timestamp":""}]}}}`, 2, 1},
		{"two divisions",
			`{"draftResults":{"draftUnit":[{"unit":"DIVISION00","draftPick":{"franchise":"0001","round":"01","pick":"01","player":"13604"}},` +
				`{"unit":"DIVISION01","draftPick":{"franchise":"0002","round":"01","pick":"01","player":""}}]}}`, 2, 1},
		{"no draft", `{"draftResults":{"draftUnit":{"unit":"LEAGUE"}}}`, 0, 0},
	}
	for _, c := range cases {
		d, err := DecodeDraftResults([]byte(c.body))
		if err != nil || d.Picks != c.picks || d.Made != c.made {
			t.Errorf("%s: %+v (%v), want %d picks, %d made", c.name, d, err, c.picks, c.made)
		}
	}
	tooMany := `{"draftResults":{"draftUnit":{"draftPick":[` + strings.Repeat(`{"franchise":"0001","player":"1"},`, maxDraftPicks) + `{"franchise":"0001","player":"1"}]}}}`
	if _, err := DecodeDraftResults([]byte(tooMany)); err == nil {
		t.Error("draft results past any league's size were read")
	}
}
