"""THE NUMBER SEMANTICS THE ORACLE RUNS ON: V8's `Math` and the JavaScript operators the model uses.

Every float operation the TypeScript performs is IEEE 754 double arithmetic, and Python's `+`,
`-`, `*`, `/` and `math.sqrt` are the same operations, so they port as written. What does not port
as written:

- `Math.log`, `Math.exp`, `Math.sin`: V8's fdlibm, not the platform's libm (`fdlibm.py`).
- `**` and `Math.pow`: the platform's libm `pow`, except that V8 answers `x ** 2` with `x * x` and
  `x ** 0.5` with `sqrt(x)`, which libm does not round the same way (proven on 100,000 inputs per
  exponent by the `fdlibm` parity case), and that `(+-1) ** (+-Infinity)` is NaN.
- `Math.round`: half toward +Infinity, computed without the `floor(x + 0.5)` double rounding.
- `Math.max`/`Math.min` of nothing: -Infinity/Infinity, and NaN wins.
- A sum: a left fold (`js_sum`), never Python's compensated `sum`.
"""

import functools
import math
from collections.abc import Callable, Iterable, Sequence
from decimal import ROUND_HALF_UP, Decimal
from typing import Final

from research.model.fdlibm import exp, log, sin
from research.pipeline.jscompat import js_locale_compare, js_string, js_sum

__all__ = [
    "exp",
    "js_max",
    "js_min",
    "js_pow",
    "js_round",
    "js_sorted",
    "js_sum",
    "js_to_fixed",
    "locale_compare",
    "log",
    "sin",
]

_SQUARE: Final = 2.0
_TO_FIXED_LIMIT: Final = 1e21
_ROOT: Final = 0.5


def js_pow(x: float, y: float) -> float:  # noqa: PLR0911 - one return per ECMAScript special case
    """`x ** y` as V8 computes it."""
    if math.isnan(y):
        return math.nan
    if y == 0:
        return 1.0
    if math.isnan(x) or (math.isinf(y) and abs(x) == 1.0):
        return math.nan
    if y == _SQUARE:
        return x * x
    if y == _ROOT and not math.isinf(x):
        return 0.0 if x == 0 else (math.sqrt(x) if x > 0 else math.nan)
    try:
        return math.pow(x, y)
    except OverflowError:
        odd = y == math.floor(y) and math.fmod(y, 2.0) != 0
        return -math.inf if (x < 0 and odd) else math.inf
    except ValueError:
        if x == 0:
            odd = y == math.floor(y) and math.fmod(y, 2.0) != 0
            return -math.inf if (math.copysign(1.0, x) < 0 and odd) else math.inf
        return math.nan


def js_round(x: float) -> float:
    """`Math.round`: the nearest integer, a tie toward +Infinity, exactly as V8 rounds it."""
    if not math.isfinite(x):
        return x
    ceiling = float(math.ceil(x))
    rounded = ceiling - 1.0 if ceiling - 0.5 > x else ceiling
    # A value in [-0.5, 0) rounds to negative zero, as V8 keeps the sign.
    return math.copysign(0.0, x) if rounded == 0 else rounded


def js_max(*values: float) -> float:
    """`Math.max(...values)`."""
    result = -math.inf
    for value in values:
        if math.isnan(value):
            return math.nan
        # Math.max(-0, 0) is +0: a zero beats a negative zero.
        if value > result or (value == 0 and result == 0 and math.copysign(1.0, result) < 0):
            result = value
    return result


def js_min(*values: float) -> float:
    """`Math.min(...values)`."""
    result = math.inf
    for value in values:
        if math.isnan(value):
            return math.nan
        # Math.min(0, -0) is -0: a negative zero beats a zero.
        if value < result or (value == 0 and result == 0 and math.copysign(1.0, value) < 0):
            result = value
    return result


def js_or(value: float, fallback: Callable[[], float]) -> float:
    """`value || fallback()` for a number: 0, -0 and NaN fall through, as JavaScript's `||` does
    (Python's `or` keeps a NaN, which is truthy there)."""
    return fallback() if value == 0 or math.isnan(value) else value


def locale_compare(left: str, right: str) -> int:
    """`left.localeCompare(right)` (phase A's verified collation)."""
    return js_locale_compare(left, right)


def js_sorted[T](items: Iterable[T], compare: Callable[[T, T], float]) -> list[T]:
    """`[...items].sort(compare)`: V8's TimSort is stable, and so is Python's, so with the same
    comparator the same order comes out. A NaN or a zero both keep the original order."""

    def normalised(left: T, right: T) -> int:
        result = compare(left, right)
        if result > 0:
            return 1
        if result < 0:
            return -1
        return 0

    return sorted(items, key=functools.cmp_to_key(normalised))


def fold(values: Sequence[float]) -> float:
    """A left fold from 0, the shape of every `reduce((sum, x) => sum + x, 0)` in the oracle."""
    return js_sum(values)


def js_to_fixed(x: float, digits: int) -> str:
    """`x.toFixed(digits)`: the exact binary value rounded half away from zero (the nearest n, the
    larger on a tie, of the magnitude), the sign kept even when the digits round to zero
    (`(-0.04).toFixed(1)` is "-0.0"). Python's `format` rounds the exact value half to even."""
    if not math.isfinite(x) or abs(x) >= _TO_FIXED_LIMIT:
        return js_string(x)
    sign = "-" if x < 0 else ""
    magnitude = abs(Decimal(x)).quantize(Decimal(1).scaleb(-digits), rounding=ROUND_HALF_UP)
    return f"{sign}{magnitude:f}"
