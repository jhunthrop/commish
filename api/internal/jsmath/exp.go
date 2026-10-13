// Package jsmath reproduces, bit for bit, the float arithmetic the
// TypeScript draft engine gets from V8: Math.exp, Math.log and the **
// operator are fdlibm in V8 (src/base/ieee754.cc), not the platform libm
// and not Go's math package, whose Exp, Log and Pow round differently in
// the last place. Every product that feeds a sum is wrapped in float64()
// so the Go compiler cannot fuse it into a multiply-add on arm64, which
// would round once where V8 rounds twice. The parity vectors in
// api/testdata/pins/float-vectors.json are V8's own outputs.
package jsmath

import "math"

func highWord(x float64) uint32 { return uint32(math.Float64bits(x) >> 32) }
func lowWord(x float64) uint32  { return uint32(math.Float64bits(x)) }

func fromWords(hi, lo uint32) float64 {
	return math.Float64frombits(uint64(hi)<<32 | uint64(lo))
}

// withLowWord is x with its low 32 bits replaced.
func withLowWord(x float64, lo uint32) float64 { return fromWords(highWord(x), lo) }

// withHighWord is x with its high 32 bits replaced.
func withHighWord(x float64, hi uint32) float64 { return fromWords(hi, lowWord(x)) }

const (
	expOThreshold = 7.09782712893383973096e+02
	expUThreshold = -7.45133219101941108420e+02
	expInvLn2     = 1.44269504088896338700e+00
	expP1         = 1.66666666666666019037e-01
	expP2         = -2.77777777770155933842e-03
	expP3         = 6.61375632143793436117e-05
	expP4         = -1.65339022054652515390e-06
	expP5         = 4.13813679705723846039e-08
	expE          = 2.718281828459045
	expHuge       = 1.0e+300
	expTwom1000   = 9.33263618503218878990e-302
	expTwo1023    = 8.988465674311579539e307
)

func expLn2Hi(sign uint32) float64 {
	if sign == 0 {
		return 6.93147180369123816490e-01
	}
	return -6.93147180369123816490e-01
}

func expLn2Lo(sign uint32) float64 {
	if sign == 0 {
		return 1.90821492927058770002e-10
	}
	return -1.90821492927058770002e-10
}

func expHalf(sign uint32) float64 {
	if sign == 0 {
		return 0.5
	}
	return -0.5
}

// Exp is V8's Math.exp (fdlibm e_exp.c with V8's exp(1) special case).
func Exp(x float64) float64 {
	hx := highWord(x)
	xsb := (hx >> 31) & 1
	hx &= 0x7FFFFFFF

	if hx >= 0x40862E42 {
		if hx >= 0x7FF00000 {
			if (hx&0xFFFFF)|lowWord(x) != 0 {
				return x + x
			}
			if xsb == 0 {
				return x
			}
			return 0
		}
		if x > expOThreshold {
			return math.Inf(1)
		}
		if x < expUThreshold {
			return 0
		}
	}

	var hi, lo float64
	k := int32(0)
	switch {
	case hx > 0x3FD62E42:
		if hx < 0x3FF0A2B2 {
			if x == 1.0 {
				return expE
			}
			hi = x - expLn2Hi(xsb)
			lo = expLn2Lo(xsb)
			k = 1 - int32(xsb) - int32(xsb)
		} else {
			k = int32(math.FMA(expInvLn2, x, expHalf(xsb)))
			t := float64(k)
			hi = math.FMA(-t, expLn2Hi(0), x)
			lo = float64(t * expLn2Lo(0))
		}
		x = hi - lo
	case hx < 0x3E300000:
		if expHuge+x > 1 {
			return 1 + x
		}
	}

	t := float64(x * x)
	var twopk float64
	if k >= -1021 {
		twopk = fromWords(uint32(0x3FF00000+(k<<20)), 0)
	} else {
		twopk = fromWords(uint32(0x3FF00000+((k+1000)<<20)), 0)
	}
	poly := math.FMA(t, expP5, expP4)
	poly = math.FMA(t, poly, expP3)
	poly = math.FMA(t, poly, expP2)
	poly = math.FMA(t, poly, expP1)
	c := math.FMA(-t, poly, x)
	if k == 0 {
		return 1 - (float64(x*c)/(c-2.0) - x)
	}
	y := 1 - ((lo - float64(x*c)/(2.0-c)) - hi)
	if k >= -1021 {
		if k == 1024 {
			return y * 2.0 * expTwo1023
		}
		return y * twopk
	}
	return y * twopk * expTwom1000
}
