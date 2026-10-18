package mock

import "testing"

// A pick's Picks later and its chip come from one function (Lane 66o
// re-review N6): the pick less the ADP the report prints, rounded once and
// then subtracted, so the chip can never read "at ADP" beside a printed +3.0.
// Plus is a pick later than drafters take him (a steal), minus earlier (a
// reach).
func TestTheChipFollowsThePrintedPicksLater(t *testing.T) {
	cases := []struct {
		name  string
		pick  int
		adp   float64
		later float64
		chip  ADPChip
	}{
		// ADP 2.04 prints as 2.0, so pick 5 is 3.0 later: a steal. The
		// unrounded gap (2.96) would have read "at ADP".
		{"a steal at the edge once the ADP is rounded", 5, 2.04, 3.0, Steal},
		{"a reach at the edge", 2, 4.96, -3.0, Reach},
		{"within the edge is at ADP", 5, 2.06, 2.9, AtADP},
		{"a late pick is a steal", 120, 110.8, 9.2, Steal},
		{"an early pick is a reach", 1, 126.4, -125.4, Reach},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			later := PicksLater(c.pick, c.adp)
			if later != c.later || chipFor(later) != c.chip {
				t.Fatalf("pick %d at ADP %v: later %v chip %q, want %v %q", c.pick, c.adp, later, chipFor(later), c.later, c.chip)
			}
		})
	}
}
