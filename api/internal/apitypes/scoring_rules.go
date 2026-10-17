package apitypes

import (
	"bytes"
	"encoding/json"
	"fmt"
	"maps"
	"reflect"
	"sort"
	"strconv"
	"strings"
	"sync"
)

// FieldError is a body refused at one field: httpx answers it as that
// field's problem rather than as a body that is not JSON.
type FieldError struct {
	Field   string
	Problem string
}

func (e *FieldError) Error() string { return e.Field + " " + e.Problem }

// scoringRulesField is where a league's rules sit in every body that
// carries them (LeagueSettings.scoring.custom).
const scoringRulesField = "scoring.custom"

var ruleKeys = sync.OnceValue(func() []string {
	t := reflect.TypeFor[ScoringRules]()
	keys := make([]string, 0, t.NumField())
	for i := range t.NumField() {
		keys = append(keys, strings.Split(t.Field(i).Tag.Get("json"), ",")[0])
	}
	return keys
})

// ScoringRuleKeys is every rule name, as the contract names them.
func ScoringRuleKeys() []string { return append([]string(nil), ruleKeys()...) }

// kickDefenseStandards is the standard figure of each optional rule, a
// kicker's longer field goals and a team defense's tiers (research's
// domain.py tier tables): what an absent one reads as. internal/scoring
// takes its standard figures from here.
var kickDefenseStandards = map[string]float64{
	"points_per_field_goal_40_49": 3, "points_per_field_goal_50_plus": 3,
	"points_allowed_0": 5, "points_allowed_1_6": 4, "points_allowed_7_13": 3, "points_allowed_14_17": 1,
	"points_allowed_18_20": 0, "points_allowed_21": 0, "points_allowed_22_27": 0, "points_allowed_28_34": -1,
	"points_allowed_35_45": -3, "points_allowed_46_plus": -5,
	"yards_allowed_0_99": 5, "yards_allowed_100_199": 3, "yards_allowed_200_299": 2, "yards_allowed_300_349": 0,
	"yards_allowed_350_399": -1, "yards_allowed_400_449": -3, "yards_allowed_450_499": -5, "yards_allowed_500_549": -6,
	"yards_allowed_550_plus": -7,
}

// KickDefenseStandards is the optional rules' standard figures, keyed by
// rule.
func KickDefenseStandards() map[string]float64 { return maps.Clone(kickDefenseStandards) }

// UnmarshalJSON reads the closed object: its rules, each a number. An
// unknown key, a missing board rule or a null is a FieldError naming it,
// so no rule is ever read as zero by omission; a missing kicking or
// defense rule reads at its standard figure, so a body from before those
// rules existed stays good.
func (r *ScoringRules) UnmarshalJSON(data []byte) error {
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(data, &raw); err != nil || raw == nil {
		return &FieldError{Field: scoringRulesField, Problem: "must be an object of the scoring rules"}
	}
	known := map[string]bool{}
	for _, k := range ruleKeys() {
		known[k] = true
	}
	unknown := make([]string, 0)
	for k := range raw {
		if !known[k] {
			unknown = append(unknown, k)
		}
	}
	if len(unknown) > 0 {
		sort.Strings(unknown)
		return &FieldError{Field: scoringRulesField + "." + unknown[0], Problem: "is not a scoring rule"}
	}
	for _, k := range ruleKeys() {
		v, ok := raw[k]
		if std, optional := kickDefenseStandards[k]; !ok && optional {
			raw[k] = json.RawMessage(strconv.FormatFloat(std, 'g', -1, 64))
			continue
		}
		if !ok {
			return &FieldError{Field: scoringRulesField + "." + k, Problem: "is required"}
		}
		var n float64
		if bytes.Equal(bytes.TrimSpace(v), []byte("null")) || json.Unmarshal(v, &n) != nil {
			return &FieldError{Field: scoringRulesField + "." + k, Problem: "must be a number"}
		}
	}
	type plain ScoringRules
	var out plain
	whole, err := json.Marshal(raw)
	if err != nil {
		return fmt.Errorf("scoring rules: %w", err)
	}
	if err := json.Unmarshal(whole, &out); err != nil {
		return fmt.Errorf("scoring rules: %w", err)
	}
	*r = ScoringRules(out)
	return nil
}
