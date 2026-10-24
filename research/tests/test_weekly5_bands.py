# ruff: noqa: PLR2004 - hand-computed bands and chances
"""Round 5's range and chance (Lane 168; preregistration 2.9): quintile bands within position and format with a
point on an edge in the upper band, the residual percentiles by numpy's default interpolation and no clipping,
the chance of beating a number and the start-and-sit chance with ties half (checked against every pair), the
rate-m rows on the bottom band, and the fit's refusal of a row outside its seasons (guard 4)."""

from itertools import product

import numpy as np
import pandas as pd
import pytest

from research.model.weekly5.bands import BOTTOM, band_of, beats, fit_bands, start_over
from research.model.weekly5.shrinkage import WindowError


def rows(points: list[float], actual: list[float], season: int = 2022, position: str = "WR") -> pd.DataFrame:
    return pd.DataFrame(
        {
            "season": season,
            "position": position,
            **{f"point_{n}": points for n in ("ppr", "half", "std")},
            **{f"actual_{n}": actual for n in ("ppr", "half", "std")},
        }
    )


def test_quintile_edges_and_a_point_on_an_edge_goes_up() -> None:
    points = [float(p) for p in range(1, 11)]
    bands = fit_bands(rows(points, [p + 1.0 for p in points]), (2022,))
    edges = bands.edges[("WR", "ppr")]
    assert edges == pytest.approx(tuple(np.percentile(points, (20, 40, 60, 80))))
    assert bands.band("WR", "ppr", edges[0]) == 1
    assert bands.band("WR", "ppr", edges[0] - 1e-9) == 0
    assert bands.band("WR", "ppr", 100.0) == 4
    assert bands.band("WR", "ppr", 100.0, rate_only=True) == BOTTOM


def test_floor_median_and_ceiling_are_the_residual_percentiles_unclipped() -> None:
    residuals = [-30.0, -2.0, 0.0, 1.0, 5.0]
    bands = fit_bands(rows([1.0] * 5, [1.0 + r for r in residuals]), (2022,))
    floor, median, ceiling = band_of(bands, "WR", "ppr", 2.0, rate_only=False)
    low, mid, high = np.percentile(residuals, (10, 50, 90))
    assert (floor, median, ceiling) == pytest.approx((2.0 + low, 2.0 + mid, 2.0 + high))
    assert floor < 0  # no clipping


def test_the_chance_of_beating_a_number_counts_ties_half() -> None:
    residuals = np.sort(np.array([-1.0, 0.0, 0.0, 2.0]))
    assert beats(residuals, 10.0, 10.0) == pytest.approx((1 + 0.5 * 2) / 4)
    assert beats(residuals, 10.0, 20.0) == 0.0


def test_start_over_equals_the_share_of_every_pair() -> None:
    rng = np.random.default_rng(5)
    a = np.sort(rng.integers(-5, 5, size=30).astype(float))
    b = np.sort(rng.integers(-5, 5, size=20).astype(float))
    wins = [1.0 if x + 3.0 > y + 2.0 else 0.5 if x + 3.0 == y + 2.0 else 0.0 for x, y in product(a, b)]
    assert start_over(a, 3.0, b, 2.0) == pytest.approx(float(np.mean(wins)))
    assert start_over(a, 3.0, b, 2.0) + start_over(b, 2.0, a, 3.0) == pytest.approx(1.0)


def test_guard_four_the_band_fit_refuses_a_season_outside_its_window() -> None:
    with pytest.raises(WindowError):
        fit_bands(rows([1.0, 2.0], [1.0, 2.0], season=2023), (2022,))
    with pytest.raises(WindowError):
        fit_bands(rows([1.0, 2.0], [1.0, 2.0], season=2025), (2025,))
