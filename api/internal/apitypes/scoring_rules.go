package apitypes

import (
	"bytes"
	"encoding/json"
	"fmt"
	"reflect"
	"sort"
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

// UnmarshalJSON reads the closed object: exactly its rules, each a
// number. An unknown key or a missing one is a FieldError naming it, so
// no rule is ever read as zero by omission.
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
	if err := json.Unmarshal(data, &out); err != nil {
		return fmt.Errorf("scoring rules: %w", err)
	}
	*r = ScoringRules(out)
	return nil
}
