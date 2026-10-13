"""V8'S OWN TRANSCENDENTALS, BIT FOR BIT: `Math.log`, `Math.exp` and `Math.sin`.

V8 does not call the platform's libm for these. It carries fdlibm (`src/base/ieee754.cc`, the Sun
library by way of FreeBSD's msun), and the platform's libm rounds differently: on this machine
macOS's `log` differs from V8's in about one input in 250, `exp` in one in ten and `sin` in one
in 26. Python's `math` calls the platform's libm, so a port that used it would drift from the
oracle an ulp at a time. These are fdlibm's algorithms transcribed line for line, with the same
constants and the same order of operations.

ONE MORE THING DECIDES THE LAST BIT: the C compiler. clang's default `-ffp-contract=on` fuses
every `a * b + c` written inside one C expression into a single fused multiply-add, and the V8
node ships on Apple silicon was built that way. `madd` marks each place clang fuses (the left
operand's product when the left operand is one, else the right's: clang's `tryEmitFMulAdd`), and
`fused` says whether this build fused it. The `fdlibm` parity case proves the choice against the
running node on random inputs; x86-64 builds have no FMA instruction to contract into.

`sqrt` needs nothing: IEEE 754 requires it correctly rounded everywhere.
"""

# fdlibm compares and masks IEEE 754 words against its own bit patterns, and returns early at each
# special case; naming every pattern or folding the returns would hide the transcription it is.
# ruff: noqa: PLR2004, PLR0911

import math
import platform
import struct
from typing import Final

# The machine this process runs on: arm64 builds of V8 fuse, x86-64 builds cannot.
V8_FUSES_MULTIPLY_ADD: Final = platform.machine().lower() in ("arm64", "aarch64")

_PACK: Final = struct.Struct(">d")
_WORDS: Final = struct.Struct(">iI")
_UWORDS: Final = struct.Struct(">II")


def madd(a: float, b: float, c: float, fused: bool) -> float:
    """`a * b + c` as the C compiler emitted it: one rounding when fused, two when not."""
    return math.fma(a, b, c) if fused else a * b + c


def _hi(x: float) -> int:
    """`__HI(x)`: the high 32 bits as a signed int."""
    return int(_WORDS.unpack(_PACK.pack(x))[0])


def _lo(x: float) -> int:
    """`__LO(x)`: the low 32 bits, unsigned."""
    return int(_WORDS.unpack(_PACK.pack(x))[1])


def _from_words(hi: int, lo: int) -> float:
    return float(_PACK.unpack(_UWORDS.pack(hi & 0xFFFFFFFF, lo & 0xFFFFFFFF))[0])


def _with_lo_zero(x: float) -> float:
    return _from_words(_hi(x), 0)


def _with_hi(x: float, hi: int) -> float:
    return _from_words(hi, _lo(x))


def _to_int32(value: float) -> int:
    """C's `(int)` cast of a double in range: truncation toward zero."""
    return int(value)


# --- log ------------------------------------------------------------------------------------------

_LN2_HI: Final = 6.93147180369123816490e-01
_LN2_LO: Final = 1.90821492927058770002e-10
_TWO54: Final = 1.80143985094819840000e16
_LG: Final = (
    6.666666666666735130e-01,
    3.999999999940941908e-01,
    2.857142874366239149e-01,
    2.222219843214978396e-01,
    1.818357216161805012e-01,
    1.531383769920937332e-01,
    1.479819860511658591e-01,
)
_THIRD: Final = 0.33333333333333333


def _log_tiny_f(f: float, k: int, fused: bool) -> float:
    """|f| < 2**-20."""
    if f == 0.0:
        if k == 0:
            return 0.0
        dk = float(k)
        return madd(dk, _LN2_HI, dk * _LN2_LO, fused)
    r = f * f * madd(-_THIRD, f, 0.5, fused)
    if k == 0:
        return f - r
    dk = float(k)
    return madd(dk, _LN2_HI, -(madd(-dk, _LN2_LO, r, fused) - f), fused)


def log(x: float, fused: bool = V8_FUSES_MULTIPLY_ADD) -> float:
    """V8's `Math.log` (fdlibm `__ieee754_log`)."""
    hx = _hi(x)
    k = 0
    if hx < 0x00100000:
        if ((hx & 0x7FFFFFFF) | _lo(x)) == 0:
            return -math.inf
        if hx < 0:
            return math.nan
        k -= 54
        x *= _TWO54
        hx = _hi(x)
    if hx >= 0x7FF00000:
        return x + x
    k += (hx >> 20) - 1023
    hx &= 0x000FFFFF
    i = (hx + 0x95F64) & 0x100000
    x = _with_hi(x, hx | (i ^ 0x3FF00000))
    k += i >> 20
    f = x - 1.0
    if (0x000FFFFF & (2 + hx)) < 3:
        return _log_tiny_f(f, k, fused)
    s = f / (2.0 + f)
    dk = float(k)
    z = s * s
    i = hx - 0x6147A
    w = z * z
    j = 0x6B851 - hx
    lg1, lg2, lg3, lg4, lg5, lg6, lg7 = _LG
    t1 = w * madd(w, madd(w, lg6, lg4, fused), lg2, fused)
    t2 = z * madd(w, madd(w, madd(w, lg7, lg5, fused), lg3, fused), lg1, fused)
    i |= j
    r = t2 + t1
    if i > 0:
        hfsq = 0.5 * f * f
        if k == 0:
            return f - madd(-s, hfsq + r, hfsq, fused)
        return madd(dk, _LN2_HI, -((hfsq - madd(s, hfsq + r, dk * _LN2_LO, fused)) - f), fused)
    if k == 0:
        return madd(-s, f - r, f, fused)
    return madd(dk, _LN2_HI, -(madd(s, f - r, -(dk * _LN2_LO), fused) - f), fused)


