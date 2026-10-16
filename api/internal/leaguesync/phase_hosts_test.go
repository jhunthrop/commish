package leaguesync

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/hosts/yahoo"
	"github.com/jhunthrop/commish/api/internal/sleeper"
)

// hostPhase is a snapshot's phase at phaseNow, as the shell reads it.
func hostPhase(snap Snapshot) LeaguePhase {
	return PhaseOf(PhaseFacts{Host: snap.Ref.Host, Read: true, Status: snap.Status, Season: snap.Season, Week: snap.Week, Calendar: snap.Calendar}, phaseNow)
}

func wantPhase(t *testing.T, name string, got LeaguePhase, phase apitypes.LeaguePhase, basis string, playoffs int) {
	t.Helper()
	if got.Phase != phase || got.Basis != basis {
		t.Errorf("%s: %s %q, want %s %q", name, got.Phase, got.Basis, phase, basis)
	}
	if (playoffs == 0) != (got.PlayoffStartWeek == nil) || (got.PlayoffStartWeek != nil && *got.PlayoffStartWeek != playoffs) {
		t.Errorf("%s: playoff start week %v, want %d", name, got.PlayoffStartWeek, playoffs)
	}
}

// Yahoo states the draft (draft_status), its time (draft_time) and the
// playoff start week: the drafted fixture is in season at week 6 with its
// playoffs from week 15, the constructed pre-draft one before its draft.
func TestYahooPhase(t *testing.T) {
	drafted := yahooSnapshot(yahooFixtureRead(t), nil, phaseNow)
	if drafted.Calendar.DraftAt == nil || !drafted.Calendar.DraftAt.Equal(time.Date(2026, 8, 30, 23, 0, 0, 0, time.UTC)) {
		t.Fatalf("the draft time: %v", drafted.Calendar.DraftAt)
	}
	wantPhase(t, "drafted", hostPhase(drafted), apitypes.LeaguePhaseInSeason, "Yahoo says the draft is done and week 6 is under way.", 15)

	dir := filepath.Join("..", "hosts", "yahoo", "testdata")
	head, err := os.ReadFile(filepath.Join(dir, "yahoo-league-head-predraft.xml"))
	if err != nil {
		t.Fatal(err)
	}
	empty := []byte(`<fantasy_content><league><league_id>128934</league_id><teams count="1">` +
		`<team><team_key>470.l.128934.t.1</team_key><team_id>1</team_id><name>A</name></team></teams></league></fantasy_content>`)
	l, err := yahoo.ParseLeague(head, empty)
	if err != nil {
		t.Fatal(err)
	}
	pre := yahooSnapshot(l, nil, phaseNow)
	if pre.Status != StatusPreDraft {
		t.Fatalf("pre-draft status %q", pre.Status)
	}
	wantPhase(t, "pre-draft", PhaseOf(PhaseFacts{Host: HostYahoo, Read: true, Status: pre.Status, Season: pre.Season, Week: pre.Week, Calendar: pre.Calendar},
		time.Date(2026, 9, 1, 12, 0, 0, 0, time.UTC)), apitypes.LeaguePhasePreDraft, "Yahoo says the league has not drafted yet.", 15)
	wantPhase(t, "draft day", PhaseOf(PhaseFacts{Host: HostYahoo, Read: true, Status: pre.Status, Season: pre.Season, Week: pre.Week, Calendar: pre.Calendar},
		time.Date(2026, 9, 6, 12, 0, 0, 0, time.UTC)), apitypes.LeaguePhaseDraftDay, "Yahoo has the draft starting within a day.", 15)
}

// sleeperRecorded answers the recorded Sleeper league (2026-10-13), with
// its league answer and its draft's (the companion's recording) rewritten
// by edit, so a pre-draft league is the recorded shape with the host's
// own pre-draft words in it.
type sleeperRecorded struct {
	offline
	league, draft string
	draftReads    int
}

