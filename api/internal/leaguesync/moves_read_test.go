package leaguesync

import (
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/jhunthrop/commish/api/internal/espn"
)

// An ESPN league that states no scoring item leaves every rule unstated:
// the terms name each one, so the settings print no figure for it, and
// the recorded Sleeper league names the one rule it leaves out: a
// player's return touchdown (it scores special teams touchdowns apart).
func TestTermsNameTheRulesThePlatformDoesNotState(t *testing.T) {
	snap := espnSnapshot(espn.FullLeague{ID: "48153503", Season: 2026, Teams: []espn.Team{{ID: 1, Name: "A"}}}, time.Now())
	got := terms(snap)
	if !slices.Contains(got.ScoringUnstated, "points_per_passing_yard") || !slices.Contains(got.ScoringUnstated, "points_per_safety") {
		t.Errorf("unstated %v", got.ScoringUnstated)
	}
	for _, key := range got.ScoringUnstated {
		if strings.Contains(key, " ") || strings.HasPrefix(key, "points_allowed") || strings.HasPrefix(key, "yards_allowed") {
			t.Errorf("unstated %q is not a rule key, or is a tier", key)
		}
	}
	if got := terms(readRecordedSleeper(t)).ScoringUnstated; !slices.Equal(got, []string{"points_per_return_touchdown"}) {
		t.Errorf("the recorded Sleeper league's unstated rules %v", got)
	}
}

// ESPN gives us no move history: its leagues say their moves are not
// read, so the page shows none rather than saying nobody moved. Every
// other platform's moves are read.
func TestMovesReadByPlatform(t *testing.T) {
	for host, want := range map[string]bool{HostSleeper: true, HostMFL: true, HostFFPC: true, HostYahoo: true, HostESPN: false} {
		if got := movesRead(host); got != want {
			t.Errorf("%s: moves read %v, want %v", host, got, want)
		}
	}
}
