package companion

import "testing"

// The live companion's outcome range rounds by the site's one rule (Lane
// 66k rereview), half away from zero on the decimal: 9.45 is 9.5 and a
// negative floor of -1.15 is -1.2, never -1.1.
func TestOutcomeRangeRoundsByTheOneRule(t *testing.T) {
	for in, want := range map[float64]float64{9.45: 9.5, -1.15: -1.2, 12.349: 12.3} {
		if got := round1(in); got != want {
			t.Errorf("round1(%v) = %v, want %v", in, got, want)
		}
	}
}
