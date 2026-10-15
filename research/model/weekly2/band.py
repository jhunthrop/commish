"""THE RANGE AND THE CHANCE: round 1's residual-percentile range on round 2's centre, and the
start-and-sit chance from two ranges.

Preregistration section 2, items 5 and 6. Per position and format, the fit population's residuals
(actual minus x) are cut into quintiles of x (edges at the 20th, 40th, 60th and 80th percentiles of
the fit population's x) and each quintile keeps its 1st to 99th percentiles (numpy linear). Floor
max(0, x + q10), median max(0, x + q50), ceiling max(0, x + q90). The chance A outscores B is the
share of the 99 x 99 pairs of their buckets' percentiles in which max(0, x_A + a) exceeds
max(0, x_B + b), ties counted half; the residuals are taken as independent and both as playing.
"""

import bisect
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from types import MappingProxyType
from typing import Any, Final

import numpy as np

from research.model.weekly2.gates import Thresholds

MIN_BUCKET: Final = 30  # round 1's: a quintile must hold this many player-weeks


class RangeFitError(ValueError):
    """A position and format whose fit population is too thin to cut into quintiles."""


@dataclass(frozen=True, slots=True)
class Bucketed:
    """One position and format: the four quintile edges of x and each quintile's 99 percentiles."""

    edges: tuple[float, ...]
    percentiles: tuple[tuple[float, ...], ...]

    def offsets(self, number: float) -> tuple[float, ...]:
        return self.percentiles[bisect.bisect_right(self.edges, number)]


@dataclass(frozen=True, slots=True)
class Ranges:
    by_cell: Mapping[str, Bucketed]
    band_index: tuple[int, int, int]  # where q10, q50 and q90 sit among the kept percentiles

    def offsets(self, position: str, format_name: str, number: float) -> tuple[float, ...]:
        return self.by_cell[f"{position}|{format_name}"].offsets(number)

    def band(self, position: str, format_name: str, number: float) -> tuple[float, float, float]:
        kept = self.offsets(position, format_name, number)
        low, mid, high = (kept[i] for i in self.band_index)
        return max(0.0, number + low), max(0.0, number + mid), max(0.0, number + high)

    def payload(self) -> dict[str, Any]:
        return {
            key: {"edges": list(cell.edges), "percentiles": [list(row) for row in cell.percentiles]}
            for key, cell in self.by_cell.items()
        }


def _cell(key: str, pairs: Sequence[tuple[float, float]], t: Thresholds) -> Bucketed:
    numbers = np.array([number for number, _ in pairs])
    edges = tuple(float(e) for e in np.percentile(numbers, t.quintile_edges))
    buckets: list[list[float]] = [[] for _ in range(len(edges) + 1)]
    for number, actual in pairs:
        buckets[bisect.bisect_right(edges, number)].append(actual - number)
    if min(len(bucket) for bucket in buckets) < MIN_BUCKET:
        raise RangeFitError(f"{key}: a quintile holds fewer than {MIN_BUCKET} weeks: {[len(b) for b in buckets]}")
    percentiles = tuple(
        tuple(float(v) for v in np.percentile(np.array(bucket), t.residual_percentiles)) for bucket in buckets
    )
    return Bucketed(edges, percentiles)


def fit_ranges(pairs: Mapping[str, Sequence[tuple[float, float]]], t: Thresholds) -> Ranges:
    """Every `position|format` cell from its fit-population (x, actual) pairs."""
    index = tuple(t.residual_percentiles.index(q) for q in t.band_percentiles)
    return Ranges(
        MappingProxyType({key: _cell(key, cell, t) for key, cell in pairs.items()}), (index[0], index[1], index[2])
    )


def chance(number_a: float, offsets_a: Sequence[float], number_b: float, offsets_b: Sequence[float]) -> float:
    """The share of percentile pairs in which A's floored points exceed B's, ties half."""
    a = np.maximum(0.0, number_a + np.asarray(offsets_a, dtype=float))
    b = np.maximum(0.0, number_b + np.asarray(offsets_b, dtype=float))
    difference = np.subtract.outer(a, b)
    return float((np.sum(difference > 0) + 0.5 * np.sum(difference == 0)) / difference.size)
