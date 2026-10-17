package inseason

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/draft"
	"github.com/jhunthrop/commish/api/internal/scoring"
)

// A stat line scores term for term as research's compute_fantasy_points
// does, under the league's own rules, kept to the cent.
func TestPointsUnderTheLeaguesRules(t *testing.T) {
	ppr := scoring.Standard()
	ppr.PointsPerReception = 1
	tePremium := ppr
	tePremium.TeReceptionBonus = 0.5
	standard := RulesOf(scoring.Standard())
	cases := []struct {
		name     string
		metrics  map[string]float64
		position draft.Position
		rules    Rules
		want     float64
	}{
		{"a quarterback in standard", map[string]float64{"passing_yards": 301, "passing_touchdowns": 2, "interceptions": 1, "rushing_yards": 12},
			draft.QB, standard, 19.24},
		{"a back in PPR", map[string]float64{"rushing_yards": 100, "rushing_touchdowns": 1, "receptions": 5, "receiving_yards": 40, "fumbles_lost": 1},
			draft.RB, RulesOf(ppr), 23},
		{"a tight end's catch counts more in TE premium", map[string]float64{"receptions": 4, "receiving_yards": 33},
			draft.TE, RulesOf(tePremium), 9.3},
		{"the bonus is a tight end's only", map[string]float64{"receptions": 4, "receiving_yards": 33},
			draft.WR, RulesOf(tePremium), 7.3},
		{"a kicker", map[string]float64{"field_goals_made": 3, "extra_points_made": 2}, draft.K, standard, 11},
		{"a metric the rules do not score is ignored", map[string]float64{"targets": 9, "receptions": 1}, draft.WR, RulesOf(ppr), 1},
		{"a defense", map[string]float64{"sacks": 3, "defensive_interceptions": 1, "defensive_touchdowns": 1}, draft.DEF, standard, 11},
	}
	for _, c := range cases {
		if got := c.rules.Points(c.metrics, c.position); got != c.want {
			t.Errorf("%s: %v, want %v", c.name, got, c.want)
		}
	}
}

// The parity fixture: research's compute_fantasy_points scored each line
// under its presets (research/tests/test_scoring_parity.py), and the
// league's rules score each the same, to the cent. The file is kept byte
// for byte in both places.
func TestPointsMatchResearchOnTheSharedFixture(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("testdata", "scoring-parity.json"))
	if err != nil {
		t.Fatal(err)
	}
	theirs, err := os.ReadFile(filepath.Join("..", "..", "..", "research", "tests", "testdata", "scoring-parity.json"))
	if err != nil || !bytes.Equal(raw, theirs) {
		t.Fatalf("the research copy differs or is gone: %v", err)
	}
	var fixture struct {
		Cases []struct {
			Name     string             `json:"name"`
			Rules    string             `json:"rules"`
			Position string             `json:"position"`
			Metrics  map[string]float64 `json:"metrics"`
			Points   float64            `json:"points"`
		} `json:"cases"`
	}
	if err := json.Unmarshal(raw, &fixture); err != nil || len(fixture.Cases) == 0 {
		t.Fatalf("fixture: %v", err)
	}
	presets := map[string]apitypes.ScoringPreset{"standard": apitypes.ScoringPresetStandard, "ppr": apitypes.ScoringPresetPpr,
		"half_ppr": apitypes.ScoringPresetHalfPpr}
	for _, c := range fixture.Cases {
		preset, ok := presets[c.Rules]
		if !ok {
			t.Fatalf("%s: rules %q", c.Name, c.Rules)
		}
		if got := RulesOf(scoring.PresetRules(preset)).Points(c.Metrics, draft.Position(c.Position)); got != c.Points {
			t.Errorf("%s: %v, research %v", c.Name, got, c.Points)
		}
	}
}

// A league's own kicking and defense rules: a field goal scores by its
// distance where the line says it, the rest at the under-40 figure; a
// defense scores the league's tier for its points and yards allowed.
func TestPointsUnderTheLeaguesKickingAndDefenseRules(t *testing.T) {
	r := scoring.Standard()
	r.PointsPerFieldGoal4049, r.PointsPerFieldGoal50Plus = 4, 5
	r.PointsAllowed0, r.PointsAllowed1820, r.PointsAllowed21 = 10, 2, 1
	r.YardsAllowed099, r.YardsAllowed550Plus = 0, -2
	rules := RulesOf(r)
	cases := []struct {
		name     string
		metrics  map[string]float64
		position draft.Position
		want     float64
	}{
		{"four makes, one from 40 to 49 and two from 50", map[string]float64{"field_goals_made": 4, "field_goals_made_40_49": 1,
			"field_goals_made_50_59": 1, "field_goals_made_60_plus": 1}, draft.K, 17},
		{"a defense's return touchdown", map[string]float64{"return_touchdowns": 1}, draft.DEF, 6},
		{"makes with no distance read", map[string]float64{"field_goals_made": 2}, draft.K, 6},
		{"a shutout", map[string]float64{"points_allowed": 0, "yards_allowed": 80}, draft.DEF, 10},
		{"20 allowed", map[string]float64{"points_allowed": 20, "yards_allowed": 600}, draft.DEF, 0},
		{"21 allowed", map[string]float64{"points_allowed": 21, "yards_allowed": 320}, draft.DEF, 1},
		{"no tiers for anyone but a defense", map[string]float64{"points_allowed": 0}, draft.TE, 0},
	}
	for _, c := range cases {
		if got := rules.Points(c.metrics, c.position); got != c.want {
			t.Errorf("%s: %v, want %v", c.name, got, c.want)
		}
	}
}
