package boards

import (
	"testing"

	"github.com/jhunthrop/commish/api/internal/apitypes"
)

// A projection's change is the difference of the tenths the screens print,
// by the site's one rule (Lane 66k rereview N3), and is itself a clean
// tenth: 9.45 (9.5) against 8.25 (8.3) is exactly 1.2.
func TestDeltaIsTheTenthsByTheOneRule(t *testing.T) {
	then := &WeekProjection{Players: map[string]ProjectedPoints{"p": {PPR: 8.25}}}
	now := WeekProjection{Players: map[string]ProjectedPoints{"p": {PPR: 9.45}}, Previous: then}
	d, ok := now.Delta("p", "WR", "CHI", apitypes.ScoringPresetPpr)
	if !ok || d != 1.2 {
		t.Fatalf("delta %v %v, want exactly 1.2", d, ok)
	}
}