# --- exp ------------------------------------------------------------------------------------------

_O_THRESHOLD: Final = 7.09782712893383973096e02
_U_THRESHOLD: Final = -7.45133219101941108420e02
_LN2HI: Final = (6.93147180369123816490e-01, -6.93147180369123816490e-01)
_LN2LO: Final = (1.90821492927058770002e-10, -1.90821492927058770002e-10)
_HALF: Final = (0.5, -0.5)
_INVLN2: Final = 1.44269504088896338700e00
_P: Final = (
    1.66666666666666019037e-01,
    -2.77777777770155933842e-03,
    6.61375632143793436117e-05,
    -1.65339022054652515390e-06,
    4.13813679705723846039e-08,
)
_E: Final = 2.718281828459045
_HUGE: Final = 1.0e300
_TWOM1000: Final = 9.33263618503218878990e-302
_TWO1023: Final = 8.988465674311579539e307
_LOWEST_NORMAL_K: Final = -1021
_OVERFLOW_K: Final = 1024


def _exp_reduce(x: float, hx: int, xsb: int, fused: bool) -> tuple[float, float, float, int] | float:
    """The argument reduction: `(x, hi, lo, k)`, or the answer itself when fdlibm has one early."""
    if hx > 0x3FD62E42:
        if hx < 0x3FF0A2B2:
            if x == 1.0:
                return _E
            hi = x - _LN2HI[xsb]
            lo = _LN2LO[xsb]
            k = 1 - xsb - xsb
        else:
            k = _to_int32(madd(_INVLN2, x, _HALF[xsb], fused))
            t = float(k)
            hi = madd(-t, _LN2HI[0], x, fused)
            lo = t * _LN2LO[0]
        return hi - lo, hi, lo, k
    if hx < 0x3E300000 and _HUGE + x > 1.0:
        return 1.0 + x
    return x, 0.0, 0.0, 0


def exp(x: float, fused: bool = V8_FUSES_MULTIPLY_ADD) -> float:
    """V8's `Math.exp` (fdlibm `__ieee754_exp`, with V8's exact `exp(1)`)."""
    hx = _hi(x)
    xsb = (hx >> 31) & 1
    hx &= 0x7FFFFFFF
    if hx >= 0x40862E42:
        if hx >= 0x7FF00000:
            if ((hx & 0xFFFFF) | _lo(x)) != 0:
                return x + x
            return x if xsb == 0 else 0.0
        if x > _O_THRESHOLD:
            return math.inf
        if x < _U_THRESHOLD:
            return 0.0
    reduced = _exp_reduce(x, hx, xsb, fused)
    if isinstance(reduced, float):
        return reduced
    x, hi, lo, k = reduced
    t = x * x
    p1, p2, p3, p4, p5 = _P
    poly = madd(t, madd(t, madd(t, madd(t, p5, p4, fused), p3, fused), p2, fused), p1, fused)
    c = madd(-t, poly, x, fused)
    if k == 0:
        return 1.0 - ((x * c) / (c - 2.0) - x)
    y = 1.0 - ((lo - (x * c) / (2.0 - c)) - hi)
    if k >= _LOWEST_NORMAL_K:
        if k == _OVERFLOW_K:
            return y * 2.0 * _TWO1023
        return y * _from_words(0x3FF00000 + (k << 20), 0)
    return y * _from_words(0x3FF00000 + ((k + 1000) << 20), 0) * _TWOM1000


# --- sin ------------------------------------------------------------------------------------------

_S: Final = (
    -1.66666666666666324348e-01,
    8.33333333332248946124e-03,
    -1.98412698298579493134e-04,
    2.75573137070700676789e-06,
    -2.50507602534068634195e-08,
    1.58969099521155010221e-10,
)
_C: Final = (
    4.16666666666666019037e-02,
    -1.38888888888741095749e-03,
    2.48015872894767294178e-05,
    -2.75573143513906633035e-07,
    2.08757232129817482790e-09,
    -1.13596475577881948265e-11,
)
_INVPIO2: Final = 6.36619772367581382433e-01
_PIO2_1: Final = 1.57079632673412561417e00
_PIO2_1T: Final = 6.07710050650619224932e-11
_PIO2_2: Final = 6.07710050630396597660e-11
_PIO2_2T: Final = 2.02226624879595063154e-21
_PIO2_3: Final = 2.02226624871116645580e-21
_PIO2_3T: Final = 8.47842766036889956997e-32
_REDUCTION_SECOND_PASS_BITS: Final = 16
_REDUCTION_THIRD_PASS_BITS: Final = 49
_THIRD_QUADRANT: Final = 2


