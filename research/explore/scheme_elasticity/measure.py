"""THE METRIC OF PLAN SECTION 4 (round 4's, by its own functions) AND THE RANGE OF SECTION 6.

Rho per (week, position) through `weekly4.scoring.orderings`, pooled and bootstrapped through round
2's `rho_deltas` and `ordering_difference` with round 4's statistics (10,000 resamples,
`default_rng(42)`, the 1.667th percentile). Week keys are season x 100 + week.
"""

import warnings
from collections.abc import Mapping, Sequence
from typing import Any, Final

import numpy as np

from research.explore.scheme_elasticity.baseline import BaseRow, Points
from research.model.weekly2.gates import Thresholds
from research.model.weekly2.statistics import (
    WeekOrdering,
    bootstrap_draws,
    ordering_difference,
    places_mean,
    rho_deltas,
)
from research.model.weekly4.gates import DEVELOPMENT_CHECK
from research.model.weekly4.play_model import FORMAT_NAMES
from research.model.weekly4.scoring import Row, orderings

STATISTICS: Final[Thresholds] = DEVELOPMENT_CHECK.statistics
POSITIONS: Final = ("QB", "RB", "WR", "TE")
QUINTILES: Final = (20.0, 40.0, 60.0, 80.0)
BAND: Final = (10.0, 50.0, 90.0)
Key = tuple[int, int, str]


def week_key(season: int, week: int) -> int:
    return season * 100 + week


def scored_rows(base: Sequence[BaseRow], sources: Mapping[str, Mapping[Key, Points | None]]) -> list[Row]:
    return [
        Row(
            week_key(r.season, r.week),
            r.player_id,
            r.position,
            r.actual,
            {name: found.get((r.season, r.week, r.player_id)) for name, found in sources.items()},
            r.adp,
        )
        for r in base
    ]


def week_orderings(
    rows: Sequence[Row], weeks: Sequence[int], sources: Sequence[str], name: str = "ppr"
) -> list[WeekOrdering]:
    return orderings(rows, weeks, name, STATISTICS, sources)


def difference(found: Sequence[WeekOrdering], weeks: Sequence[int], source: str, bench: str) -> dict[str, Any]:
    """`source` minus `bench`: pooled (mean over weeks of the four-position mean) with its 1.667th
    percentile bound, and each position's mean over weeks."""
    draws = bootstrap_draws(len(weeks), STATISTICS)
    deltas = rho_deltas(found, bench, weeks, source)
    result = ordering_difference(deltas, draws, STATISTICS)
    return {
        "pooled": result.pooled.value,
        "lower_bound": result.pooled.lower_bound,
        "weeks": result.pooled.weeks,
        "by_position": dict(result.by_position),
        "position_lower_bound": {p: position_bound(deltas[p], draws) for p in POSITIONS},
    }


def position_bound(deltas: Sequence[float | None], draws: np.ndarray) -> float | None:
    """One position's mean weekly difference, bootstrapped on the same week draws (reported)."""
    cells = np.array([np.nan if d is None else d for d in deltas], dtype=float)
    if np.all(np.isnan(cells)):
        return None
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", RuntimeWarning)
        boot = np.nanmean(cells[draws], axis=1)
    boot = boot[~np.isnan(boot)]
    return float(np.percentile(boot, STATISTICS.lower_percentile))


def mean_rho(found: Sequence[WeekOrdering], source: str) -> dict[str, float | None]:
    out: dict[str, float | None] = {}
    for position in POSITIONS:
        values = [o.rho[source] for o in found if o.position == position and o.rho.get(source) is not None]
        out[position] = None if not values else float(np.mean([v for v in values if v is not None]))
    return out


def places(found: Sequence[WeekOrdering], source: str) -> float | None:
    return places_mean(found, source)


def _band_fit(x: np.ndarray, residual: np.ndarray) -> tuple[np.ndarray, list[np.ndarray]]:
    edges = np.percentile(x, QUINTILES)
    bucket = np.searchsorted(edges, x, side="right")
    cuts = [np.percentile(residual[bucket == b], BAND) if np.any(bucket == b) else np.zeros(3) for b in range(5)]
    return edges, cuts


def calibration(rows: Sequence[Row], source: str, fit_season: int, measure_season: int) -> dict[str, dict[str, Any]]:
    """The residual range of rounds 2 and 3, fitted on one season's rows and measured on the other's:
    per position and format, shares below the floor, above the ceiling and below the median."""
    found: dict[str, dict[str, Any]] = {}
    for position in POSITIONS:
        for name in FORMAT_NAMES:

            def pairs(season: int, name: str = name, position: str = position) -> tuple[np.ndarray, np.ndarray]:
                xs: list[float] = []
                ys: list[float] = []
                for r in rows:
                    number = r.sources.get(source)
                    if r.position == position and r.week // 100 == season and number is not None:
                        xs.append(float(number[name]))
                        ys.append(float(r.actual[name]))
                return np.array(xs), np.array(ys)

            fx, fy = pairs(fit_season)
            mx, my = pairs(measure_season)
            if len(fx) < len(QUINTILES) + 1 or len(mx) == 0:
                continue
            edges, cuts = _band_fit(fx, fy - fx)
            q = np.array([cuts[b] for b in np.searchsorted(edges, mx, side="right")])
            floor, median, ceiling = (np.maximum(0.0, mx + q[:, i]) for i in range(3))
            found[f"{position}|{name}"] = {
                "n": len(mx),
                "below_floor": float(np.mean(my < floor)),
                "above_ceiling": float(np.mean(my > ceiling)),
                "below_median": float(np.mean(my < median)),
            }
    return found
