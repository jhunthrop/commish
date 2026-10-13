package boards

import (
	"testing"

	"github.com/jhunthrop/commish/api/internal/apitypes"
)

// A custom rule reads the nearest board by its reception points, under
// Sleeper's name (rec) as before and under ScoringRules' name, which an
// attached league saves; ScoringRules' name wins when both are there.
func TestFormatForReadsBothReceptionNames(t *testing.T) {
	cases := []struct {
		custom map[string]float64
		want   Format
	}{
		{map[string]float64{"rec": 1}, PPR},
		{map[string]float64{"rec": 0.5}, Half},
		{map[string]float64{"rec": 0}, Standard},
		{map[string]float64{"points_per_reception": 0.5}, Half},
		{map[string]float64{"points_per_reception": 1, "te_reception_bonus": 0.5}, PPR},
		{map[string]float64{"points_per_reception": 0}, Standard},
		{map[string]float64{"rec": 1, "points_per_reception": 0.5}, Half},
	}
	for _, c := range cases {
		custom := c.custom
		if got := FormatFor(apitypes.Scoring{Custom: &custom}); got != c.want {
			t.Errorf("FormatFor(%v) = %s, want %s", c.custom, got, c.want)
		}
	}
}
