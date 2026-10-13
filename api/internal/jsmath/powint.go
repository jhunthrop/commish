package jsmath

import (
	"math"
	"math/big"
)

// powIntPrecision holds any product of up to 75 doubles exactly, so the
// one rounding PowInt makes is the final one.
const powIntPrecision = 4000

// PowInt is x ** n for a whole n >= 0, correctly rounded. V8's ** is the
// platform libm (fdlibm is not used for it), which is not correctly
// rounded everywhere; over every base and exponent the engine can raise
// (a ramped damp to a body count, api/testdata/pins/float-vectors.json
// "powReachable") V8 and the correct rounding agree in every bit, which
// the parity test asserts. Exponents beyond 75 panic: nothing the engine
// counts gets there.
func PowInt(x float64, n int) float64 {
	switch {
	case n < 0 || n > 75:
		panic("jsmath.PowInt: exponent outside 0..75")
	case n == 0:
		return 1
	case n == 1:
		return x
	case n == 2:
		return x * x
	case math.IsNaN(x) || math.IsInf(x, 0) || x == 0:
		return math.Pow(x, float64(n))
	}
	if frac, exp := math.Frexp(x); frac == 0.5 || frac == -0.5 {
		// A power of two raised stays a power of two: exact while in range.
		return math.Ldexp(math.Pow(frac*2, float64(n)), (exp-1)*n)
	}
	acc := new(big.Float).SetPrec(powIntPrecision).SetFloat64(x)
	base := new(big.Float).SetPrec(powIntPrecision).SetFloat64(x)
	for i := 1; i < n; i++ {
		acc.Mul(acc, base)
	}
	f, _ := acc.Float64()
	return f
}
