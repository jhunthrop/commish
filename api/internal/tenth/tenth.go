// Package tenth is the site's one rounding rule for a figure a screen shows
// (Lane 66k H1): every figure is rounded once, here, to a tenth, and the
// web prints the API's tenth as given and never rounds it again.
package tenth

import (
	"math"
	"strconv"
	"strings"
)

// Round is n to one decimal, half away from zero, on the decimal n is
// written as: the shortest decimal string that reads back as n
// (strconv's 'f' with precision -1). So 9.45 gives 9.5 and 9.449 gives 9.4
// even though the binary 9.45 sits just below it, and a sum of tenths with
// binary noise (74.69999999999999) rounds back to the tenth it is. The
// result is read from its own decimal string, so it is the double nearest
// that tenth. A value that is not finite passes through.
//
// It reads the double's shortest decimal, so a raw sum of cents with binary
// noise (1.15000000002) rounds by its noise: round such a sum to the cent
// first, then pass it in. A sum of tenths needs no such step.
func Round(n float64) float64 {
	if math.IsNaN(n) || math.IsInf(n, 0) {
		return n
	}
	s := strconv.FormatFloat(math.Abs(n), 'f', -1, 64)
	whole, frac, _ := strings.Cut(s, ".")
	frac += "00"
	// The figure in tenths, as an integer from its digits.
	tenths, err := strconv.ParseInt(whole+frac[:1], 10, 64)
	if err != nil {
		// Beyond int64 tenths no figure has a decimal worth keeping.
		return n
	}
	if frac[1] >= '5' {
		tenths++
	}
	out, _ := strconv.ParseFloat(strconv.FormatInt(tenths/10, 10)+"."+strconv.FormatInt(tenths%10, 10), 64)
	if n < 0 && out != 0 {
		return -out
	}
	return out
}

// Case is one row of the rule's table.
type Case struct {
	In  float64 `json:"in"`
	Out float64 `json:"out"`
}

// Table is the rule's cases, shared with the web's test through
// web/src/lib/format/tenth-table.json (the same rows).
var Table = []Case{
	{9.45, 9.5}, {9.449, 9.4}, {1.15, 1.2}, {10.35, 10.4}, {0.25, 0.3}, {0.75, 0.8},
	{15.76, 15.8}, {9.48, 9.5}, {13.24, 13.2}, {20.59, 20.6}, {-1.15, -1.2}, {-0.04, 0},
	{2, 2}, {101.6, 101.6}, {74.69999999999999, 74.7}, {0.05, 0.1}, {0.049, 0},
}
