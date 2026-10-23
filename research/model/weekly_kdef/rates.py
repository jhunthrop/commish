"""THE SHRUNK RATES, IN ROUND 4'S CLOSED FORMS (Amendment 7 item 2; design 5.2 and 5.3; round 4 section 2.3).

A per-game rate (points allowed over expected, takeaways, yards, attempts) is shrunk in the normal form:
posterior = n / (n + k) x observed + k / (n + k) x prior, n the unit's games. k is either the design's
fixed prior weight (6 games for points allowed over expected, toward 0; two seasons, 34 games, for the
takeaways a defense makes, whose persistence is weak; a full season, 17 games, for return touchdowns,
safeties and blocks) or the method of moments over the fit seasons' club-seasons (`moment_fit`: tau^2 =
var(observed) - mean(noise / n), k = noise / tau^2, full pooling at tau^2 at or below zero, counted).

A rate per trial (a kicker's makes, his long attempts, his extra points, a club's two-point tries and its
field goals per scoring trip) is shrunk in the beta-binomial form toward its prior rate, tau^2 by the
same method of moments with the binomial noise p (1 - p).
"""

import math
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Final

import numpy as np

from research.model.weekly4.shrinkage import MomentFit, beta_binomial_rate, moment_fit, normal_posterior

SEASON_GAMES: Final = 17.0
POINTS_OVER_EXPECTED_K: Final = 6.0  # design 5.2: "shrunk toward 0 with 6 games of prior"
TAKEAWAY_K: Final = 2 * SEASON_GAMES  # design 5.2: "heavy prior: 2 seasons"
SPECIAL_TEAMS_K: Final = SEASON_GAMES  # design 5.2: "a full season of prior"


@dataclass(frozen=True, slots=True)
class GamePrior:
    """A per-game rate's prior: its mean and its weight k in games; `pooled` when k is infinite."""

    mean: float
    k: float

    @property
    def pooled(self) -> bool:
        return math.isinf(self.k)


def fixed_prior(mean: float, k: float) -> GamePrior:
    return GamePrior(mean, k)


def moments_prior(units: Sequence[Sequence[float]]) -> GamePrior:
    """The method of moments over units (club-seasons), each its per-game values: the mean, and k the
    pooled within-unit variance over tau^2."""
    kept = [np.asarray(u, dtype=float) for u in units if len(u) > 0]
    if not kept:
        return GamePrior(0.0, math.inf)
    totals = np.array([u.sum() for u in kept])
    games = np.array([float(len(u)) for u in kept])
    mean = float(totals.sum() / games.sum())
    multi = [u for u in kept if len(u) > 1]
    noise = float(np.mean([u.var(ddof=1) for u in multi])) if multi else 0.0
    fit = moment_fit(totals / games, games, noise, mean)
    return GamePrior(mean, fit.k if noise > 0 else math.inf)


def shrunk_per_game(total: float, games: float, prior: GamePrior) -> float:
    """The unit's posterior per-game rate; the prior with no game."""
    if games <= 0:
        return prior.mean
    found = normal_posterior(np.array([total / games]), np.array([games]), np.array([prior.mean]), prior.k)
    return float(found[0])


@dataclass(frozen=True, slots=True)
class TrialPrior:
    """A per-trial rate's beta-binomial prior: its mean rate and its moment fit."""

    rate: float
    fit: MomentFit

    @property
    def pooled(self) -> bool:
        return self.fit.pooled_fully


def trials_prior(
    successes: Sequence[float], trials: Sequence[float], expected: Sequence[float] | None = None
) -> TrialPrior:
    """The method of moments over units' (successes, trials): tau^2 of the true rate around the unit's
    expected rate (`expected` successes, else the league rate), the binomial noise p (1 - p)."""
    s = np.asarray(successes, dtype=float)
    n = np.asarray(trials, dtype=float)
    kept = n > 0
    if not kept.any():
        return TrialPrior(0.0, MomentFit(0.0, 0.0, 0.0, 0))
    rate = float(s[kept].sum() / n[kept].sum())
    centre = np.full(len(n), rate) if expected is None else np.asarray(expected, dtype=float) / np.maximum(n, 1e-9)
    observed = np.where(kept, s / np.maximum(n, 1e-9) - centre, 0.0)
    noise = rate * (1.0 - rate)
    fit = moment_fit(observed[kept], n[kept], noise, 0.0)
    return TrialPrior(rate, MomentFit(rate, fit.tau2, noise, fit.units))


def shrunk_rate(successes: float, trials: float, prior_rate: float, prior: TrialPrior) -> float:
    """The unit's posterior rate toward `prior_rate` (its own expected rate, or the league's)."""
    found = beta_binomial_rate(np.array([successes]), np.array([trials]), np.array([prior_rate]), prior.fit)
    return float(found[0])
