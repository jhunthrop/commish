"""THE STATISTICS (design 6.1; Amendment 7 item 8): S1, S2 and S3, per position, over the judged weeks.

- **S1**: Spearman rho per week within the position between a source's values and the realised points,
  pooled as the mean over weeks; a comparison of two sources is the mean over weeks of their per-week
  difference, its lower bound the 2.5th percentile of a week-block bootstrap (10,000 resamples of the
  weeks, numpy's `default_rng(42)`, the resampled weeks shared by every comparison).
- **S2**: the mean realised points of the 12 rows a source ranks first in each week, pooled as the mean
  over weeks.
- **S3**: the shares of realised points below the floor, above the ceiling and below the median; a
  realised value equal to the quantile counts half, since these points are discrete.

Round 4's fill rule: a source with no number for a row ranks it below every row it has, ties averaged.
"""

import warnings
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Final

import numpy as np
import pandas as pd

NO_OPINION: Final = -1.0e9  # below every source's every value (round 4's fill rule)


def _filled(values: np.ndarray) -> np.ndarray:
    return np.where(np.isfinite(values), values, NO_OPINION)


def spearman(values: np.ndarray, actual: np.ndarray) -> float | None:
    """Pearson on average ranks; None with fewer than two rows or a constant side."""
    if len(values) < 2:  # noqa: PLR2004 - a correlation needs two rows
        return None
    a = pd.Series(_filled(np.asarray(values, dtype=float))).rank().to_numpy()
    b = pd.Series(np.asarray(actual, dtype=float)).rank().to_numpy()
    if a.std() == 0 or b.std() == 0:
        return None
    return float(np.corrcoef(a, b)[0, 1])


@dataclass(frozen=True, slots=True)
class WeekRho:
    week: int
    size: int
    rho: Mapping[str, float | None]


def week_rhos(rows: pd.DataFrame, sources: Sequence[str], weeks: Sequence[int]) -> list[WeekRho]:
    """Each judged week's rho per source (`rows` one position's, a column per source and `actual`)."""
    found = []
    for week in weeks:
        w = rows[rows["week"] == week]
        actual = w["actual"].to_numpy(dtype=float)
        found.append(WeekRho(week, len(w), {s: spearman(w[s].to_numpy(dtype=float), actual) for s in sources}))
    return found


def pooled_rho(found: Sequence[WeekRho], source: str) -> float | None:
    values = [o.rho[source] for o in found if o.rho[source] is not None]
    return None if not values else float(np.mean([v for v in values if v is not None]))


def bootstrap_draws(weeks: int, resamples: int, seed: int) -> np.ndarray:
    """The resampled week indices every comparison shares."""
    return np.random.default_rng(seed).integers(0, weeks, size=(resamples, weeks))


@dataclass(frozen=True, slots=True)
class Comparison:
    """A pooled difference over the weeks where both sources answer, with its bootstrap lower bound."""

    value: float | None
    lower_bound: float | None
    weeks: int


def compare(found: Sequence[WeekRho], source: str, bench: str, draws: np.ndarray, percentile: float) -> Comparison:
    deltas = np.full(len(found), np.nan)
    for i, o in enumerate(found):
        model, other = o.rho[source], o.rho[bench]
        if model is not None and other is not None:
            deltas[i] = model - other
    usable = int(np.sum(np.isfinite(deltas)))
    if usable == 0:
        return Comparison(None, None, 0)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", RuntimeWarning)  # a resample of weeks with no answer has no mean
        boot = np.nanmean(deltas[draws], axis=1)
    boot = boot[np.isfinite(boot)]
    return Comparison(float(np.nanmean(deltas)), float(np.percentile(boot, percentile)), usable)


def starters_points(rows: pd.DataFrame, source: str, weeks: Sequence[int], starters: int) -> float | None:
    """S2: the mean realised points of the source's first `starters` rows each week, pooled over weeks
    (ties broken by the row's id so the pick is fixed)."""
    means = []
    for week in weeks:
        w = rows[rows["week"] == week].assign(_value=lambda f: _filled(f[source].to_numpy(dtype=float)))
        if w.empty:
            continue
        picked = w.sort_values(["_value", "unit"], ascending=[False, True]).head(starters)
        means.append(float(picked["actual"].mean()))
    return None if not means else float(np.mean(means))


@dataclass(frozen=True, slots=True)
class RangeShares:
    below_floor: float | None
    above_ceiling: float | None
    below_median: float | None
    size: int


def range_shares(actual: np.ndarray, floor: np.ndarray, median: np.ndarray, ceiling: np.ndarray) -> RangeShares:
    """S3, a value equal to its quantile counting half."""
    a = np.asarray(actual, dtype=float)
    if len(a) == 0:
        return RangeShares(None, None, None, 0)

    def share(below: np.ndarray, at: np.ndarray) -> float:
        return float(np.mean(below.astype(float) + 0.5 * at.astype(float)))

    return RangeShares(
        share(a < floor, a == floor), share(a > ceiling, a == ceiling), share(a < median, a == median), len(a)
    )
