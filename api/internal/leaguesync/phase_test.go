package leaguesync

import (
	"strings"
	"testing"
	"time"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/season"
)

// preseason is the site's season before the 2026 opener.
var preseason = season.SitePhase{Phase: season.SitePreseason, Opener: time.Date(2026, 9, 10, 0, 20, 0, 0, time.UTC)}

// phaseNow is the Thursday of the 2026 season's week 6.
var phaseNow = time.Date(2026, 10, 15, 16, 0, 0, 0, time.UTC)

func at(d time.Duration) *time.Time {
	t := phaseNow.Add(d)
	return &t
}

// Every rule of the spec's table (§1), one host at a time, each with the
// sentence that names its fact.
func TestPhaseOf(t *testing.T) {
	cases := []struct {
		name    string
		facts   PhaseFacts
		phase   apitypes.LeaguePhase
		basis   string
		waivers bool
	}{
		{"yahoo drafted, week 6", PhaseFacts{Host: HostYahoo, Read: true, Status: StatusInSeason, Season: 2026, Week: 6, Calendar: Calendar{PlayoffStartWeek: 15}},
			apitypes.LeaguePhaseInSeason, "Yahoo says the draft is done and week 6 is under way.", true},
		{"yahoo before the draft", PhaseFacts{Host: HostYahoo, Read: true, Status: StatusPreDraft, Season: 2026, Calendar: Calendar{DraftAt: at(30 * time.Hour)}},
			apitypes.LeaguePhasePreDraft, "Yahoo says the league has not drafted yet.", true},
		{"yahoo draft in three hours", PhaseFacts{Host: HostYahoo, Read: true, Status: StatusPreDraft, Season: 2026, Calendar: Calendar{DraftAt: at(3 * time.Hour)}},
			apitypes.LeaguePhaseDraftDay, "Yahoo has the draft starting within a day.", true},
		{"yahoo draft time just passed", PhaseFacts{Host: HostYahoo, Read: true, Status: StatusPreDraft, Season: 2026, Calendar: Calendar{DraftAt: at(-2 * time.Hour)}},
			apitypes.LeaguePhaseDraftDay, "Yahoo's draft time has come and the draft is not marked done.", true},
		{"yahoo draft time long past", PhaseFacts{Host: HostYahoo, Read: true, Status: StatusPreDraft, Season: 2026, Calendar: Calendar{DraftAt: at(-72 * time.Hour)}},
			apitypes.LeaguePhasePreDraft, "Yahoo says the league has not drafted yet.", true},
		{"sleeper drafting", PhaseFacts{Host: HostSleeper, Read: true, Status: StatusDrafting, Season: 2026},
			apitypes.LeaguePhaseDraftDay, "Sleeper says the draft is under way.", true},
		{"sleeper first playoff week", PhaseFacts{Host: HostSleeper, Read: true, Status: StatusInSeason, Season: 2026, Week: 15, Calendar: Calendar{PlayoffStartWeek: 15}},
			apitypes.LeaguePhasePlayoffs, "Sleeper is in week 15 and the league's playoffs start in week 15.", true},
		{"sleeper past the playoff start", PhaseFacts{Host: HostSleeper, Read: true, Status: StatusInSeason, Season: 2026, Week: 17, Calendar: Calendar{PlayoffStartWeek: 15}},
			apitypes.LeaguePhasePlayoffs, "Sleeper is in week 17 and the league's playoffs start in week 15.", true},
		{"sleeper the week before the playoffs", PhaseFacts{Host: HostSleeper, Read: true, Status: StatusInSeason, Season: 2026, Week: 14, Calendar: Calendar{PlayoffStartWeek: 15}},
			apitypes.LeaguePhaseInSeason, "Sleeper says the draft is done and week 14 is under way.", true},
		{"sleeper complete", PhaseFacts{Host: HostSleeper, Read: true, Status: StatusComplete, Season: 2026, Week: 17, Calendar: Calendar{PlayoffStartWeek: 15}},
			apitypes.LeaguePhaseOffseason, "Sleeper says the season is over.", false},
		{"drafted before kickoff", PhaseFacts{Host: HostSleeper, Read: true, Status: StatusInSeason, Season: 2026, Site: preseason},
			apitypes.LeaguePhaseInSeason, "Sleeper says the draft is done and the season starts Wednesday, September 9.", true},
		{"drafted before kickoff, the schedule not loaded", PhaseFacts{Host: HostYahoo, Read: true, Status: StatusInSeason, Season: 2026,
			Site: season.SitePhase{Phase: season.SitePreseason}},
			apitypes.LeaguePhaseInSeason, "Yahoo says the draft is done and the NFL season has not started yet.", true},
		{"drafted, no week, the schedule unread", PhaseFacts{Host: HostSleeper, Read: true, Status: StatusInSeason, Season: 2026,
			Site: season.SitePhase{Phase: season.SitePreseason, Unread: true}},
			apitypes.LeaguePhaseInSeason, "Sleeper says the draft is done and we could not read the NFL schedule.", true},
		{"drafted, no week, the NFL regular season over", PhaseFacts{Host: HostSleeper, Read: true, Status: StatusInSeason, Season: 2026,
			Site: season.SitePhase{Phase: season.SitePlayoffs, Week: 19}},
			apitypes.LeaguePhaseOffseason, "Sleeper says the draft is done and the NFL regular season is over.", false},
		{"drafted, no week, the site in season", PhaseFacts{Host: HostSleeper, Read: true, Status: StatusInSeason, Season: 2026,
			Site: season.SitePhase{Phase: season.SiteInSeason, Week: 6}},
			apitypes.LeaguePhaseInSeason, "Sleeper says the draft is done and there is no current week.", true},
		{"ffpc board unread, rosters drafted, before kickoff", PhaseFacts{Host: HostFFPC, Read: true, Status: StatusInSeason, Season: 2026,
			Calendar: Calendar{DraftUnstated: true, DraftReadBy: ReadByRosters}, Site: preseason},
			apitypes.LeaguePhaseInSeason, "FFPC did not state the draft but its teams have players and the season starts Wednesday, September 9.", true},
		{"espn no draftDetail, empty rosters", PhaseFacts{Host: HostESPN, Read: true, Status: StatusPreDraft, Season: 2026, Week: 1,
			Calendar: Calendar{DraftUnstated: true, DraftReadBy: ReadByRosters}},
			apitypes.LeaguePhasePreDraft, "ESPN did not state the draft and no team has a player yet.", true},
		{"ffpc playoffs, waivers unstated", PhaseFacts{Host: HostFFPC, Read: true, Status: StatusInSeason, Season: 2026, Week: 14,
			Calendar: Calendar{PlayoffStartWeek: 13, WaiversUnstated: true}},
			apitypes.LeaguePhasePlayoffs, "FFPC is in week 14 and the league's playoffs start in week 13, and FFPC does not say when waivers close so we treat adds as open.", true},
		{"sleeper adds closed", PhaseFacts{Host: HostSleeper, Read: true, Status: StatusInSeason, Season: 2026, Week: 6, Calendar: Calendar{WaiversClosed: true}},
			apitypes.LeaguePhaseInSeason, "Sleeper says the draft is done and week 6 is under way.", false},
		{"a past season", PhaseFacts{Host: HostESPN, Read: true, Status: StatusInSeason, Season: 2025, Week: 6},
			apitypes.LeaguePhaseOffseason, "This is the league's 2025 season, which is over.", false},
		{"espn drafted", PhaseFacts{Host: HostESPN, Read: true, Status: StatusInSeason, Season: 2026, Week: 7, Calendar: Calendar{PlayoffStartWeek: 15}},
			apitypes.LeaguePhaseInSeason, "ESPN says the draft is done and week 7 is under way.", true},
		{"espn draft unstated, its date ahead", PhaseFacts{Host: HostESPN, Read: true, Status: StatusInSeason, Season: 2026, Week: 7, Calendar: Calendar{DraftUnstated: true, DraftAt: at(48 * time.Hour)}},
			apitypes.LeaguePhasePreDraft, "ESPN has the draft set for a later day.", true},
		{"ffpc draft complete", PhaseFacts{Host: HostFFPC, Read: true, Status: StatusInSeason, Season: 2026, Week: 6, Calendar: Calendar{PlayoffStartWeek: 13}},
			apitypes.LeaguePhaseInSeason, "FFPC says the draft is done and week 6 is under way.", true},
		{"ffpc before the draft", PhaseFacts{Host: HostFFPC, Read: true, Status: StatusPreDraft, Season: 2026},
			apitypes.LeaguePhasePreDraft, "FFPC says the league has not drafted yet.", true},
		{"mfl unstated, week 6", PhaseFacts{Host: HostMFL, Read: true, Status: StatusInSeason, Season: 2026, Week: 6, Calendar: Calendar{DraftUnstated: true, PlayoffStartWeek: 15}},
			apitypes.LeaguePhaseInSeason, "MyFantasyLeague did not state the draft and week 6 is under way.", true},
		{"mfl unstated, no week", PhaseFacts{Host: HostMFL, Read: true, Status: StatusPreDraft, Season: 2026, Calendar: Calendar{DraftUnstated: true}},
			apitypes.LeaguePhasePreDraft, "MyFantasyLeague did not state the draft and its season has no current week yet.", true},
		{"mfl unstated, in the playoffs", PhaseFacts{Host: HostMFL, Read: true, Status: StatusInSeason, Season: 2026, Week: 15, Calendar: Calendar{DraftUnstated: true, PlayoffStartWeek: 15}},
			apitypes.LeaguePhasePlayoffs, "MyFantasyLeague is in week 15 and the league's playoffs start in week 15.", true},
		{"never read", PhaseFacts{Host: HostESPN, Season: 2026},
			apitypes.LeaguePhasePreDraft, "We have not read this league from ESPN yet.", true},
		{"never read, a past season", PhaseFacts{Host: HostMFL, Season: 2024},
			apitypes.LeaguePhaseOffseason, "This is the league's 2024 season, which is over.", false},
	}
	for _, c := range cases {
		got := PhaseOf(c.facts, phaseNow)
		if got.Phase != c.phase || got.Basis != c.basis || got.WaiversOpen != c.waivers {
			t.Errorf("%s: %s %q waivers %v, want %s %q waivers %v", c.name, got.Phase, got.Basis, got.WaiversOpen, c.phase, c.basis, c.waivers)
		}
		if !got.Phase.Valid() {
			t.Errorf("%s: %q is not a phase", c.name, got.Phase)
		}
		if strings.ContainsAny(got.Basis, ";—–") {
			t.Errorf("%s: %q carries a semicolon or a dash the site does not write", c.name, got.Basis)
		}
	}
}

// The host's draft time and playoff start week ride along as the host
// stated them, null when it did not.
func TestPhaseCarriesTheHostsFacts(t *testing.T) {
	draft := phaseNow.Add(40 * time.Hour)
	got := PhaseOf(PhaseFacts{Host: HostYahoo, Read: true, Status: StatusPreDraft, Season: 2026,
		Calendar: Calendar{DraftAt: &draft, PlayoffStartWeek: 15}}, phaseNow)
	if got.DraftAt == nil || !got.DraftAt.Equal(draft) || got.PlayoffStartWeek == nil || *got.PlayoffStartWeek != 15 {
		t.Fatalf("facts %+v", got)
	}
	got = PhaseOf(PhaseFacts{Host: HostFFPC, Read: true, Status: StatusInSeason, Season: 2026, Week: 6}, phaseNow)
	if got.DraftAt != nil || got.PlayoffStartWeek != nil {
		t.Fatalf("a host that says neither: %+v", got)
	}
}
