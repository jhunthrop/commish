package sleeper

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func recorded(t *testing.T, parts ...string) []byte {
	t.Helper()
	b, err := os.ReadFile(filepath.Join(parts...))
	if err != nil {
		t.Fatal(err)
	}
	return b
}

const (
	recordedLeague = "1382163311038038016"
	recordedDraft  = "1382163311050645504"
)

// The recorded league (2026-10-13) names its draft, its playoff start
// week (settings.playoff_week_start) and that adds are open
// (settings.disable_adds 0).
func TestLeagueCalendar(t *testing.T) {
	body := recorded(t, "..", "leaguesync", "replay", "sleeper", "league.json")
	l, err := DecodeLeague(body, recordedLeague)
	if err != nil {
		t.Fatal(err)
	}
	if l.DraftID != recordedDraft || l.PlayoffWeekStart != 15 || l.AddsDisabled {
		t.Fatalf("draft %q, playoffs from %d, adds disabled %v", l.DraftID, l.PlayoffWeekStart, l.AddsDisabled)
	}
	closed := strings.Replace(string(body), `"disable_adds":0`, `"disable_adds":1`, 1)
	if l, err := DecodeLeague([]byte(closed), recordedLeague); err != nil || !l.AddsDisabled {
		t.Fatalf("adds disabled: %v (%v)", l.AddsDisabled, err)
	}
}

// The recorded draft's start_time (Unix milliseconds); a draft with no
// time set answers none.
func TestDraftStartTime(t *testing.T) {
	body := recorded(t, "..", "companion", "replay", "draft.json")
	d, err := DecodeDraft(body, recordedDraft)
	if err != nil {
		t.Fatal(err)
	}
	if d.StartTime == nil || !d.StartTime.Equal(time.UnixMilli(1786899734967).UTC()) || d.Status != StatusComplete {
		t.Fatalf("start %v, status %s", d.StartTime, d.Status)
	}
	unset := strings.Replace(string(body), `"start_time":1786899734967`, `"start_time":null`, 1)
	if d, err := DecodeDraft([]byte(unset), recordedDraft); err != nil || d.StartTime != nil {
		t.Fatalf("no start time: %v (%v)", d.StartTime, err)
	}
}
