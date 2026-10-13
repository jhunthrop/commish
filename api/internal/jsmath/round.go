package jsmath

import "math"

// Round is JavaScript's Math.round: the nearest integer, a half rounding
// toward positive infinity (Math.round(-2.5) is -2, math.Round gives -3).
func Round(x float64) float64 {
	if math.IsNaN(x) || math.IsInf(x, 0) {
		return x
	}
	floor := math.Floor(x)
	if x-floor >= 0.5 {
		return floor + 1
	}
	return floor
}
