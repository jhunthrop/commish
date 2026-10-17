package inseason

import (
	"testing"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/leaguesync"
	"github.com/jhunthrop/commish/api/internal/scoring"
)

// Points so far are the host's for the player, and only when the host
// gives a player's points: ESPN, Yahoo and FFPC give each side's total and
// no player's, so a started player's points are unknown, never 0 (Lane 66d
// review H1).
func TestPointsSoFarOnlyWhereTheHostGivesThem(t *testing.T) {
	locked := Facts{Locked: true}
	cases := []struct {
		host   string
		side   *leaguesync.Side
		facts  Facts
		want   *float64
		reason string
	}{
		{"sleeper", &leaguesync.Side{Starters: []string{"p"}, PlayerPoints: map[string]float64{"p": 12.345}}, locked, ptr(12.35), "the host's points, to the cent"},
		{"sleeper", &leaguesync.Side{Starters: []string{"p"}, PlayerPoints: map[string]float64{"p": 0}}, locked, ptr(0), "a read 0 is a 0"},
		{"mfl", &leaguesync.Side{Starters: []string{"p"}, PlayerPoints: map[string]float64{"p": 7}}, locked, ptr(7), "the host's points"},
		{"espn", &leaguesync.Side{Starters: []string{"p"}, PlayerPoints: map[string]float64{}}, locked, nil, "a total and no player's"},
		{"yahoo", &leaguesync.Side{Starters: []string{"p"}, PlayerPoints: map[string]float64{}}, locked, nil, "a total and no player's"},
		{"ffpc", &leaguesync.Side{Starters: []string{"p"}}, locked, nil, "no map at all"},
		{"sleeper", &leaguesync.Side{Starters: []string{"p"}, PlayerPoints: map[string]float64{"p": 9}}, Facts{}, nil, "not kicked off"},
		{"sleeper", &leaguesync.Side{Starters: []string{"q"}, PlayerPoints: map[string]float64{"p": 9}}, locked, nil, "not a starter"},
	}
	for _, c := range cases {
		got := thisWeek(c.side, "p", c.facts)
		if (got == nil) != (c.want == nil) || (got != nil && *got != *c.want) {
			t.Errorf("%s, %s: %v, want %v", c.host, c.reason, deref(got), deref(c.want))
		}
	}
}

func deref(p *float64) any {
	if p == nil {
		return nil
	}
	return *p
}

// The projection says the scoring it is read in, and whether it is the
// league's own (Lane 66d review H2).
func TestProjectionScoringSaysWhoseScoringItIs(t *testing.T) {
	preset := func(p apitypes.ScoringPreset) apitypes.Scoring { return apitypes.Scoring{Preset: &p} }
	custom := func(r apitypes.ScoringRules) apitypes.Scoring { return apitypes.Scoring{Custom: &r} }
	sixPoint := scoring.PresetRules(apitypes.ScoringPresetHalfPpr)
	sixPoint.PointsPerPassingTouchdown = 6
	cases := []struct {
		name    string
		scoring apitypes.Scoring
		want    apitypes.ProjectionScoring
	}{
		{"a PPR league", preset(apitypes.ScoringPresetPpr), apitypes.ProjectionScoring{Format: apitypes.ProjectionScoringFormatPpr, LeagueOwn: true}},
		{"a half PPR league", preset(apitypes.ScoringPresetHalfPpr), apitypes.ProjectionScoring{Format: apitypes.ProjectionScoringFormatHalfPpr, LeagueOwn: true}},
		{"a standard league", preset(apitypes.ScoringPresetStandard), apitypes.ProjectionScoring{Format: apitypes.ProjectionScoringFormatStandard, LeagueOwn: true}},
		{"a tight end premium", preset(apitypes.ScoringPresetTePremium), apitypes.ProjectionScoring{Format: apitypes.ProjectionScoringFormatPpr, LeagueOwn: false}},
		{"rules equal to PPR", custom(scoring.PresetRules(apitypes.ScoringPresetPpr)), apitypes.ProjectionScoring{Format: apitypes.ProjectionScoringFormatPpr, LeagueOwn: true}},
		{"six-point passing, half a catch", custom(sixPoint), apitypes.ProjectionScoring{Format: apitypes.ProjectionScoringFormatHalfPpr, LeagueOwn: false}},
	}
	for _, c := range cases {
		if got := projectionScoring(apitypes.LeagueSettings{Scoring: c.scoring}); got != c.want {
			t.Errorf("%s: %+v, want %+v", c.name, got, c.want)
		}
	}
}

// Both screens carry it.
func TestBothScreensSayTheProjectionsScoring(t *testing.T) {
	f := pairedFixture(t)
	a := newFixtureAdvisor(t, f, nil)
	lineup, _ := a.Lineup()
	box, _ := a.Matchup()
	want := apitypes.ProjectionScoring{Format: apitypes.ProjectionScoringFormatPpr, LeagueOwn: true}
	if lineup.ProjectionScoring != want || box.ProjectionScoring != want {
		t.Fatalf("lineup %+v, matchup %+v", lineup.ProjectionScoring, box.ProjectionScoring)
	}
}
