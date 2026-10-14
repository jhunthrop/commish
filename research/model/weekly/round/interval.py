"""THE WEEKLY INTERVAL: floor, median and ceiling from the model's own residuals on the fit seasons.

Per position and format, the fit seasons' scored player-weeks (projected, and the player recorded a
line) are cut into quintiles of projected points; within each quintile the 10th, 50th and 90th
percentiles of (actual minus projected) are kept (numpy's linear interpolation). A projection takes
its quintile's three offsets: floor max(0, p + q10), median max(0, p + q50), ceiling max(0, p + q90).
The numbers describe a week the player plays.
"""

import bisect
from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from typing import Any, Final

import numpy as np

from research.model.weekly.round.scoring import FORMATS, SKILL_POSITIONS, ScoredRow

EDGE_PERCENTILES: Final = (20.0, 40.0, 60.0, 80.0)
BAND_PERCENTILES: Final = (10.0, 50.0, 90.0)
MIN_BUCKET: Final = 30


class IntervalFitError(ValueError):
    """A position and format whose fit seasons hold too few scored weeks to cut into quintiles."""


@dataclass(frozen=True, slots=True)
class Bucketed:
    """One position and format: the four quintile edges and each quintile's three offsets."""

    edges: tuple[float, ...]
    offsets: tuple[tuple[float, float, float], ...]

    def band(self, projected: float) -> tuple[float, float, float]:
        low, mid, high = self.offsets[bisect.bisect_right(self.edges, projected)]
        return max(0.0, projected + low), max(0.0, projected + mid), max(0.0, projected + high)


@dataclass(frozen=True, slots=True)
class WeeklyInterval:
    by_cell: Mapping[str, Bucketed]

    def band(self, position: str, format_name: str, projected: float) -> tuple[float, float, float]:
        return self.by_cell[f"{position}|{format_name}"].band(projected)

    def payload(self) -> dict[str, Any]:
        return {
            key: {"edges": list(cell.edges), "offsets": [list(o) for o in cell.offsets]}
            for key, cell in self.by_cell.items()
        }


def interval_from(payload: Mapping[str, Any]) -> WeeklyInterval:
    return WeeklyInterval(
        {
            key: Bucketed(
                tuple(float(edge) for edge in cell["edges"]),
                tuple((float(o[0]), float(o[1]), float(o[2])) for o in cell["offsets"]),
            )
            for key, cell in payload.items()
        }
    )


def _cell(pairs: list[tuple[float, float]]) -> Bucketed:
    projected = np.array([p for p, _ in pairs])
    edges = tuple(float(e) for e in np.percentile(projected, EDGE_PERCENTILES))
    buckets: list[list[float]] = [[] for _ in range(len(edges) + 1)]
    for predicted, actual in pairs:
        buckets[bisect.bisect_right(edges, predicted)].append(actual - predicted)
    if min(len(bucket) for bucket in buckets) < MIN_BUCKET:
        raise IntervalFitError(f"a quintile holds fewer than {MIN_BUCKET} weeks: {[len(b) for b in buckets]}")
    offsets = tuple(
        (float(q[0]), float(q[1]), float(q[2])) for q in (np.percentile(np.array(b), BAND_PERCENTILES) for b in buckets)
    )
    return Bucketed(edges, offsets)


def fit_interval(rows: Iterable[ScoredRow]) -> WeeklyInterval:
    """The quintile offsets of every position and format, from scored fit-season rows."""
    pairs: dict[str, list[tuple[float, float]]] = {
        f"{position}|{name}": [] for position in SKILL_POSITIONS for name in FORMATS
    }
    for row in rows:
        if row.actual is None:
            continue
        for name in FORMATS:
            pairs[f"{row.position}|{name}"].append((row.projected[name], row.actual[name]))
    return WeeklyInterval({key: _cell(cell) for key, cell in pairs.items()})
