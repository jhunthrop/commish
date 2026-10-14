package leaguesync

import (
	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/scoring"
)

// The saved league's scoring is ScoringRules, the 21 keys
// research/model/domain.py names (internal/scoring, the contract's closed
// object), never a host's own keys. A host's rules are mapped the
// way part A's import map reads Sleeper (lane-8-brief, part A): each key
// below from the one host key, the two-point trio and the kick and punt
// return touchdowns only when the host scores them alike. Every host rule
// the map does not take is named in Dropped; every rule key the host does
// not state takes the standard figure and is named in Defaulted.

// RuleKey is one ScoringRules key.
type RuleKey string

// Keys a preset is read from.
const (
	ruleReception = RuleKey(scoring.Reception)
	ruleTEBonus   = RuleKey(scoring.TEBonus)
)

// mapped is a host's rules as ScoringRules: the rules, the host keys the
// map left (for the caller to name in the host's words), and the rule
// keys the host does not state.
type mapped struct {
	rules     map[string]float64
	left      []string
	defaulted []string
}

// toRules maps host keys (Sleeper's names) to ScoringRules, the one map
// the import and the companion read too (scoring.MapSleeperNames).
func toRules(host map[string]float64) mapped {
	m := scoring.MapSleeperNames(host)
	return mapped{rules: m.Rules, left: m.Left, defaulted: m.Defaulted}
}

// Reception points a league must reach to read like PPR or half PPR, the
// boards service's own thresholds (scoring.PPRFrom, scoring.HalfFrom).
const (
	pprFrom  = scoring.PPRFrom
	halfFrom = scoring.HalfFrom
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
