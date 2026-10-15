package inseason

import (
	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/draft"
	"github.com/jhunthrop/commish/api/internal/jsmath"
)

// Rules is a league's ScoringRules, the points a stat line scores.
type Rules struct{ r apitypes.ScoringRules }

// RulesOf is the league's saved rules.
func RulesOf(r apitypes.ScoringRules) Rules { return Rules{r: r} }

// Points is a stat line under the rules, term for term and in the order
// of research/model/domain.py compute_fantasy_points, kept to the cent.
// The season's lines carry the fourteen STAT_FIELDS; the seven optional
// rules (two-point conversions, misses, return touchdowns, fumble
// recoveries, safeties) and a defense's points-allowed tiers have no
// metric in the store, so they score nothing, as research scores a
// missing optional stat. Any other metric is ignored.
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
	total += float64(m["field_goals_made"] * r.PointsPerFieldGoal)
	total += float64(m["extra_points_made"] * r.PointsPerExtraPoint)
	total += float64(m["sacks"] * r.PointsPerSack)
	total += float64(m["defensive_interceptions"] * r.PointsPerDefensiveInterception)
	total += float64(m["defensive_touchdowns"] * r.PointsPerDefensiveTouchdown)
	return roundCents(total)
}

// roundCents is research's round_points: Math.round(n * 100) / 100.
func roundCents(n float64) float64 { return jsmath.Round(n*100) / 100 }

// roundTenth keeps one decimal, as a page prints a points-a-game figure.
func roundTenth(n float64) float64 { return jsmath.Round(n*10) / 10 }
