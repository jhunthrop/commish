"""THE LAW MEASUREMENT HARNESS: the verdict a stored measurement earns, and the oracle's seeded
draw stream.

Ported from `research-ts/src/projections/laws/harness.ts`, in part. The board reads each law's
measurement as the discovery run stored it (`registry`), so the verdict is all the board needs.
The harness's measuring half (`matchedPairs`, `matchedPairsStratified`, `bootstrapStatistics`,
`measureEffect`) is NOT ported: it serves only the law discovery fit, which is not ported (see the
README's unported fits), and code with neither a caller nor a parity case is not kept. mulberry32
stays because the numerics case proves the oracle's stream against node, the first thing the
discovery port will need. It is reproduced in 32-bit integer arithmetic (`Math.imul`, `>>>`,
`| 0`) so the same seed gives the same stream, draw for draw.
"""

from collections.abc import Callable
from dataclasses import dataclass
from typing import Final, Literal

_MASK: Final = 0xFFFFFFFF


def _int32(value: int) -> int:
    value &= _MASK
    return value - (1 << 32) if value & 0x80000000 else value


def _imul(a: int, b: int) -> int:
    return _int32((a & _MASK) * (b & _MASK))


def _ushr(value: int, bits: int) -> int:
    return (value & _MASK) >> bits


def mulberry32(seed: int) -> Callable[[], float]:
    """`mulberry32(seed)`: a function returning the next draw in [0, 1)."""
    state = seed

    def draw() -> float:
        nonlocal state
        state = _int32(state)
        state = _int32(state + 0x6D2B79F5)
        t = _imul(state ^ _ushr(state, 15), 1 | state)
        t = _int32(_int32(t + _imul(t ^ _ushr(t, 7), 61 | t)) ^ t)
        return _ushr(t ^ _ushr(t, 14), 0) / 4294967296

    return draw


@dataclass(frozen=True, slots=True)
class LawMeasurement:
    effect: float
    ci: tuple[float, float]
    sample: int
    seasons: str


Verdict = Literal["confirmed", "weak", "debunked"]


def _sign(value: float) -> int:
    return (value > 0) - (value < 0)


def verdict_for(measurement: LawMeasurement, expected_sign: int) -> Verdict:
    """`verdictFor`: confirmed when the interval excludes zero on the expected side."""
    low, high = measurement.ci
    ci_excludes_zero = (low > 0) == (high > 0) and low != 0 and high != 0
    sign_matches = _sign(measurement.effect) == expected_sign
    if ci_excludes_zero and sign_matches:
        return "confirmed"
    return "weak" if sign_matches else "debunked"
