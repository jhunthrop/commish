// Package scoring is a league's exact scoring rules, ScoringRules: the 21
// rules research/model/domain.py names, in its order, with its standard
// figures, and the conversions between the contract's closed object and
// the rule-keyed maps the host readers build.
package scoring

import (
	"encoding/json"
	"fmt"
	"math"

	"github.com/jhunthrop/commish/api/internal/apitypes"
)

// MaxPoints bounds every rule either way, as the contract and the boards
// service do.
const MaxPoints = 100

// Rule is one ScoringRules key with STANDARD_SCORING's figure.
type Rule struct {
	Key      string
	Standard float64
}

// rules is domain.py's order and STANDARD_SCORING's figures.
var rules = []Rule{
	{"points_per_passing_yard", 0.04}, {"points_per_passing_touchdown", 4}, {"points_per_interception", -2},
	{"points_per_rushing_yard", 0.1}, {"points_per_rushing_touchdown", 6}, {"points_per_receiving_yard", 0.1},
	{"points_per_receiving_touchdown", 6}, {"points_per_reception", 0}, {"points_per_fumble_lost", -2},
	{"te_reception_bonus", 0}, {"points_per_field_goal", 3}, {"points_per_extra_point", 1},
	{"points_per_sack", 1}, {"points_per_defensive_interception", 2}, {"points_per_defensive_touchdown", 6},
	{"points_per_two_point_conversion", 2}, {"points_per_field_goal_missed", -1},
	{"points_per_extra_point_missed", 0}, {"points_per_return_touchdown", 6},
	{"points_per_defensive_fumble_recovery", 2}, {"points_per_safety", 2},
}

// Rules is every rule in domain.py's order.
func Rules() []Rule { return append([]Rule(nil), rules...) }

// Keys a reader looks for by name.
const (
	Reception = "points_per_reception"
	TEBonus   = "te_reception_bonus"
)

// FromMap is a rule-keyed map as ScoringRules. Every rule must be
// present: a missing one is an error, never a zero.
func FromMap(m map[string]float64) (apitypes.ScoringRules, error) {
	for _, r := range rules {
		if _, ok := m[r.Key]; !ok {
			return apitypes.ScoringRules{}, fmt.Errorf("scoring: %s is missing", r.Key)
		}
	}
	raw, err := json.Marshal(m)
	if err != nil {
		return apitypes.ScoringRules{}, fmt.Errorf("scoring: encode: %w", err)
	}
	var out apitypes.ScoringRules
	if err := json.Unmarshal(raw, &out); err != nil {
		return apitypes.ScoringRules{}, fmt.Errorf("scoring: %w", err)
	}
	return out, nil
}

// ToMap is ScoringRules keyed by rule.
func ToMap(r apitypes.ScoringRules) map[string]float64 {
	raw, err := json.Marshal(r)
	if err != nil {
		panic(fmt.Sprintf("scoring: a struct of float64s always encodes: %v", err))
	}
	out := map[string]float64{}
	if err := json.Unmarshal(raw, &out); err != nil {
		panic(fmt.Sprintf("scoring: its own encoding always decodes: %v", err))
	}
	return out
}

// Standard is STANDARD_SCORING as ScoringRules.
func Standard() apitypes.ScoringRules {
	m := map[string]float64{}
	for _, r := range rules {
		m[r.Key] = r.Standard
	}
	out, err := FromMap(m)
	if err != nil {
		panic(fmt.Sprintf("scoring: the standard figures name every rule: %v", err))
	}
	return out
}

// StoredPreset is the preset whose stored board a league's rules score
// exactly the same as (domain.py's PPR_SCORING, HALF_PPR_SCORING,
// STANDARD_SCORING: the standard figures with 1, 0.5 or 0 a catch), false
// for any other rules. research.parity proves those three boards are what
// the boards service builds for those rules, bit for bit.
func StoredPreset(r apitypes.ScoringRules) (apitypes.ScoringPreset, bool) {
	presets := []struct {
		preset    apitypes.ScoringPreset
		reception float64
	}{
		{apitypes.ScoringPresetPpr, 1}, {apitypes.ScoringPresetHalfPpr, 0.5}, {apitypes.ScoringPresetStandard, 0},
	}
	for _, p := range presets {
		want := Standard()
		want.PointsPerReception = p.reception
		if r == want {
			return p.preset, true
		}
	}
	return "", false
}

// Problems is each rule out of bounds, keyed by rule.
func Problems(r apitypes.ScoringRules) map[string]string {
	out := map[string]string{}
	for k, v := range ToMap(r) {
		if math.IsNaN(v) || math.IsInf(v, 0) || math.Abs(v) > MaxPoints {
			out[k] = fmt.Sprintf("Points stay within %d either way", MaxPoints)
		}
	}
	return out
}
