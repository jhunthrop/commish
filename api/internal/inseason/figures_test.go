package inseason

import "math"

// fv is a nullable figure's value, NaN when withheld, so a comparison with
// a held figure fails.
func fv(p *float64) float64 {
	if p == nil {
		return math.NaN()
	}
	return *p
}

// fp is a held figure.
func fp(v float64) *float64 { return &v }