func newSleeperRecorded(t *testing.T, edit *strings.Replacer) *sleeperRecorded {
	t.Helper()
	draft, err := os.ReadFile(filepath.Join("..", "companion", "replay", "draft.json"))
	if err != nil {
		t.Fatal(err)
	}
	league := string(replayFile("sleeper/league.json"))
	if edit != nil {
		league, draft = edit.Replace(league), []byte(edit.Replace(string(draft)))
	}
	return &sleeperRecorded{league: league, draft: string(draft)}
}

func (r *sleeperRecorded) League(_ context.Context, id string) (sleeper.League, error) {
	return sleeper.DecodeLeague([]byte(r.league), id)
}
func (r *sleeperRecorded) Rosters(context.Context, string) ([]sleeper.Roster, error) {
	return sleeper.DecodeRosters(replayFile("sleeper/rosters.json"))
}
func (r *sleeperRecorded) LeagueUsers(context.Context, string) ([]sleeper.User, error) {
	return sleeper.DecodeUsers(replayFile("sleeper/users.json"))
}
func (r *sleeperRecorded) Matchups(context.Context, string, int) ([]sleeper.Matchup, error) {
	return sleeper.DecodeMatchups(replayFile("sleeper/matchups.json"))
}
func (r *sleeperRecorded) Transactions(context.Context, string, int) ([]sleeper.Transaction, error) {
	return sleeper.DecodeTransactions(replayFile("sleeper/transactions_this.json"))
}
func (r *sleeperRecorded) NFLState(context.Context) (sleeper.State, error) {
	return sleeper.DecodeState(replayFile("sleeper/state.json"))
}
func (r *sleeperRecorded) Draft(_ context.Context, id string) (sleeper.Draft, error) {
	r.draftReads++
	return sleeper.DecodeDraft([]byte(r.draft), id)
}

// Sleeper states the draft (status), the draft's start_time, the
// playoff start week (playoff_week_start) and whether adds are closed
// (disable_adds): the recorded league is in season at week 6 with its
// playoffs from week 15 and no draft read; rewritten before its draft,
// its draft's time is read and named.
func TestSleeperPhase(t *testing.T) {
	ref := Ref{Host: HostSleeper, LeagueID: ReplaySleeperLeague}
	api := newSleeperRecorded(t, nil)
	snap, err := (&Sleeper{API: api, Now: func() time.Time { return phaseNow }}).Read(context.Background(), ref)
	if err != nil {
		t.Fatal(err)
	}
	wantPhase(t, "recorded", hostPhase(snap), apitypes.LeaguePhaseInSeason, "Sleeper says the draft is done and week 6 is under way.", 15)
	if api.draftReads != 0 || !hostPhase(snap).WaiversOpen {
		t.Fatalf("a drafted league read its draft %d times, waivers open %v", api.draftReads, hostPhase(snap).WaiversOpen)
	}

	start := time.Date(2026, 10, 16, 0, 0, 0, 0, time.UTC)
	api = newSleeperRecorded(t, strings.NewReplacer(
		`"status":"in_season"`, `"status":"pre_draft"`, `"status":"complete"`, `"status":"pre_draft"`,
		`"start_time":1786899734967`, fmt.Sprintf(`"start_time":%d`, start.UnixMilli()),
		`"disable_adds":0`, `"disable_adds":1`))
	snap, err = (&Sleeper{API: api, Now: func() time.Time { return phaseNow }}).Read(context.Background(), ref)
	if err != nil {
		t.Fatal(err)
	}
	if snap.Calendar.DraftAt == nil || !snap.Calendar.DraftAt.Equal(start) || api.draftReads != 1 || snap.Week != 0 {
		t.Fatalf("pre-draft: draft at %v after %d draft reads, week %d", snap.Calendar.DraftAt, api.draftReads, snap.Week)
	}
	got := hostPhase(snap)
	wantPhase(t, "pre-draft", got, apitypes.LeaguePhaseDraftDay, "Sleeper has the draft starting within a day.", 15)
	if got.WaiversOpen {
		t.Fatal("adds closed on the host read as waivers open")
	}
}
