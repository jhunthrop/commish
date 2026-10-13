package leaguesync

import (
	"fmt"
	"sort"

	"github.com/jhunthrop/commish/api/internal/apitypes"
)

// The saved league's scoring is ScoringRules, the 21 keys
// research/model/domain.py names (the closed object Lane 8 part A puts in
// the contract), never a host's own keys. A host's rules are mapped the
// way part A's import map reads Sleeper (lane-8-brief, part A): each key
// below from the one host key, the two-point trio and the kick and punt
// return touchdowns only when the host scores them alike. Every host rule
// the map does not take is named in Dropped; every rule key the host does
// not state takes the standard figure and is named in Defaulted.

// RuleKey is one ScoringRules key.
type RuleKey string

// ScoringRules' keys, in domain.py's order, with STANDARD_SCORING's
// figures.
var ruleKeys = []struct {
	key      RuleKey
	standard float64
}{
	{"points_per_passing_yard", 0.04}, {"points_per_passing_touchdown", 4}, {"points_per_interception", -2},
	{"points_per_rushing_yard", 0.1}, {"points_per_rushing_touchdown", 6}, {"points_per_receiving_yard", 0.1},
	{"points_per_receiving_touchdown", 6}, {"points_per_reception", 0}, {"points_per_fumble_lost", -2},
	{"te_reception_bonus", 0}, {"points_per_field_goal", 3}, {"points_per_extra_point", 1},
	{"points_per_sack", 1}, {"points_per_defensive_interception", 2}, {"points_per_defensive_touchdown", 6},
	{"points_per_two_point_conversion", 2}, {"points_per_field_goal_missed", -1},
	{"points_per_extra_point_missed", 0}, {"points_per_return_touchdown", 6},
	{"points_per_defensive_fumble_recovery", 2}, {"points_per_safety", 2},
}

// Keys a preset is read from.
const (
	ruleReception = RuleKey("points_per_reception")
	ruleTEBonus   = RuleKey("te_reception_bonus")
)

// importMap is each rule key's one host key (Sleeper's names; the
// MyFantasyLeague rules are put in these names first).
func importMap() map[string]RuleKey {
	return map[string]RuleKey{
		"pass_yd": "points_per_passing_yard", "pass_td": "points_per_passing_touchdown", "pass_int": "points_per_interception",
		"rush_yd": "points_per_rushing_yard", "rush_td": "points_per_rushing_touchdown", "rec_yd": "points_per_receiving_yard",
		"rec_td": "points_per_receiving_touchdown", "rec": ruleReception, "fum_lost": "points_per_fumble_lost",
		"bonus_rec_te": ruleTEBonus, "fgm": "points_per_field_goal", "xpm": "points_per_extra_point",
		"sack": "points_per_sack", "int": "points_per_defensive_interception", "def_td": "points_per_defensive_touchdown",
		"fgmiss": "points_per_field_goal_missed", "xpmiss": "points_per_extra_point_missed",
		"fum_rec": "points_per_defensive_fumble_recovery", "safe": "points_per_safety",
	}
}

// alike is a rule key taken from several host keys only when every one
// the host states scores the same.
func alike() map[RuleKey][]string {
	return map[RuleKey][]string{
		"points_per_two_point_conversion": {"pass_2pt", "rush_2pt", "rec_2pt"},
		"points_per_return_touchdown":     {"kr_td", "pr_td"},
	}
}

// mapped is a host's rules as ScoringRules: the rules, the host keys the
// map left (for the caller to name in the host's words), and the rule
// keys the host does not state.
type mapped struct {
	rules     map[string]float64
	left      []string
	defaulted []string
}

// toRules maps host keys (Sleeper's names) to ScoringRules.
func toRules(host map[string]float64) mapped {
	out := mapped{rules: map[string]float64{}}
	used := map[string]bool{}
	for hostKey, key := range importMap() {
		if v, ok := host[hostKey]; ok {
			out.rules[string(key)], used[hostKey] = v, true
		}
	}
	for key, hostKeys := range alike() {
		if v, ok := sameFigure(host, hostKeys); ok {
			out.rules[string(key)] = v
			for _, k := range hostKeys {
				used[k] = true
			}
		}
	}
	for k := range host {
		if !used[k] {
			out.left = append(out.left, k)
		}
	}
	sort.Strings(out.left)
	for _, rk := range ruleKeys {
		if _, ok := out.rules[string(rk.key)]; !ok {
			out.rules[string(rk.key)] = rk.standard
			out.defaulted = append(out.defaulted, fmt.Sprintf("%s %g", rk.key, rk.standard))
		}
	}
	return out
}

// sameFigure is the one figure every stated host key scores, false when
// none is stated or two differ.
func sameFigure(host map[string]float64, keys []string) (float64, bool) {
	var figure float64
	stated := false
	for _, k := range keys {
		v, ok := host[k]
		if !ok {
			continue
		}
		if stated && v != figure {
			return 0, false
		}
		figure, stated = v, true
	}
	return figure, stated
}

// Reception points a league must reach to read like PPR or half PPR, as
// the boards read a custom rule.
const (
	pprFrom  = 0.75
	halfFrom = 0.25
)

// NearestPreset is the preset a league's rules score most like: by
// reception points, TE premium when a tight end's catch counts more.
func NearestPreset(rules map[string]float64) apitypes.ScoringPreset {
	rec := rules[string(ruleReception)]
	switch {
	case rec >= pprFrom && rules[string(ruleTEBonus)] > 0:
		return apitypes.ScoringPresetTePremium
	case rec >= pprFrom:
		return apitypes.ScoringPresetPpr
	case rec >= halfFrom:
		return apitypes.ScoringPresetHalfPpr
	}
	return apitypes.ScoringPresetStandard
}
