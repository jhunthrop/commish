# ruff: noqa: PLR2004 - hand-made cases
"""The empirical-Bayes closed forms of 2.3: the normal posterior with k = noise / tau^2, full pooling
when tau^2 is at or below zero, and the beta-binomial and gamma-Poisson forms from the same moments."""

import math

import numpy as np
import pytest

from research.model.weekly4.shrinkage import (
    MomentFit,
    beta_binomial_rate,
    gamma_poisson_factor,
    moment_fit,
    normal_posterior,
)


def _a(*values: float) -> np.ndarray:
    return np.array(values, dtype=float)


def test_the_normal_posterior_weighs_n_against_k() -> None:
    found = normal_posterior(_a(2.0, 2.0), _a(10.0, 0.0), _a(0.0, 0.5), 10.0)
    assert list(found) == pytest.approx([1.0, 0.5])
    assert list(normal_posterior(_a(2.0), _a(100.0), _a(0.5), math.inf)) == pytest.approx([0.5])


def test_the_moment_fit_and_full_pooling() -> None:
    observed = _a(1.0, -1.0, 1.0, -1.0)
    n = _a(10.0, 10.0, 10.0, 10.0)
    fit = moment_fit(observed, n, noise=2.0)
    assert fit.tau2 == pytest.approx(np.var(observed) - 0.2)
    assert fit.k == pytest.approx(2.0 / fit.tau2)
    assert not fit.pooled_fully
    pooled = moment_fit(_a(0.1, -0.1), _a(1.0, 1.0), noise=5.0)
    assert pooled.pooled_fully
    assert pooled.k == math.inf


def test_the_beta_binomial_rate_moves_from_the_prior_mean_toward_the_observed() -> None:
    prior = MomentFit(mean=0.0, tau2=0.01, noise=0.0, units=10)
    rates = beta_binomial_rate(_a(9.0, 0.0), _a(10.0, 0.0), _a(0.6, 0.6), prior)
    assert 0.6 < rates[0] < 0.9
    assert rates[1] == pytest.approx(0.6)
    pooled = MomentFit(mean=0.0, tau2=-0.01, noise=0.0, units=10)
    assert list(beta_binomial_rate(_a(9.0), _a(10.0), _a(0.6), pooled)) == pytest.approx([0.6])


def test_the_gamma_poisson_factor() -> None:
    prior = MomentFit(mean=1.0, tau2=0.25, noise=0.0, units=10)
    # alpha = 4, beta = 4: (4 + 3) / (4 + 1)
    assert list(gamma_poisson_factor(_a(3.0, 0.0), _a(1.0, 0.0), prior)) == pytest.approx([7.0 / 5.0, 1.0])
    assert list(gamma_poisson_factor(_a(3.0), _a(1.0), MomentFit(1.1, 0.0, 0.0, 10))) == pytest.approx([1.1])
