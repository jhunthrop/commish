package inseason

import (
	"testing"

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
