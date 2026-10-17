"""THE SIMULATION'S FITTED CONSTANTS (preregistration section 2.6), on the fit rows: the 2022 and 2023
rows for the judgment, 2022 alone for the development check, each row's component outputs from the
forward-chained models.

- the margin's standard deviation of (margin less closing spread),
- the script effect, a separate fitted line through the origin: how a realised margin above or below
  the spread moves the realised pass rate (realised less the team model's),
- the plays' negative binomial size by the method of moments on the team model's residuals, or at the
  Poisson boundary (fitted variance at or below the mean) the Normal fallback's residual standard
  deviation,
- one Dirichlet concentration per position and kind from the counts' overdispersion about
  volume times share: var = N p (1 - p) (N + alpha) / (1 + alpha), infinite at no overdispersion,
- each kind's yards standard deviation per opportunity about the play model's expectation,
- one yardage-variance scale per position from the grid 0.50 to 2.00 by 0.05, minimising over the three
  formats the sum of (share below the floor less 0.10)^2 plus (share above the ceiling less 0.10)^2.
"""

import math
from collections.abc import Callable, Mapping, Sequence
from typing import Final

import numpy as np
import pandas as pd

SCALE_GRID: Final = tuple(round(0.5 + 0.05 * i, 2) for i in range(31))
TARGET_SHARE: Final = 0.10  # 2.6: "(share below the floor less 0.10)^2 plus (share above the ceiling less 0.10)^2"
_MINIMUM_CONCENTRATION: Final = 1e-3


def fit_margin(teams: pd.DataFrame) -> float:
    """The standard deviation of the realised margin less the closing spread."""
    gap = teams["margin"].to_numpy(dtype=float) - teams["spread"].to_numpy(dtype=float)
    return float(np.std(gap[np.isfinite(gap)], ddof=1))


def fit_script(teams: pd.DataFrame) -> float:
    """The realised pass rate less the team model's, per point of margin over the spread."""
    x = teams["margin"].to_numpy(dtype=float) - teams["spread"].to_numpy(dtype=float)
    plays = teams["plays"].to_numpy(dtype=float)
    realised = teams["dropbacks"].to_numpy(dtype=float) / np.maximum(plays, 1.0)
    expected = teams["exp_dropbacks"].to_numpy(dtype=float) / np.maximum(teams["exp_plays"].to_numpy(dtype=float), 1e-9)
    y = realised - expected
    kept = np.isfinite(x) & np.isfinite(y) & (plays > 0)
    return float(np.sum(x[kept] * y[kept]) / np.sum(x[kept] ** 2))


def fit_plays(plays: np.ndarray, mean: np.ndarray) -> tuple[float | None, float]:
    """(the negative binomial's size, or None at the Poisson boundary; the residual standard deviation)."""
    residual = plays - mean
    sd = float(np.sqrt(np.mean(residual**2)))
    excess = float(np.sum(residual**2 - mean))
    if excess <= 0:
        return None, sd
    return float(np.sum(mean**2) / excess), sd


def fit_concentration(rows: pd.DataFrame) -> dict[str, float]:
    """Per position: alpha from rho = sum (c - N p)^2 / sum N p (1 - p) and the weighted mean N."""
    found: dict[str, float] = {}
    for position, group in rows.groupby("position"):
        n = group["volume"].to_numpy(dtype=float)
        p = group["share"].to_numpy(dtype=float)
        c = group["count"].to_numpy(dtype=float)
        binomial = n * p * (1.0 - p)
        if binomial.sum() <= 0:
            continue
        rho = float(np.sum((c - n * p) ** 2) / binomial.sum())
        volume = float(np.sum(n * binomial) / binomial.sum())
        if rho <= 1.0:
            found[str(position)] = math.inf
        elif rho >= volume:
            found[str(position)] = _MINIMUM_CONCENTRATION
        else:
            found[str(position)] = (volume - rho) / (rho - 1.0)
    return found


def fit_yards_sd(residuals: Mapping[str, np.ndarray]) -> dict[str, float]:
    """Each kind's yards standard deviation per opportunity about the play model's expectation."""
    return {kind: float(np.std(values[np.isfinite(values)])) for kind, values in residuals.items()}


Shares = Callable[[float], Sequence[tuple[float, float]]]  # scale -> per format (below floor, above ceiling)


def choose_scale(shares: Shares, grid: Sequence[float] = SCALE_GRID) -> float:
    """The grid's scale minimising the summed squared misses of 0.10 over the formats (the first of
    equal losses, the grid's order)."""
    best, best_loss = grid[0], math.inf
    for scale in grid:
        loss = sum((below - TARGET_SHARE) ** 2 + (above - TARGET_SHARE) ** 2 for below, above in shares(scale))
        if loss < best_loss:
            best, best_loss = scale, loss
    return best
