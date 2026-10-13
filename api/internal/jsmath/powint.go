package jsmath

import (
	"math"
	"math/big"
)

// PowInt is x ** n for a whole n, correctly rounded. The exponent is
// unsigned because the engine only raises a damp to a count of bodies, so
// there is no invalid input to refuse. V8's ** is the platform libm
// (fdlibm is not used for it), which is not correctly rounded everywhere;
// over every base and exponent the engine can raise (a ramped damp to a
// body count, api/testdata/pins/float-vectors.json "powReachable") V8 and
// the correct rounding agree in every bit, which the parity test asserts.
func PowInt(x float64, n uint) float64 {
	switch {
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
		return math.Ldexp(math.Pow(frac*2, float64(n)), (exp-1)*int(n))
	}
	// The product of n doubles fits exactly in 53n bits, so the one
	// rounding is the final conversion.
	precision := 53*n + 64
	acc := new(big.Float).SetPrec(precision).SetFloat64(x)
	base := new(big.Float).SetPrec(precision).SetFloat64(x)
	for i := uint(1); i < n; i++ {
		acc.Mul(acc, base)
	}
	f, _ := acc.Float64()
	return f
}
