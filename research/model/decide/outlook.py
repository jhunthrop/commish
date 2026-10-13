"""FLOOR AND CEILING, AND WHERE THEY ARE ALLOWED TO COME FROM.

Ported from `research-ts/src/projections/decide/outlook.ts`. The decision layer takes a
distribution as an argument and never manufactures one; `realized_dispersion` reads outcomes (the
spread of what a player has already done), never projections.
"""

import math
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Final

from research.model.decide.normal import Z_NINETIETH
from research.model.jsmath import js_pow

MIN_WEEKS_FOR_DISPERSION: Final = 4


@dataclass(frozen=True, slots=True)
class ProjectionDistribution:
    """A projection's shape at fixed quantiles: the tenth, the fiftieth and the ninetieth."""

    floor: float
    median: float
    ceiling: float


def _assert_ordered(distribution: ProjectionDistribution) -> None:
    if not (distribution.floor <= distribution.median <= distribution.ceiling):
        raise ValueError(
            f"A distribution runs floor to ceiling; got {distribution.floor}, {distribution.median}, {distribution.ceiling}."
        )


def standard_deviation_of(distribution: ProjectionDistribution) -> float:
    """`standardDeviationOf`: the spread implied by the ninety-to-ten span on the normal assumption."""
    _assert_ordered(distribution)
    return (distribution.ceiling - distribution.floor) / (2 * Z_NINETIETH)


def outlook_around(median: float, standard_deviation: float) -> ProjectionDistribution:
    """`outlookAround`: a symmetric distribution around a mean the caller already has."""
    if not (standard_deviation >= 0) or not math.isfinite(standard_deviation):
        raise ValueError(f"An outlook needs a finite, non-negative spread; got {standard_deviation}.")
    return ProjectionDistribution(
        median - Z_NINETIETH * standard_deviation, median, median + Z_NINETIETH * standard_deviation
    )


def realized_dispersion(weekly_points: Sequence[float]) -> float | None:
    """`realizedDispersion`: the sample standard deviation of weekly scores, None under four weeks."""
    if len(weekly_points) < MIN_WEEKS_FOR_DISPERSION:
        return None
    if any(not math.isfinite(points) for points in weekly_points):
        raise ValueError("A realized dispersion was handed a non-finite weekly score.")
    total = 0.0
    for points in weekly_points:
        total += points
    mean = total / len(weekly_points)
    squares = 0.0
    for points in weekly_points:
        squares += js_pow(points - mean, 2)
    return math.sqrt(squares / (len(weekly_points) - 1))
