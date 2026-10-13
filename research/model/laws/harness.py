"""THE LAW MEASUREMENT HARNESS: matched pairs, a seeded bootstrap, and the verdict.

Ported from `research-ts/src/projections/laws/harness.ts`. The bootstrap draws from mulberry32,
reproduced here in 32-bit integer arithmetic (`Math.imul`, `>>>`, `| 0`) so the same seed gives
the same stream, draw for draw; the `fdlibm` parity case proves the stream against node.
"""

import math
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from typing import Final, Literal

from research.model.jsmath import js_pow
from research.model.laws.tribal_facts import PlayerSeasonPoint

BOOTSTRAP_RESAMPLES: Final = 1000
BOOTSTRAP_SEED: Final = 20260831
_MASK: Final = 0xFFFFFFFF
_LOWER_TAIL: Final = 0.025
_UPPER_TAIL: Final = 0.975


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
class MatchedPair:
    condition: PlayerSeasonPoint
    control: PlayerSeasonPoint


def matched_pairs(points: Sequence[PlayerSeasonPoint], caliper: float) -> list[MatchedPair]:
    """`matchedPairs`: greedy nearest-match without replacement, highest match key first."""
    returners = [point for point in points if point.next_points_per_game is not None]
    conditions = sorted((point for point in returners if point.condition), key=lambda point: -point.match_key)
    pool = [point for point in returners if not point.condition]
    claimed: set[int] = set()
    pairs: list[MatchedPair] = []
    for condition in conditions:
        best_index = -1
        best_distance = math.inf
        for index, control in enumerate(pool):
            if index in claimed:
                continue
            distance = abs(control.match_key - condition.match_key)
            if distance <= caliper and distance < best_distance:
                best_distance = distance
                best_index = index
        if best_index != -1:
            claimed.add(best_index)
            pairs.append(MatchedPair(condition, pool[best_index]))
    return pairs


def matched_pairs_stratified(
    points: Sequence[PlayerSeasonPoint], caliper: float, key_of: Callable[[PlayerSeasonPoint], str]
) -> list[MatchedPair]:
    """`matchedPairsStratified`: matched within each stratum, strata in first-seen order."""
    strata: dict[str, list[PlayerSeasonPoint]] = {}
    for point in points:
        strata.setdefault(key_of(point), []).append(point)
    return [pair for stratum in strata.values() for pair in matched_pairs(stratum, caliper)]


def _difference(pair: MatchedPair) -> float:
    condition = pair.condition
    control = pair.control
    return (float(condition.next_points_per_game or 0) - condition.points_per_game) - (
        float(control.next_points_per_game or 0) - control.points_per_game
    )


def _mean(values: Sequence[float]) -> float:
    total = 0.0
    for value in values:
        total += value
    return total / len(values)


def _percentile(ordered: Sequence[float], p: float) -> float:
    if len(ordered) == 1:
        return ordered[0]
    rank = p * (len(ordered) - 1)
    lower = math.floor(rank)
    upper = math.ceil(rank)
    if lower == upper:
        return ordered[lower]
    weight = rank - lower
    return ordered[lower] * (1 - weight) + ordered[upper] * weight


def _standard_deviation(values: Sequence[float]) -> float:
    m = _mean(values)
    total = 0.0
    for value in values:
        total += js_pow(value - m, 2)
    return math.sqrt(total / len(values))


@dataclass(frozen=True, slots=True)
class LawMeasurement:
    effect: float
    ci: tuple[float, float]
    sample: int
    seasons: str


def bootstrap_statistics(pairs: Sequence[MatchedPair]) -> tuple[float, float, tuple[float, float]]:
    """`bootstrapStatistics`: (effect, se, 95% interval)."""
    if not pairs:
        raise ValueError(
            "bootstrapStatistics: no matched pairs — an empty matched population is a population-builder bug, never a verdict"
        )
    differences = [_difference(pair) for pair in pairs]
    effect = _mean(differences)
    draw = mulberry32(BOOTSTRAP_SEED)
    means: list[float] = []
    for _ in range(BOOTSTRAP_RESAMPLES):
        total = 0.0
        for _ in range(len(pairs)):
            total += differences[math.floor(draw() * len(pairs))]
        means.append(total / len(pairs))
    ordered = sorted(means)
    return effect, _standard_deviation(means), (_percentile(ordered, _LOWER_TAIL), _percentile(ordered, _UPPER_TAIL))


def measure_effect(pairs: Sequence[MatchedPair]) -> LawMeasurement:
    """`measureEffect`."""
    effect, _, ci = bootstrap_statistics(pairs)
    return LawMeasurement(effect, ci, len(pairs), "")


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
