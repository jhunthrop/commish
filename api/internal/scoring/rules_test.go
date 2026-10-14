package scoring

import (
	"encoding/json"
	"errors"
	"slices"
	"strings"
	"testing"

	"github.com/jhunthrop/commish/api/internal/apitypes"
)

func standard() map[string]float64 {
	out := map[string]float64{}
	for _, r := range Rules() {
		out[r.Key] = r.Standard
	}
	return out
}

// The 21 keys are the contract's, a missing rule is refused, and the map
// and the closed object round trip.
func TestRulesAndConversions(t *testing.T) {
	keys := make([]string, 0, len(rules))
	for _, r := range Rules() {
		keys = append(keys, r.Key)
	}
	contract := apitypes.ScoringRuleKeys()
	slices.Sort(keys)
	slices.Sort(contract)
	if !slices.Equal(keys, contract) {
		t.Fatalf("rules %v, contract %v", keys, contract)
	}
	m := standard()
	m[Reception] = 0.5
	r, err := FromMap(m)
	if err != nil || r.PointsPerReception != 0.5 || r.PointsPerPassingYard != 0.04 {
		t.Fatalf("FromMap = %+v, %v", r, err)
	}
	back := ToMap(r)
	for k, v := range m {
		if back[k] != v {
			t.Errorf("%s: %g back as %g", k, v, back[k])
		}
	}
	delete(m, "points_per_safety")
	if _, err := FromMap(m); err == nil {
		t.Error("a missing rule was read")
	}
	r.PointsPerSack = 101
	if p := Problems(r); p["points_per_sack"] == "" || len(p) != 1 {
		t.Errorf("problems %v", p)
	}
}

// The closed object refuses an unknown rule, a missing one and a null by
// name, so no rule is ever zero by omission.
func TestScoringRulesDecodeStrictly(t *testing.T) {
	body := func(edit func(map[string]any)) []byte {
		m := map[string]any{}
		for k, v := range standard() {
			m[k] = v
		}
		edit(m)
		b, _ := json.Marshal(m)
		return b
	}
	cases := map[string]struct {
		edit  func(map[string]any)
		field string
	}{
		"unknown": {func(m map[string]any) { m["points_per_carry"] = 1 }, "scoring.custom.points_per_carry"},
		"missing": {func(m map[string]any) { delete(m, "points_per_safety") }, "scoring.custom.points_per_safety"},
		"null":    {func(m map[string]any) { m["points_per_sack"] = nil }, "scoring.custom.points_per_sack"},
		"string":  {func(m map[string]any) { m["points_per_sack"] = "1" }, "scoring.custom.points_per_sack"},
	}
	for name, c := range cases {
		var r apitypes.ScoringRules
		var fe *apitypes.FieldError
		if err := json.Unmarshal(body(c.edit), &r); !errors.As(err, &fe) || fe.Field != c.field {
			t.Errorf("%s: %v, want a field error at %s", name, err, c.field)
		}
	}
	var r apitypes.ScoringRules
	if err := json.Unmarshal(body(func(map[string]any) {}), &r); err != nil || r.PointsPerFieldGoal != 3 {
		t.Errorf("the 21 rules: %+v, %v", r, err)
	}
}

// Sleeper's settings map to the 21: the two-point trio when alike, every
// other non-zero setting named with its figure, a figure out of bounds
// named, and what Sleeper leaves out at the standard figure.
func TestFromSleeper(t *testing.T) {
	im := FromSleeper(map[string]float64{
		"rec": 1, "pass_td": 6, "pass_2pt": 2, "rush_2pt": 2, "rec_2pt": 2, "bonus_rec_te": 0.5,
		"pass_cmp": 0.1, "st_td": 0, "rush_fd": 1e6, "IDP‮_tkl": 1,
	})
	if im.Rules[Reception] != 1 || im.Rules["points_per_two_point_conversion"] != 2 || im.Rules[TEBonus] != 0.5 {
		t.Errorf("rules %v", im.Rules)
	}
	ranged := FromSleeper(map[string]float64{"fgm_0_19": 3, "fgm_20_29": 3, "fgm_30_39": 3, "fgm_40_49": 4, "fgm_50p": 5})
	if ranged.Rules["points_per_field_goal"] != 3 || !slices.Equal(ranged.Dropped, []string{"fgm_40_49 4", "fgm_50p 5"}) {
		t.Errorf("field goals by distance: %v, dropped %q", ranged.Rules["points_per_field_goal"], ranged.Dropped)
	}
	for _, want := range []string{"pass_cmp 0.1", "rush_fd 1e+06", "IDP_tkl 1"} {
		if !slices.Contains(im.Dropped, want) {
			t.Errorf("dropped %q, want %q", im.Dropped, want)
		}
	}
	if slices.ContainsFunc(im.Dropped, func(d string) bool { return strings.HasPrefix(d, "st_td") }) {
		t.Error("a setting worth 0 was named dropped")
	}
	if len(im.Rules) != 21 || slices.Contains(im.Applied(), "points_per_safety") || !slices.Contains(im.Applied(), Reception) {
		t.Errorf("applied %v", im.Applied())
	}
}
