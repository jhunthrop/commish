package scoring

import (
	"fmt"
	"math"

	"github.com/jhunthrop/commish/api/internal/apitypes"
)

// Open is a tier's top when it has none: "46 or more".
const Open = -1

// Tier is one range of a team defense's points or yards allowed in a game,
// both ends included, and the rule whose figure it scores. The ranges are
// the finest that carry every host's own brackets exactly (Sleeper's 14
// to 20 is two tiers here, ESPN's 18 to 21 is two), so no host bracket is
// ever read across another's.
type Tier struct {
	Key      string
	Lo, Hi   int
	Standard float64
}

// standardTiers sets each tier's standard figure, the contract's figure
// for an absent rule (apitypes.KickDefenseStandards).
func standardTiers(tiers []Tier) []Tier {
	standards := apitypes.KickDefenseStandards()
	out := make([]Tier, len(tiers))
	for i, t := range tiers {
		std, ok := standards[t.Key]
		if !ok {
			panic("scoring: no standard figure for " + t.Key)
		}
		t.Standard = std
		out[i] = t
	}
	return out
}

// pointsAllowedTiers and yardsAllowedTiers carry domain.py's
// POINTS_ALLOWED_TIERS and YARDS_ALLOWED_TIERS as their standard figures.
var pointsAllowedTiers = standardTiers([]Tier{
	{Key: "points_allowed_0", Lo: 0, Hi: 0}, {Key: "points_allowed_1_6", Lo: 1, Hi: 6}, {Key: "points_allowed_7_13", Lo: 7, Hi: 13},
	{Key: "points_allowed_14_17", Lo: 14, Hi: 17}, {Key: "points_allowed_18_20", Lo: 18, Hi: 20}, {Key: "points_allowed_21", Lo: 21, Hi: 21},
	{Key: "points_allowed_22_27", Lo: 22, Hi: 27}, {Key: "points_allowed_28_34", Lo: 28, Hi: 34}, {Key: "points_allowed_35_45", Lo: 35, Hi: 45},
	{Key: "points_allowed_46_plus", Lo: 46, Hi: Open},
})

var yardsAllowedTiers = standardTiers([]Tier{
	{Key: "yards_allowed_0_99", Lo: 0, Hi: 99}, {Key: "yards_allowed_100_199", Lo: 100, Hi: 199}, {Key: "yards_allowed_200_299", Lo: 200, Hi: 299},
	{Key: "yards_allowed_300_349", Lo: 300, Hi: 349}, {Key: "yards_allowed_350_399", Lo: 350, Hi: 399},
	{Key: "yards_allowed_400_449", Lo: 400, Hi: 449}, {Key: "yards_allowed_450_499", Lo: 450, Hi: 499},
	{Key: "yards_allowed_500_549", Lo: 500, Hi: 549}, {Key: "yards_allowed_550_plus", Lo: 550, Hi: Open},
})

// The longer field goals' rules: points_per_field_goal is a field goal
// under 40 yards, and any whose distance a stat line does not say.
const (
	FieldGoal        = "points_per_field_goal"
	FieldGoal40To49  = "points_per_field_goal_40_49"
	FieldGoal50AndUp = "points_per_field_goal_50_plus"
)

// PointsAllowedTiers is the points-allowed tiers, lowest first.
func PointsAllowedTiers() []Tier { return append([]Tier(nil), pointsAllowedTiers...) }

// YardsAllowedTiers is the yards-allowed tiers, lowest first.
func YardsAllowedTiers() []Tier { return append([]Tier(nil), yardsAllowedTiers...) }

// kickDefenseRules is the rules after domain.py's 21: the longer field
// goals at the standard field goal's figure, then the tiers.
func kickDefenseRules() []Rule {
	standards := apitypes.KickDefenseStandards()
	out := []Rule{{FieldGoal40To49, standards[FieldGoal40To49]}, {FieldGoal50AndUp, standards[FieldGoal50AndUp]}}
	for _, group := range [][]Tier{pointsAllowedTiers, yardsAllowedTiers} {
		for _, t := range group {
			out = append(out, Rule{t.Key, t.Standard})
		}
	}
	return out
}

// KickDefenseKeys is the rules after the board's 21: a kicker's longer
// field goals and a defense's tiers.
func KickDefenseKeys() map[string]bool {
	out := map[string]bool{}
	for _, r := range kickDefenseRules() {
		out[r.Key] = true
	}
	return out
}

// IsTier reports whether a rule is a points-allowed or yards-allowed tier.
func IsTier(key string) bool {
	for _, group := range [][]Tier{pointsAllowedTiers, yardsAllowedTiers} {
		for _, t := range group {
			if t.Key == key {
				return true
			}
		}
	}
	return false
}

// At is the tier a game's value falls in: the first whose top it does not
// pass, as domain.py's _tier_points reads its ceilings.
func At(tiers []Tier, value float64) Tier {
	for _, t := range tiers {
		if t.Hi == Open || value <= float64(t.Hi) {
			return t
		}
	}
	return tiers[len(tiers)-1]
}

// Cover is the tiers a host's bracket from lo to hi spans exactly, false
// when its ends fall inside a tier. A top at or over openFrom stands for
// "and up".
func Cover(tiers []Tier, lo, hi, openFrom int) ([]string, bool) {
	var out []string
	for _, t := range tiers {
		if t.Lo < lo {
			continue
		}
		if len(out) == 0 && t.Lo != lo {
			return nil, false
		}
		top := t.Hi
		if top == Open {
			top = math.MaxInt
		}
		if hi < openFrom && top > hi {
			return nil, false
		}
		out = append(out, t.Key)
		if top == hi || (hi >= openFrom && t.Hi == Open) {
			return out, true
		}
	}
	return nil, false
}

// Complete states every rule the map leaves out: a tier at 0 (a bracket
// the host does not score scores nothing there, as the host scores it),
// any other rule at its standard figure, named "key figure" in the answer.
func Complete(m map[string]float64) []string {
	var defaulted []string
	for _, r := range rules {
		if _, ok := m[r.Key]; ok {
			continue
		}
		if IsTier(r.Key) {
			m[r.Key] = 0
			continue
		}
		m[r.Key] = r.Standard
		defaulted = append(defaulted, fmt.Sprintf("%s %g", r.Key, r.Standard))
	}
	return defaulted
}
