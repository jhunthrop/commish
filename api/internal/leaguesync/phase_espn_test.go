package leaguesync

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/espn"
)

// espnRead is an ESPN fixture through the ESPN reader, edited first.
func espnRead(t *testing.T, name string, season int, edit *strings.Replacer) espn.FullLeague {
	t.Helper()
	body, err := os.ReadFile(filepath.Join("..", "espn", "testdata", name))
	if err != nil {
		t.Fatal(err)
	}
	if edit != nil {
		body = []byte(edit.Replace(string(body)))
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write(body) }))
	t.Cleanup(srv.Close)
	l, err := (&espn.Client{HTTP: srv.Client(), Base: srv.URL}).Read(context.Background(), espnFixtureLeague, season, nil)
	if err != nil {
		t.Fatal(err)
	}
	return l
}

// withDraftDetail puts ESPN's draftDetail at the head of the derived
// 2026 league, as view=mDraftDetail answers it.
func withDraftDetail(detail string) *strings.Replacer {
	return strings.NewReplacer(`{"_source":`, `{"draftDetail":`+detail+`,"_source":`)
}

// ESPN's own flags, never a hardcoded in_season: draftDetail when the
// read carries it, the scoring period past the final one as the season
// over, and the rosters when ESPN states no draft (said in the basis).
func TestESPNPhase(t *testing.T) {
	past := espnSnapshot(espnRead(t, "league-48153503-2019-full.json", 2019, nil), phaseNow)
	if past.Status != StatusComplete {
		t.Fatalf("the recorded 2019 league, scoring period 18 of 16: status %q", past.Status)
	}
	wantPhase(t, "recorded 2019", hostPhase(past), apitypes.LeaguePhaseOffseason, "This is the league's 2019 season, which is over.", 14)

	unstated := espnSnapshot(espnRead(t, "league-write-2026.json", 2026, nil), phaseNow)
	wantPhase(t, "2026, no draftDetail", hostPhase(unstated), apitypes.LeaguePhaseInSeason,
		"ESPN did not state the draft but its teams have players and week 7 is under way.", 14)

	drafted := espnSnapshot(espnRead(t, "league-write-2026.json", 2026, withDraftDetail(`{"drafted":true,"inProgress":false}`)), phaseNow)
	wantPhase(t, "2026 drafted", hostPhase(drafted), apitypes.LeaguePhaseInSeason, "ESPN says the draft is done and week 7 is under way.", 14)

	drafting := espnSnapshot(espnRead(t, "league-write-2026.json", 2026, withDraftDetail(`{"drafted":false,"inProgress":true}`)), phaseNow)
	wantPhase(t, "2026 drafting", hostPhase(drafting), apitypes.LeaguePhaseDraftDay, "ESPN says the draft is under way.", 14)

	pre := espnSnapshot(espnRead(t, "league-48153503-2026-predraft-constructed.json", 2026, nil), phaseNow)
	if pre.Status != StatusPreDraft || pre.Calendar.DraftUnstated {
		t.Fatalf("the constructed pre-draft league: %q, unstated %v", pre.Status, pre.Calendar.DraftUnstated)
	}
	facts := PhaseFacts{Host: HostESPN, Read: true, Status: pre.Status, Season: pre.Season, Week: pre.Week, Calendar: pre.Calendar}
	wantPhase(t, "pre-draft, a week out", PhaseOf(facts, time.Date(2026, 8, 23, 12, 0, 0, 0, time.UTC)), apitypes.LeaguePhasePreDraft,
		"ESPN says the league has not drafted yet.", 14)
	wantPhase(t, "pre-draft, the day of", PhaseOf(facts, time.Date(2026, 8, 30, 12, 0, 0, 0, time.UTC)), apitypes.LeaguePhaseDraftDay,
		"ESPN has the draft starting within a day.", 14)
}

// Lane 74: the week in play reaches the snapshot as ESPN's live points,
// and a side ESPN gave no score for is unread, never a 0.0.
func TestESPNSnapshotScoresTheWeekInPlay(t *testing.T) {
	snap := espnSnapshot(espnRead(t, "league-inplay-2026-week6.json", 2026, nil), phaseNow)
	if snap.Week != 6 || len(snap.Matchups) != 12 {
		t.Fatalf("week %d, %d sides", snap.Week, len(snap.Matchups))
	}
	if s := snap.Matchups[0]; s.RosterID != 9 || s.Points != 68.08 || s.PointsUnread {
		t.Fatalf("team 9: %+v", s)
	}
	unlive := strings.NewReplacer(`"totalPointsLive"`, `"elsewhere"`)
	for _, s := range espnSnapshot(espnRead(t, "league-inplay-2026-week6.json", 2026, unlive), phaseNow).Matchups {
		if !s.PointsUnread {
			t.Fatalf("a side with no live points read as scored: %+v", s)
		}
	}
}

// Lane 79: mid-week each side carries its players' points for the week
// as ESPN gives them (rosterForCurrentScoringPeriod), and the side's
// points stay ESPN's live total, never their sum.
func TestESPNSnapshotCarriesEachPlayersPoints(t *testing.T) {
	snap := espnSnapshot(espnRead(t, "league-inplay-2026-week6-monday.json", 2026, nil), phaseNow)
	s := snap.Matchups[0]
	if s.RosterID != 9 || s.Points != 77.08 || len(s.PlayerPoints) != 17 {
		t.Fatalf("team 9: %v points, %d players", s.Points, len(s.PlayerPoints))
	}
	if s.PlayerPoints["4567048"] != 27.9 || s.PlayerPoints["12483"] != 16.88 || s.PlayerPoints["3117251"] != 0 {
		t.Fatalf("team 9's players: %v", s.PlayerPoints)
	}
	if !GivesPlayerPoints(HostESPN, &s) {
		t.Fatal("an ESPN side with its players' points reads as team points alone")
	}
	// Lane 74's read, before ESPN carried the period's roster, has none.
	for _, s := range espnSnapshot(espnRead(t, "league-inplay-2026-week6.json", 2026, nil), phaseNow).Matchups {
		if s.PlayerPoints == nil || len(s.PlayerPoints) != 0 || GivesPlayerPoints(HostESPN, &s) {
			t.Fatalf("a side with players' points from nowhere: %v", s.PlayerPoints)
		}
	}
}
