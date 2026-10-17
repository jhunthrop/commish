# ruff: noqa: PLR2004 - hand-made cases
"""The simulation's fitted constants (2.6): the margin's standard deviation about the spread, the
script effect, the plays' dispersion with its Poisson boundary, the concentrations and the yardage
scale chosen on the grid by the floor and ceiling shares."""

import math

import numpy as np
import pandas as pd
import pytest

from research.model.weekly4.dispersion import (
    SCALE_GRID,
    choose_scale,
    fit_concentration,
    fit_margin,
    fit_plays,
    fit_script,
)


def test_the_scale_grid_is_the_preregistrations() -> None:
    assert SCALE_GRID[0] == 0.5
    assert SCALE_GRID[-1] == 2.0
    assert len(SCALE_GRID) == 31


def test_the_margin_and_the_script() -> None:
    teams = pd.DataFrame({"margin": [10.0, -10.0, 4.0, -4.0], "spread": [3.0, -3.0, 1.0, -1.0]})
    assert fit_margin(teams) == pytest.approx(float(np.std([7.0, -7.0, 3.0, -3.0], ddof=1)))
    teams = teams.assign(
        dropbacks=[30.0, 44.0, 33.0, 37.0],
        plays=[60.0, 60.0, 60.0, 60.0],
        exp_dropbacks=[36.0] * 4,
        exp_plays=[60.0] * 4,
    )
    x = np.array([7.0, -7.0, 3.0, -3.0])
    y = np.array([30.0, 44.0, 33.0, 37.0]) / 60.0 - 0.6
    assert fit_script(teams) == pytest.approx(float(np.sum(x * y) / np.sum(x * x)))


def test_the_plays_dispersion_and_its_poisson_boundary() -> None:
    rng = np.random.default_rng(0)
    mean = np.full(4000, 60.0)
    wide = rng.negative_binomial(20, 20 / 80, 4000).astype(float)
    size, sd = fit_plays(wide, mean)
    assert size is not None and 10 < size < 40
    narrow = np.round(rng.normal(60.0, 3.0, 4000))
    size, sd = fit_plays(narrow, mean)
    assert size is None
    assert sd == pytest.approx(3.0, rel=0.1)


def test_the_concentration_from_the_overdispersion_of_the_counts() -> None:
    rng = np.random.default_rng(1)
    rows = []
    for _ in range(2000):
        n = 35
        p = rng.dirichlet([20 * 0.3, 20 * 0.7])
        c = rng.multinomial(n, p)
        rows.append({"position": "WR", "count": float(c[0]), "volume": float(n), "share": 0.3})
    alpha = fit_concentration(pd.DataFrame(rows))
    assert 12 < alpha["WR"] < 30
    flat = pd.DataFrame({"position": ["TE"] * 3, "count": [3.0, 3.0, 3.0], "volume": [10.0] * 3, "share": [0.3] * 3})
    assert math.isinf(fit_concentration(flat)["TE"])


def test_the_scale_minimises_the_floor_and_ceiling_misses() -> None:
    losses = {0.5: (0.2, 0.2), 1.0: (0.1, 0.11), 1.5: (0.05, 0.04)}

    def shares(scale: float) -> list[tuple[float, float]]:
        return [losses[scale]] * 3

    assert choose_scale(shares, (0.5, 1.0, 1.5)) == 1.0
