package jsmath_test

import (
	"encoding/json"
	"math"
	"os"
	"strconv"
	"testing"

	"github.com/jhunthrop/commish/api/internal/jsmath"
)

// floatVectors is V8's own answers, recorded by scripts/export-pins.ts.
type floatVectors struct {
	Node string     `json:"node"`
	Exp  [][]string `json:"exp"`
	Log  [][]string `json:"log"`
	// PowReachable is every base and exponent the engine raises; PowOther
	// is a spread beyond them, reported but not gated.
	PowReachable [][]any `json:"powReachable"`
	PowOther     [][]any `json:"powOther"`
	Collate      [][]any `json:"collate"`
}

func loadVectors(t *testing.T) floatVectors {
	t.Helper()
	raw, err := os.ReadFile("../../testdata/pins/float-vectors.json")
	if err != nil {
		t.Fatalf("read vectors: %v", err)
	}
	var v floatVectors
	if err := json.Unmarshal(raw, &v); err != nil {
		t.Fatalf("decode vectors: %v", err)
	}
	return v
}

func fromHex(t *testing.T, s string) float64 {
	t.Helper()
	u, err := strconv.ParseUint(s, 16, 64)
	if err != nil {
		t.Fatalf("bits %q: %v", s, err)
	}
	return math.Float64frombits(u)
}

func sameBits(a, b float64) bool {
	if math.IsNaN(a) && math.IsNaN(b) {
		return true
	}
	return math.Float64bits(a) == math.Float64bits(b)
}

// TestFloatParityWithV8 is the gate the brief puts before everything
// else: the engine's exp, log and ** agree with V8 in every bit.
func TestFloatParityWithV8(t *testing.T) {
	v := loadVectors(t)
	unary := []struct {
		name string
		rows [][]string
		fn   func(float64) float64
	}{{"exp", v.Exp, jsmath.Exp}, {"log", v.Log, jsmath.Log}}
	for _, u := range unary {
		bad := 0
		for _, row := range u.rows {
			x, want := fromHex(t, row[0]), fromHex(t, row[1])
			if got := u.fn(x); !sameBits(got, want) {
				bad++
				if bad <= 5 {
					t.Errorf("%s(%v) = %x, V8 %x", u.name, x, math.Float64bits(got), math.Float64bits(want))
				}
			}
		}
		t.Logf("%s: %d vectors, %d differ (V8 of node %s)", u.name, len(u.rows), bad, v.Node)
	}
	if bad := powMismatches(t, v.PowReachable, true); bad != 0 {
		t.Errorf("pow over the engine's reachable bases: %d of %d differ from V8", bad, len(v.PowReachable))
	}
	t.Logf("pow beyond the engine's bases: %d of %d differ from V8 (not gated)", powMismatches(t, v.PowOther, false), len(v.PowOther))
}

func powMismatches(t *testing.T, rows [][]any, report bool) int {
	t.Helper()
	bad := 0
	for _, row := range rows {
		x, n, want := fromHex(t, row[0].(string)), int(row[1].(float64)), fromHex(t, row[2].(string))
		if got := jsmath.PowInt(x, n); !sameBits(got, want) {
			bad++
			if report && bad <= 5 {
				t.Errorf("PowInt(%v, %d) = %x, V8 %x", x, n, math.Float64bits(got), math.Float64bits(want))
			}
		}
	}
	return bad
}

func TestCollateParityWithV8(t *testing.T) {
	v := loadVectors(t)
	for _, row := range v.Collate {
		a, b, want := row[0].(string), row[1].(string), int(row[2].(float64))
		if got := jsmath.Collate(a, b); got != want {
			t.Errorf("Collate(%q, %q) = %d, V8 localeCompare %d", a, b, got, want)
		}
	}
}