def _kernel_sin(x: float, y: float, iy: int, fused: bool) -> float:
    if (_hi(x) & 0x7FFFFFFF) < 0x3E400000 and _to_int32(x) == 0:
        return x
    s1, s2, s3, s4, s5, s6 = _S
    z = x * x
    v = z * x
    r = madd(z, madd(z, madd(z, madd(z, s6, s5, fused), s4, fused), s3, fused), s2, fused)
    if iy == 0:
        return madd(v, madd(z, r, s1, fused), x, fused)
    inner = madd(0.5, y, -(v * r), fused)
    return x - madd(-v, s1, madd(z, inner, -y, fused), fused)


def _kernel_cos(x: float, y: float, fused: bool) -> float:
    ix = _hi(x) & 0x7FFFFFFF
    if ix < 0x3E400000 and _to_int32(x) == 0:
        return 1.0
    c1, c2, c3, c4, c5, c6 = _C
    z = x * x
    r = z * madd(z, madd(z, madd(z, madd(z, madd(z, c6, c5, fused), c4, fused), c3, fused), c2, fused), c1, fused)
    zr_xy = madd(z, r, -(x * y), fused)
    if ix < 0x3FD33333:
        return 1.0 - madd(0.5, z, -zr_xy, fused)
    qx = 0.28125 if ix > 0x3FE90000 else _from_words(ix - 0x00200000, 0)
    hz = madd(0.5, z, -qx, fused)
    a = 1.0 - qx
    return a - (hz - zr_xy)


def _rem_pio2_near(x: float, hx: int, ix: int) -> tuple[int, float, float]:
    """|x| < 3pi/4: one quadrant either way."""
    if hx > 0:
        z = x - _PIO2_1
        if ix != 0x3FF921FB:
            y0 = z - _PIO2_1T
            return 1, y0, (z - y0) - _PIO2_1T
        z -= _PIO2_2
        y0 = z - _PIO2_2T
        return 1, y0, (z - y0) - _PIO2_2T
    z = x + _PIO2_1
    if ix != 0x3FF921FB:
        y0 = z + _PIO2_1T
        return -1, y0, (z - y0) + _PIO2_1T
    z += _PIO2_2
    y0 = z + _PIO2_2T
    return -1, y0, (z - y0) + _PIO2_2T


def _another_pass(t: float, fn: float, part: float, tail: float, fused: bool) -> tuple[float, float, float]:
    w = fn * part
    r = t - w
    w = madd(fn, tail, -((t - r) - w), fused)
    return r, w, r - w


def _rem_pio2(x: float, fused: bool) -> tuple[int, float, float]:
    """`__ieee754_rem_pio2` up to 2^19 * pi/2. fdlibm's `npio2_hw` shortcut skips the exponent test
    below only where that test cannot fire, so the test alone gives the same `y`; beyond the medium
    range (which the model never reaches) the reduction is refused rather than approximated."""
    hx = _hi(x)
    ix = hx & 0x7FFFFFFF
    if ix <= 0x3FE921FB:
        return 0, x, 0.0
    if ix < 0x4002D97C:
        return _rem_pio2_near(x, hx, ix)
    if ix > 0x413921FB:
        raise ValueError(f"sin of {x!r}: fdlibm's large-argument reduction is not ported, and the model never needs it")
    t = abs(x)
    n = _to_int32(madd(t, _INVPIO2, 0.5, fused))
    fn = float(n)
    r = madd(-fn, _PIO2_1, t, fused)
    w = fn * _PIO2_1T
    j = ix >> 20
    y0 = r - w
    if j - ((_hi(y0) >> 20) & 0x7FF) > _REDUCTION_SECOND_PASS_BITS:
        r, w, y0 = _another_pass(r, fn, _PIO2_2, _PIO2_2T, fused)
        if j - ((_hi(y0) >> 20) & 0x7FF) > _REDUCTION_THIRD_PASS_BITS:
            r, w, y0 = _another_pass(r, fn, _PIO2_3, _PIO2_3T, fused)
    y1 = (r - y0) - w
    if hx < 0:
        return -n, -y0, -y1
    return n, y0, y1


def sin(x: float, fused: bool = V8_FUSES_MULTIPLY_ADD) -> float:
    """V8's `Math.sin` (fdlibm `sin`)."""
    ix = _hi(x) & 0x7FFFFFFF
    if ix <= 0x3FE921FB:
        return _kernel_sin(x, 0.0, 0, fused)
    if ix >= 0x7FF00000:
        return x - x
    n, y0, y1 = _rem_pio2(x, fused)
    quadrant = n & 3
    if quadrant == 0:
        return _kernel_sin(y0, y1, 1, fused)
    if quadrant == 1:
        return _kernel_cos(y0, y1, fused)
    if quadrant == _THIRD_QUADRANT:
        return -_kernel_sin(y0, y1, 1, fused)
    return -_kernel_cos(y0, y1, fused)
