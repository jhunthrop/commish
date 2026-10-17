"""EFFICIENCY OVER EXPECTED, SHRUNK: the empirical-Bayes closed forms of preregistration section 2.3.

posterior = (n / (n + k)) x observed + (k / (n + k)) x prior, n the decayed effective count, and
k = (noise variance per opportunity) / tau^2, tau^2 the variance of the true value across players,
estimated by the method of moments on the fit seasons as var(observed) less mean(noise variance / n).
When tau^2 comes out at or below zero, k is infinite and the posterior is the prior (full pooling),
and the cell is reported. The catch rate over expected is shrunk in its beta-binomial form and the
touchdown rate over expected in its gamma-Poisson form, the prior's mean and tau^2 converted to the
beta and gamma parameters, with the same floor (full pooling at tau^2 at or below zero).

Each posterior takes arrays, one entry per player-week.
"""

import math
from dataclasses import dataclass
from typing import Final

import numpy as np

_EDGE: Final = 1e-6


@dataclass(frozen=True, slots=True)
class MomentFit:
    """One cell's moments: the prior mean, tau^2, the noise variance per opportunity, the units."""

    mean: float
    tau2: float
    noise: float
    units: int

    @property
    def pooled_fully(self) -> bool:
        return self.tau2 <= 0.0

    @property
    def k(self) -> float:
        return math.inf if self.pooled_fully else self.noise / self.tau2


def moment_fit(observed: np.ndarray, n: np.ndarray, noise: float, mean: float = 0.0) -> MomentFit:
    """tau^2 = var(observed) - mean(noise / n), over the units with an opportunity."""
    kept = n > 0
    units = int(np.sum(kept))
    if units < 2:  # noqa: PLR2004 - a variance needs two units
        return MomentFit(mean, 0.0, noise, units)
    tau2 = float(np.var(observed[kept]) - np.mean(noise / n[kept]))
    return MomentFit(mean, tau2, noise, units)


def normal_posterior(observed: np.ndarray, n: np.ndarray, prior: np.ndarray, k: float) -> np.ndarray:
    """n / (n + k) of the observed and k / (n + k) of the prior; the prior where n is 0 or k infinite."""
    if math.isinf(k):
        return np.asarray(prior, dtype=float).copy()
    n = np.asarray(n, dtype=float)
    weight = np.where(n > 0, n / np.maximum(n + k, _EDGE), 0.0)
    found: np.ndarray = weight * np.nan_to_num(np.asarray(observed, dtype=float)) + (1.0 - weight) * prior
    return found


def beta_binomial_rate(successes: np.ndarray, trials: np.ndarray, prior_rate: np.ndarray, fit: MomentFit) -> np.ndarray:
    """The posterior rate: a Beta prior with mean `prior_rate` and variance tau^2, updated."""
    prior = np.asarray(prior_rate, dtype=float)
    if fit.pooled_fully:
        return prior.copy()
    m = np.clip(prior, _EDGE, 1.0 - _EDGE)
    concentration = m * (1.0 - m) / fit.tau2 - 1.0
    trials = np.asarray(trials, dtype=float)
    successes = np.asarray(successes, dtype=float)
    observed = np.where(trials > 0, successes / np.maximum(trials, _EDGE), m)
    shrunk = (m * concentration + successes) / np.maximum(concentration + trials, _EDGE)
    # A prior wider than any Beta leaves the observed rate.
    return np.where(trials <= 0, prior, np.where(concentration > 0, shrunk, observed))


def gamma_poisson_factor(events: np.ndarray, expected: np.ndarray, fit: MomentFit) -> np.ndarray:
    """The posterior factor over expected: a Gamma prior with mean `fit.mean` and variance tau^2."""
    expected = np.asarray(expected, dtype=float)
    if fit.pooled_fully:
        return np.full(expected.shape, fit.mean)
    rate = fit.mean / fit.tau2
    shape = fit.mean * rate
    found = (shape + np.asarray(events, dtype=float)) / (rate + expected)
    return np.where(expected > 0, found, fit.mean)
