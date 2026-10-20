package espn

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"
)

// readLeagueFixture serves one recorded or constructed league answer to the
// reader and answers its read.
func readLeagueFixture(t *testing.T, name string, season int, edit func(string) string) FullLeague {
	t.Helper()
	body, err := os.ReadFile("testdata/" + name)
	if err != nil {
		t.Fatal(err)
	}
	if edit != nil {
		body = []byte(edit(string(body)))
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write(body) }))
	t.Cleanup(srv.Close)
	l, err := (&Client{HTTP: srv.Client(), Base: srv.URL}).Read(context.Background(), "48153503", season, nil)
	if err != nil {
		t.Fatal(err)
	}
	return l
}

// The recorded league (read without mDraftDetail) states no draft, its
// draft date (draftSettings.date), its playoffs from matchup period 14
// (matchupPeriodCount 13, matchupPeriods "14": [14]), its final scoring
// period 16, and adds open (acquisitionLimit -1).
func TestCalendarFromTheRecordedLeague(t *testing.T) {
	l := readLeagueFixture(t, "league-48153503-2019-full.json", 2019, nil)
	if l.Draft != nil {
		t.Fatalf("a read with no draftDetail stated a draft: %+v", l.Draft)
	}
	if l.DraftAt == nil || !l.DraftAt.Equal(time.UnixMilli(1567882800000).UTC()) || l.PlayoffStartWeek != 14 ||
		l.FinalScoringPeriod != 16 || l.Acquisition.Closed {
		t.Fatalf("draft at %v, playoffs from %d, final period %d, adds closed %v", l.DraftAt, l.PlayoffStartWeek, l.FinalScoringPeriod, l.Acquisition.Closed)
	}
	drafted := readLeagueFixture(t, "league-48153503-2019-full.json", 2019, func(s string) string {
		return strings.Replace(s, `"gameId": `, `"draftDetail": {"drafted": true, "inProgress": false}, "gameId": `, 1)
	})
	if drafted.Draft == nil || !drafted.Draft.Drafted || drafted.Draft.InProgress {
		t.Fatalf("a drafted league's draftDetail: %+v", drafted.Draft)
	}
	closed := readLeagueFixture(t, "league-48153503-2019-full.json", 2019, func(s string) string {
		return strings.Replace(s, `"acquisitionLimit": -1`, `"acquisitionLimit": 0`, 1)
	})
	if !closed.Acquisition.Closed {
		t.Fatal("an acquisition limit of none read as adds open")
	}
}

// The constructed pre-draft league (draftDetail as view=mDraftDetail
// answers a league not yet drafted): no draft yet, its date ahead.
func TestCalendarBeforeTheDraft(t *testing.T) {
	l := readLeagueFixture(t, "league-48153503-2026-predraft-constructed.json", 2026, nil)
	if l.Draft == nil || l.Draft.Drafted || l.Draft.InProgress || l.DraftAt == nil ||
		!l.DraftAt.Equal(time.Date(2026, 8, 30, 23, 0, 0, 0, time.UTC)) || l.FinalScoringPeriod != 17 || l.ScoringPeriod != 1 {
		t.Fatalf("pre-draft: %+v at %v, final %d, period %d", l.Draft, l.DraftAt, l.FinalScoringPeriod, l.ScoringPeriod)
	}
	for _, team := range l.Teams {
		if len(team.Roster) != 0 {
			t.Fatalf("team %d has a roster before the draft", team.ID)
		}
	}
}

// The championship's length is the scoring periods of the matchup period
// holding the final one (Lane 96, B25): the recorded league's final is
// one week ("16": [16]); a final over weeks 16 and 17 is two.
func TestFinalRoundWeeks(t *testing.T) {
	if l := readLeagueFixture(t, "league-48153503-2019-full.json", 2019, nil); l.FinalRoundWeeks != 1 {
		t.Fatalf("a one-week final read as %d weeks", l.FinalRoundWeeks)
	}
	two := readLeagueFixture(t, "league-48153503-2019-full.json", 2019, func(s string) string {
		s = strings.Replace(s, "\"16\": [\n     16\n    ]", "\"16\": [\n     16,\n     17\n    ]", 1)
		return strings.Replace(s, `"finalScoringPeriod": 16`, `"finalScoringPeriod": 17`, 1)
	})
	if two.FinalRoundWeeks != 2 || two.FinalScoringPeriod != 17 {
		t.Fatalf("a two-week final read as %d weeks ending %d", two.FinalRoundWeeks, two.FinalScoringPeriod)
	}
	none := readLeagueFixture(t, "league-48153503-2019-full.json", 2019, func(s string) string {
		return strings.Replace(s, `"finalScoringPeriod": 16`, `"finalScoringPeriod": 0`, 1)
	})
	if none.FinalRoundWeeks != 0 {
		t.Fatalf("no final period read as a %d-week final", none.FinalRoundWeeks)
	}
}
