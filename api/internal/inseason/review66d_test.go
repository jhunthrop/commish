package inseason

import (
	"testing"
	"time"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/boards"
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
		{"sleeper", &leaguesync.Side{Starters: []string{"p"}, PlayerPoints: map[string]float64{"p": 12.345}}, locked, ptr(12.3), "the host's points, to the tenth"},
		{"sleeper", &leaguesync.Side{Starters: []string{"p"}, PlayerPoints: map[string]float64{"p": 0}}, locked, ptr(0), "a read 0 is a 0"},
		{"mfl", &leaguesync.Side{Starters: []string{"p"}, PlayerPoints: map[string]float64{"p": 7}}, locked, ptr(7), "the host's points"},
		{"espn", &leaguesync.Side{Starters: []string{"p"}, PlayerPoints: map[string]float64{}}, locked, nil, "a total and no player's"},
		{"espn", &leaguesync.Side{Starters: []string{"p"}, PlayerPoints: map[string]float64{"p": 8.74}}, locked, ptr(8.7), "ESPN's points by player (Lane 79)"},
		{"yahoo", &leaguesync.Side{Starters: []string{"p"}, PlayerPoints: map[string]float64{}}, locked, nil, "a total and no player's"},
		{"yahoo", &leaguesync.Side{Starters: []string{"p"}, PlayerPoints: map[string]float64{"p": 5}}, locked, nil, "a total alone, whatever the read holds"},
		{"ffpc", &leaguesync.Side{Starters: []string{"p"}}, locked, nil, "no map at all"},
		{"sleeper", &leaguesync.Side{Starters: []string{"p"}, PlayerPoints: map[string]float64{"p": 9}}, Facts{}, nil, "not kicked off"},
		{"sleeper", &leaguesync.Side{Starters: []string{"q"}, PlayerPoints: map[string]float64{"p": 9}}, locked, nil, "not a starter"},
	}
	for _, c := range cases {
		got := thisWeek(c.host, c.side, "p", c.facts)
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
		settings := apitypes.LeagueSettings{Scoring: c.scoring}
		like, _ := leaguesync.LeagueScoring(&settings, nil, false)
		if got := projectionScoring(settings, like); got != c.want {
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

// Sunday afternoon, the fixture's week 6 games kicked off at 1:00 pm.
var sundayAfternoon = time.Date(2026, 10, 18, 15, 0, 0, 0, east)

// hostShaped is the paired fixture after kickoff with both sides' points
// as a host gives them: a total for each side and, where byPlayer, each
// starter's points.
func hostShaped(t *testing.T, byPlayer bool) fixture {
	t.Helper()
	f := pairedFixture(t)
	for i := range f.league.Snap.Matchups {
		side := &f.league.Snap.Matchups[i]
		side.Points = 87.44
		side.PlayerPoints = map[string]float64{}
		if byPlayer {
			for _, id := range side.Starters {
				side.PlayerPoints[id] = 8.74
			}
		}
	}
	return f
}

// A host that gives each team's total alone (Yahoo, FFPC) says so on
// both answers, and start and sit carries the team's total; one that gives
// each player's (Sleeper, MFL, ESPN since Lane 79) says that (review N1).
func TestTheAnswersSayWhetherTheHostGivesPlayersPoints(t *testing.T) {
	for _, byPlayer := range []bool{false, true} {
		f := hostShaped(t, byPlayer)
		a, err := newAdvisor(f.league, f.data, boards.WeekProjection{}, nil, sundayAfternoon)
		if err != nil {
			t.Fatal(err)
		}
		lineup, _ := a.Lineup()
		box, _ := a.Matchup()
		if lineup.PlayerPoints != byPlayer || box.Sides[0].PlayerPoints != byPlayer || box.Sides[1].PlayerPoints != byPlayer {
			t.Fatalf("by player %v: lineup %v, sides %v %v", byPlayer, lineup.PlayerPoints, box.Sides[0].PlayerPoints, box.Sides[1].PlayerPoints)
		}
		if lineup.TeamPoints == nil || *lineup.TeamPoints != 87.4 {
			t.Fatalf("by player %v: the team's points %v", byPlayer, lineup.TeamPoints)
		}
		qb := box.Sides[0].Starters[0].Line.Facts.PointsThisWeek
		if byPlayer != (qb != nil) {
			t.Fatalf("by player %v: the quarterback's points %v", byPlayer, qb)
		}
	}
	// Before kickoff the team has no points so far.
	f := hostShaped(t, false)
	if lineup, _ := newFixtureAdvisor(t, f, nil).Lineup(); lineup.TeamPoints != nil {
		t.Fatalf("before kickoff: %v", *lineup.TeamPoints)
	}
}

// The scoring is derived once, from the preset the projection is read in
// (review N3).
func TestProjectionScoringFromTheHeldPreset(t *testing.T) {
	f := pairedFixture(t)
	a := newFixtureAdvisor(t, f, nil)
	if got := projectionScoring(a.settings, apitypes.ScoringPresetHalfPpr); got.Format != apitypes.ProjectionScoringFormatHalfPpr || got.LeagueOwn {
		t.Fatalf("%+v", got)
	}
}
