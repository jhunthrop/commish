package inseason

import (
	"testing"
	"time"

	"github.com/jhunthrop/commish/api/internal/boards"
	"github.com/jhunthrop/commish/api/internal/draft"
	"github.com/jhunthrop/commish/api/internal/scoring"
)

// A defense's games are the weeks a counted line was scored against it
// (Lane 80 re-review finding 1): a game final by the hourly status alone,
// its lines still to come with the weekly stats, adds no game to the
// denominator, so Opp rank and points allowed a game hold until the
// lines land.
func TestAStatusFinalWithNoLinesLeavesOppRankAsItWas(t *testing.T) {
	week5 := time.Date(2026, 10, 11, 17, 0, 0, 0, time.UTC)
	week6 := week5.AddDate(0, 0, 7)
	lines := []boards.StatLine{
		{PlayerID: "a", Position: "WR", Week: 5, Team: "BUF", Metrics: map[string]float64{"receptions": 10, "receiving_yards": 100}},
		{PlayerID: "b", Position: "WR", Week: 5, Team: "MIA", Metrics: map[string]float64{"receptions": 4, "receiving_yards": 40}},
	}
	games := func(week6Final bool) []boards.TeamWeek {
		return []boards.TeamWeek{
			{Week: 5, Team: "BUF", Opponent: "MIA", Kickoff: week5, Final: true},
			{Week: 5, Team: "MIA", Opponent: "BUF", Home: true, Kickoff: week5, Final: true},
			{Week: 6, Team: "BUF", Opponent: "NYJ", Kickoff: week6, Final: week6Final},
			{Week: 6, Team: "NYJ", Opponent: "BUF", Home: true, Kickoff: week6, Final: week6Final},
			{Week: 6, Team: "MIA", Opponent: "NE", Kickoff: week6},
			{Week: 6, Team: "NE", Opponent: "MIA", Home: true, Kickoff: week6},
		}
	}
	rules := RulesOf(scoring.PresetRules(pprPreset))
	at := week6.Add(20 * time.Hour)
	before := NewSeason(Data{Lines: lines, Games: games(false)}, rules, 7, at)
	after := NewSeason(Data{Lines: lines, Games: games(true)}, rules, 7, at)
	for _, team := range []string{"BUF", "MIA"} {
		key := teamPosition{team, draft.WR}
		b, a := before.allowed[key], after.allowed[key]
		if b != a {
			t.Fatalf("%s's WR allowed moved on a status final with no lines: %+v then %+v", team, b, a)
		}
	}
	// MIA allowed BUF's 20 points in one game.
	if got := after.allowed[teamPosition{"MIA", draft.WR}]; got.PointsAGame != 20 || got.Of != 2 {
		t.Fatalf("Miami's WR allowed %+v", got)
	}
}
