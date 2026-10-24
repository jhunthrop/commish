"""THE RANGE AND THE CHANCE, FROM RESIDUALS (preregistration 2.9).

Band-fit rows are every lined row of weeks 4 to 17 of the band seasons of a player who gets a number,
scored out of sample for the trees. Within each position and format, five point bands at the quintiles of
the point over those rows (edges at the 20th, 40th, 60th and 80th percentiles, a point on an edge in the
upper band); a row takes the band of its own point. Floor, median and ceiling are the point plus the
10th, 50th and 90th percentiles of his band's residuals (numpy's linear interpolation), no clipping. The
chance of beating x is the share of his band's residuals r with point + r > x, ties half; the start-and-sit
chance for A and B the share of all pairs (r_A, r_B) with point_A + r_A > point_B + r_B, ties half, the two
taken as independent. A player on the rate-m rule takes his position's bottom band.

The fit refuses a row outside the band seasons (`shrinkage.WindowError`).
"""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from types import MappingProxyType
from typing import Final

import numpy as np
import pandas as pd

from research.model.weekly.round.scoring import FORMATS
from research.model.weekly5.shrinkage import check_window

FROZEN: Final = MappingProxyType
EDGES: Final = (20.0, 40.0, 60.0, 80.0)
BANDS: Final = len(EDGES) + 1
PERCENTILES: Final = (10.0, 50.0, 90.0)
BOTTOM: Final = 0


@dataclass(frozen=True, slots=True)
class Bands:
    """Per (position, format): the band edges and each band's sorted residuals."""

    seasons: tuple[int, ...]
    edges: Mapping[tuple[str, str], tuple[float, ...]]
    residuals: Mapping[tuple[str, str, int], np.ndarray]

    def band(self, position: str, name: str, point: float, rate_only: bool = False) -> int:
        if rate_only:
            return BOTTOM
        # A point on an edge belongs to the upper band.
        return int(np.searchsorted(np.asarray(self.edges[(position, name)]), point, side="right"))

    def of(self, position: str, name: str, point: float, rate_only: bool = False) -> np.ndarray:
        return self.residuals[(position, name, self.band(position, name, point, rate_only))]


def fit_bands(rows: pd.DataFrame, seasons: Sequence[int]) -> Bands:
    """The band-fit rows (`position`, `rate_only`, `point_<format>`, `actual_<format>`) of `seasons`."""
    check_window(rows["season"].unique(), seasons, "residual band")
    edges: dict[tuple[str, str], tuple[float, ...]] = {}
    residuals: dict[tuple[str, str, int], np.ndarray] = {}
    for position, mine in rows.groupby("position"):
        p = str(position)
        for name in FORMATS:
            point = mine[f"point_{name}"].to_numpy(dtype=float)
            residual = mine[f"actual_{name}"].to_numpy(dtype=float) - point
            found = tuple(float(e) for e in np.percentile(point, EDGES)) if len(point) else (0.0,) * len(EDGES)
            edges[(p, name)] = found
            band = np.searchsorted(np.asarray(found), point, side="right")
            for b in range(BANDS):
                residuals[(p, name, b)] = np.sort(residual[band == b])
    return Bands(tuple(seasons), FROZEN(edges), FROZEN(residuals))


def band_of(bands: Bands, position: str, name: str, point: float, rate_only: bool) -> tuple[float, float, float]:
    """Floor, median and ceiling: the point plus his band's 10th, 50th and 90th residual percentiles."""
    found = bands.of(position, name, point, rate_only)
    if len(found) == 0:
        nan = float("nan")
        return nan, nan, nan
    low, mid, high = np.percentile(found, PERCENTILES)
    return float(point + low), float(point + mid), float(point + high)


def beats(residuals: np.ndarray, point: float, x: float) -> float:
    """The chance of beating x: the share of residuals with point + r > x, ties half."""
    if len(residuals) == 0:
        return float("nan")
    above = len(residuals) - np.searchsorted(residuals, x - point, side="right")
    ties = np.searchsorted(residuals, x - point, side="right") - np.searchsorted(residuals, x - point, side="left")
    return float((above + 0.5 * ties) / len(residuals))


def start_over(a: np.ndarray, point_a: float, b: np.ndarray, point_b: float) -> float:
    """The start-and-sit chance: the share of all pairs (r_a, r_b) with point_a + r_a > point_b + r_b, ties
    half, the two independent. `b` sorted."""
    if len(a) == 0 or len(b) == 0:
        return float("nan")
    shifted = point_a + a - point_b  # r_b below this wins for a
    below = np.searchsorted(b, shifted, side="left")
    ties = np.searchsorted(b, shifted, side="right") - below
    return float((below.sum() + 0.5 * ties.sum()) / (len(a) * len(b)))


def payload(bands: Bands) -> dict[str, object]:
    """3.2, reported: the bands' edges and each band's residual quantiles and size."""
    return {
        "seasons": list(bands.seasons),
        "edges": {f"{p}|{n}": list(e) for (p, n), e in bands.edges.items()},
        "quantiles": {
            f"{p}|{n}|{b}": {
                "n": len(r),
                **(
                    {}
                    if not len(r)
                    else dict(zip(("q10", "q50", "q90"), map(float, np.percentile(r, PERCENTILES)), strict=True))
                ),
            }
            for (p, n, b), r in bands.residuals.items()
        },
    }
