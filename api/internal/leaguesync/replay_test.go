package leaguesync

import (
	"context"
	"testing"
	"time"

	"github.com/jhunthrop/commish/api/internal/apitypes"
)

// Both recorded leagues read through the same checks a live answer
// gets, and their roster and scoring come out as the hosts state them, in
// ScoringRules' 21 keys: the Sleeper league's two flex spots and half a
// point more per tight end catch, its special teams touchdowns named as
// dropped; the MyFantasyLeague league's per-unit rules, its points
// allowed by bracket named as dropped in its own words.
func TestRecordedLeaguesRead(t *testing.T) {
	now := func() time.Time { return time.Date(2026, 10, 13, 12, 0, 0, 0, time.UTC) }
	hosts := replayHosts(now)
	cases := []struct {
		link    string
		lineup  apitypes.Lineup
		rounds  int
		rules   map[string]float64
		dropped string
	}{
		{"sleeper.com/leagues/" + ReplaySleeperLeague, apitypes.LineupTwoFlex, 20,
			map[string]float64{
				"points_per_reception": 1, "te_reception_bonus": 0.5, "points_per_passing_touchdown": 5,
				"points_per_passing_yard": 0.04, "points_per_two_point_conversion": 2, "points_per_interception": -1,
			}, "st_td 6"},
		{"https://www43.myfantasyleague.com/2026/home/" + ReplayMFLLeague, apitypes.LineupStandard, 23,
			map[string]float64{
				"points_per_reception": 1, "points_per_passing_touchdown": 4, "points_per_passing_yard": 0.04,
				"points_per_rushing_touchdown": 6, "points_per_sack": 1, "points_per_return_touchdown": 6,
			}, "STPA+OPA 0-0 6 (Def)"},
	}
	for _, c := range cases {
		h, ref, err := hosts.Resolve("", c.link)
		if err != nil {
			t.Fatalf("%s: %v", c.link, err)
		}
		snap, err := h.Read(context.Background(), ref)
		if err != nil {
			t.Fatalf("%s: read: %v", c.link, err)
		}
		if len(snap.Teams) != 12 || snap.Week != 6 || len(snap.Matchups) < 12 || len(snap.Moves) == 0 {
			t.Fatalf("%s: %d teams, week %d, %d sides, %d moves", c.link, len(snap.Teams), snap.Week, len(snap.Matchups), len(snap.Moves))
		}
		for k, v := range c.rules {
			if snap.Scoring.Rules[k] != v {
				t.Errorf("%s: %s = %v, want %v", c.link, k, snap.Scoring.Rules[k], v)
			}
		}
		if !contains(snap.Scoring.Dropped, c.dropped) {
			t.Errorf("%s: dropped %q, want %q among them", c.link, snap.Scoring.Dropped, c.dropped)
		}
		if len(snap.Scoring.Rules) != len(ruleKeys) {
			t.Errorf("%s: %d rule keys, want the %d of ScoringRules", c.link, len(snap.Scoring.Rules), len(ruleKeys))
		}
		settings, reason := SettingsFor(snap)
		if reason != "" {
			t.Fatalf("%s: %s", c.link, reason)
		}
		if settings.Lineup != c.lineup || settings.Teams != 12 {
			t.Errorf("%s: lineup %s for %d teams", c.link, settings.Lineup, settings.Teams)
		}
		if got := roundsOf(settings); got != c.rounds {
			t.Errorf("%s: %d rounds, want %d", c.link, got, c.rounds)
		}
	}
}

func contains(list []string, s string) bool {
	for _, x := range list {
		if x == s {
			return true
		}
	}
	return false
}

func roundsOf(s apitypes.LeagueSettings) int {
	r := s.Roster
	flex := 1
	if s.Lineup != apitypes.LineupStandard {
		flex = 2
	}
	return r.Qb + r.Rb + r.Wr + r.Te + r.K + r.Dst + r.Bench + flex
}
