package inseason

import (
	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/draft"
	"github.com/jhunthrop/commish/api/internal/jsmath"
	"github.com/jhunthrop/commish/api/internal/scoring"
)

// Stat line metrics beyond domain.py's StatLine fields: a kicker's made
// field goals by distance, counted inside field_goals_made.
const (
	metricFieldGoals40To49  = "field_goals_made_40_49"
	metricFieldGoals50AndUp = "field_goals_made_50_plus"
	metricPointsAllowed     = "points_allowed"
	metricYardsAllowed      = "yards_allowed"
)

// Rules is a league's ScoringRules, the points a stat line scores, with
// each tier's figure read once.
type Rules struct {
	r             apitypes.ScoringRules
	pointsAllowed tierTable
	yardsAllowed  tierTable
}

// tierTable is one group's tiers and the league's figure for each.
type tierTable struct {
	tiers   []scoring.Tier
	figures []float64
}

// at is the league's figure for the tier value falls in.
func (t tierTable) at(value float64) float64 {
	key := scoring.At(t.tiers, value).Key
	for i, tier := range t.tiers {
		if tier.Key == key {
			return t.figures[i]
		}
	}
	return 0
}

// RulesOf is the league's saved rules.
func RulesOf(r apitypes.ScoringRules) Rules {
	m := scoring.ToMap(r)
	figures := func(tiers []scoring.Tier) tierTable {
		out := tierTable{tiers: tiers, figures: make([]float64, len(tiers))}
		for i, t := range tiers {
			out.figures[i] = m[t.Key]
		}
		return out
	}
	return Rules{r: r, pointsAllowed: figures(scoring.PointsAllowedTiers()), yardsAllowed: figures(scoring.YardsAllowedTiers())}
}

// Points is a stat line under the rules, term for term and in the order
// of research/model/domain.py compute_fantasy_points, kept to the cent: a
// metric the line does not carry scores nothing, as research scores a
// missing optional stat. Two terms read more than research's: a field goal
// from 40 to 49 or from 50 scores its own rule where the line says its
// distance (the rest at points_per_field_goal, research's one figure), and
// a defense's points-allowed and yards-allowed tiers are the league's own
// (research's fixed tables are the standard figures). Any other metric is
// ignored. tests: score_test.go, with research on one shared fixture.
func (rs Rules) Points(m map[string]float64, position draft.Position) float64 {
	r := rs.r
	bonus := 0.0
	if position == draft.TE {
		bonus = r.TeReceptionBonus
	}
	receptions := float64(m["receptions"] * (r.PointsPerReception + bonus))
	total := float64(m["passing_yards"] * r.PointsPerPassingYard)
	total += float64(m["passing_touchdowns"] * r.PointsPerPassingTouchdown)
	total += float64(m["interceptions"] * r.PointsPerInterception)
	total += float64(m["rushing_yards"] * r.PointsPerRushingYard)
	total += float64(m["rushing_touchdowns"] * r.PointsPerRushingTouchdown)
	total += float64(m["receiving_yards"] * r.PointsPerReceivingYard)
	total += float64(m["receiving_touchdowns"] * r.PointsPerReceivingTouchdown)
	total += receptions
	total += float64(m["fumbles_lost"] * r.PointsPerFumbleLost)
	long, longer := m[metricFieldGoals40To49], m[metricFieldGoals50AndUp]
	total += float64((m["field_goals_made"] - long - longer) * r.PointsPerFieldGoal)
	total += float64(long * r.PointsPerFieldGoal4049)
	total += float64(longer * r.PointsPerFieldGoal50Plus)
	total += float64(m["extra_points_made"] * r.PointsPerExtraPoint)
	total += float64(m["sacks"] * r.PointsPerSack)
	total += float64(m["defensive_interceptions"] * r.PointsPerDefensiveInterception)
	total += float64(m["defensive_touchdowns"] * r.PointsPerDefensiveTouchdown)
	total += float64(m["two_point_conversions"] * r.PointsPerTwoPointConversion)
	total += float64(m["field_goals_missed"] * r.PointsPerFieldGoalMissed)
	total += float64(m["extra_points_missed"] * r.PointsPerExtraPointMissed)
	total += float64((m["kick_return_touchdowns"] + m["punt_return_touchdowns"]) * r.PointsPerReturnTouchdown)
	total += float64(m["defensive_fumbles_recovered"] * r.PointsPerDefensiveFumbleRecovery)
	total += float64(m["safeties"] * r.PointsPerSafety)
	total += rs.tierPoints(m, position)
	return roundCents(total)
}

// tierPoints is a defense's points-allowed and yards-allowed tiers, each
// only when the line reads it (domain.py _defense_tier_points).
func (rs Rules) tierPoints(m map[string]float64, position draft.Position) float64 {
	if position != draft.DEF {
		return 0
	}
	allowed, yards := 0.0, 0.0
	if v, ok := m[metricPointsAllowed]; ok {
		allowed = rs.pointsAllowed.at(v)
	}
	if v, ok := m[metricYardsAllowed]; ok {
		yards = rs.yardsAllowed.at(v)
	}
	return allowed + yards
}

// roundCents is research's round_points: Math.round(n * 100) / 100.
func roundCents(n float64) float64 { return jsmath.Round(n*100) / 100 }

// roundTenth keeps one decimal, as a page prints a points-a-game figure.
func roundTenth(n float64) float64 { return jsmath.Round(n*10) / 10 }
