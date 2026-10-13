package jsmath

import "math"

const (
	logLn2Hi = 6.93147180369123816490e-01
	logLn2Lo = 1.90821492927058770002e-10
	logTwo54 = 1.80143985094819840000e+16
	logLg1   = 6.666666666666735130e-01
	logLg2   = 3.999999999940941908e-01
	logLg3   = 2.857142874366239149e-01
	logLg4   = 2.222219843214978396e-01
	logLg5   = 1.818357216161805012e-01
	logLg6   = 1.531383769920937332e-01
	logLg7   = 1.479819860511658591e-01
)

// Log is V8's Math.log (fdlibm e_log.c).
func Log(x float64) float64 {
	hx := int32(highWord(x))
	lx := lowWord(x)

	k := int32(0)
	if hx < 0x00100000 {
		if (hx&0x7FFFFFFF)|int32(lx) == 0 {
			return math.Inf(-1)
		}
		if hx < 0 {
			return math.NaN()
		}
		k -= 54
		x *= logTwo54
		hx = int32(highWord(x))
	}
	if hx >= 0x7FF00000 {
		return x + x
	}
	k += (hx >> 20) - 1023
	hx &= 0x000FFFFF
	i := (hx + 0x95F64) & 0x100000
	x = withHighWord(x, uint32(hx|(i^0x3FF00000)))
	k += i >> 20
	f := x - 1.0
	if (0x000FFFFF & (2 + hx)) < 3 {
		return logNearOne(f, k)
	}
	s := f / (2.0 + f)
	dk := float64(k)
	z := s * s
	i = hx - 0x6147A
	w := z * z
	j := 0x6B851 - hx
	t1 := float64(w * math.FMA(w, math.FMA(w, logLg6, logLg4), logLg2))
	t2 := float64(z * math.FMA(w, math.FMA(w, math.FMA(w, logLg7, logLg5), logLg3), logLg1))
	i |= j
	r := t2 + t1
	if i > 0 {
		hfsq := float64(0.5 * f * f)
		if k == 0 {
			return f - math.FMA(-s, hfsq+r, hfsq)
		}
		return math.FMA(dk, logLn2Hi, -((hfsq - math.FMA(s, hfsq+r, dk*logLn2Lo)) - f))
	}
	if k == 0 {
		return math.FMA(-s, f-r, f)
	}
	return math.FMA(dk, logLn2Hi, -(math.FMA(s, f-r, -(dk*logLn2Lo)) - f))
}

// logNearOne is e_log.c's branch for -2**-20 <= f < 2**-20.
func logNearOne(f float64, k int32) float64 {
	if f == 0 {
		if k == 0 {
			return 0
		}
		dk := float64(k)
		return math.FMA(dk, logLn2Hi, dk*logLn2Lo)
	}
	r := float64(f * f * math.FMA(-0.33333333333333333, f, 0.5))
	if k == 0 {
		return f - r
	}
	dk := float64(k)
	return math.FMA(dk, logLn2Hi, -(math.FMA(-dk, logLn2Lo, r) - f))
}
