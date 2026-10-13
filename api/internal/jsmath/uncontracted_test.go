package jsmath_test

import (
	"math"
	"testing"
)

// The uncontracted fdlibm: e_exp.c and e_log.c with every product rounded
// on its own, as an x64 V8 built without multiply-add contraction computes
// them. Kept here only to measure how far the recorded vectors (arm64 V8,
// contracted) sit from it; the engine uses the contracted form.

func hi(x float64) uint32 { return uint32(math.Float64bits(x) >> 32) }

func words(h, l uint32) float64 { return math.Float64frombits(uint64(h)<<32 | uint64(l)) }

func expPlain(x float64) float64 {
	const (
		invLn2 = 1.44269504088896338700e+00
		p1     = 1.66666666666666019037e-01
		p2     = -2.77777777770155933842e-03
		p3     = 6.61375632143793436117e-05
		p4     = -1.65339022054652515390e-06
		p5     = 4.13813679705723846039e-08
		ln2Hi  = 6.93147180369123816490e-01
		ln2Lo  = 1.90821492927058770002e-10
	)
	hx := hi(x)
	xsb := (hx >> 31) & 1
	hx &= 0x7FFFFFFF
	if hx >= 0x40862E42 {
		switch {
		case hx >= 0x7FF00000 && xsb == 1:
			return 0
		case hx >= 0x7FF00000:
			return x + x
		case x > 7.09782712893383973096e+02:
			return math.Inf(1)
		case x < -7.45133219101941108420e+02:
			return 0
		}
	}
	sign := 1.0 - 2*float64(xsb)
	var h, l float64
	k := int32(0)
	switch {
	case hx > 0x3FD62E42:
		if hx < 0x3FF0A2B2 {
			if x == 1 {
				return 2.718281828459045
			}
			h, l, k = x-sign*ln2Hi, sign*ln2Lo, 1-int32(xsb)-int32(xsb)
		} else {
			k = int32(float64(invLn2*x) + 0.5*sign)
			t := float64(k)
			h, l = x-float64(t*ln2Hi), float64(t*ln2Lo)
		}
		x = h - l
	case hx < 0x3E300000:
		return 1 + x
	}
	t := float64(x * x)
	c := x - float64(t*(p1+float64(t*(p2+float64(t*(p3+float64(t*(p4+float64(t*p5)))))))))
	if k == 0 {
		return 1 - (float64(x*c)/(c-2.0) - x)
	}
	y := 1 - ((l - float64(x*c)/(2.0-c)) - h)
	if k >= -1021 {
		if k == 1024 {
			return y * 2.0 * 8.988465674311579539e307
		}
		return y * words(uint32(0x3FF00000+(k<<20)), 0)
	}
	return y * words(uint32(0x3FF00000+((k+1000)<<20)), 0) * 9.33263618503218878990e-302
}

func logPlain(x float64) float64 {
	const (
		ln2Hi = 6.93147180369123816490e-01
		ln2Lo = 1.90821492927058770002e-10
		lg1   = 6.666666666666735130e-01
		lg2   = 3.999999999940941908e-01
		lg3   = 2.857142874366239149e-01
		lg4   = 2.222219843214978396e-01
		lg5   = 1.818357216161805012e-01
		lg6   = 1.531383769920937332e-01
		lg7   = 1.479819860511658591e-01
	)
	hx := int32(hi(x))
	k := int32(0)
	if hx < 0x00100000 {
		if math.Float64bits(x)&^(1<<63) == 0 {
			return math.Inf(-1)
		}
		if hx < 0 {
			return math.NaN()
		}
		k -= 54
		x *= 1.80143985094819840000e+16
		hx = int32(hi(x))
	}
	if hx >= 0x7FF00000 {
		return x + x
	}
	k += (hx >> 20) - 1023
	hx &= 0x000FFFFF
	i := (hx + 0x95F64) & 0x100000
	x = words(uint32(hx|(i^0x3FF00000)), uint32(math.Float64bits(x)))
	k += i >> 20
	f := x - 1.0
	dk := float64(k)
	if (0x000FFFFF & (2 + hx)) < 3 {
		if f == 0 {
			return float64(dk*ln2Hi) + float64(dk*ln2Lo)
		}
		r := float64(float64(f*f) * (0.5 - float64(0.33333333333333333*f)))
		return float64(dk*ln2Hi) - ((r - float64(dk*ln2Lo)) - f)
	}
	s := f / (2.0 + f)
	z := float64(s * s)
	w := float64(z * z)
	t1 := float64(w * (lg2 + float64(w*(lg4+float64(w*lg6)))))
	t2 := float64(z * (lg1 + float64(w*(lg3+float64(w*(lg5+float64(w*lg7)))))))
	r := t2 + t1
	if (hx-0x6147A)|(0x6B851-hx) > 0 {
		hfsq := float64(float64(0.5*f) * f)
		return float64(dk*ln2Hi) - ((hfsq - (float64(s*(hfsq+r)) + float64(dk*ln2Lo))) - f)
	}
	return float64(dk*ln2Hi) - ((float64(s*(f-r)) - float64(dk*ln2Lo)) - f)
}

// Recorded differences between the uncontracted fdlibm and the vectors.
const (
	uncontractedExpDiffers = 2
	uncontractedLogDiffers = 58
)

// TestUncontractedFdlibmDiffersFromTheVectors reproduces the report's
// claim: the vectors (an arm64 V8) are not plain fdlibm, at these counts.
func TestUncontractedFdlibmDiffersFromTheVectors(t *testing.T) {
	v := loadVectors(t)
	count := func(rows [][]string, fn func(float64) float64) int {
		n := 0
		for _, row := range rows {
			if !sameBits(fn(fromHex(t, row[0])), fromHex(t, row[1])) {
				n++
			}
		}
		return n
	}
	exp, log := count(v.Exp, expPlain), count(v.Log, logPlain)
	t.Logf("uncontracted fdlibm against %s %s V8: exp %d of %d differ, log %d of %d", v.Arch, v.Node, exp, len(v.Exp), log, len(v.Log))
	if exp != uncontractedExpDiffers || log != uncontractedLogDiffers {
		t.Errorf("uncontracted differences are exp %d and log %d, recorded %d and %d", exp, log, uncontractedExpDiffers, uncontractedLogDiffers)
	}
}
