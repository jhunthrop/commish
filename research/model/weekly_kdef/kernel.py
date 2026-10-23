"""THE POINTS DISTRIBUTION (design 5.2; Amendment 7 item 4): a kernel over the fit club-games' scores,
exponentially tilted to a boosted Poisson mean.

For a club-game whose scoring club is implied to score m, the kernel weights each fit club-game by a
Gaussian in the difference of their implied points (bandwidth h, chosen on the fit seasons by
forward-chained log loss from {1.0, 1.5, 2.0, 3.0}, the smaller on a tie) and takes the weighted empirical
distribution of their scores over 0 to 59 and 60 plus. The distribution is then tilted, p_s x exp(theta s)
normalised, with theta solved so its mean is the boosted model's expected score. The tilt keeps the
scores' lumps (0, 3, 7, 10, 13, 14, 17, 20, 21, 24) that a smooth density would erase.

The three points bands (design 5.4) are below, inside and above the middle 50 per cent of a club-game's
distribution: a score below its 25th percentile, above its 75th, or between them inclusive.
"""

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Final

import numpy as np

SCORES: Final = np.arange(0, 61, dtype=float)  # 60 is "60 plus"
BANDWIDTHS: Final = (1.0, 1.5, 2.0, 3.0)
FLOOR_PROBABILITY: Final = 1e-6  # a score no fit club-game made still has a log loss
BANDS: Final = ("below", "inside", "above")
LOW_QUANTILE: Final = 0.25
HIGH_QUANTILE: Final = 0.75
_THETA: Final = 2.0
_ITERATIONS: Final = 80


def kernel(base_implied: np.ndarray, base_scores: np.ndarray, implied: np.ndarray, bandwidth: float) -> np.ndarray:
    """Each row's kernel distribution over `SCORES` (rows x 61)."""
    onehot = np.zeros((len(base_scores), len(SCORES)))
    onehot[np.arange(len(base_scores)), np.clip(base_scores, 0, 60).astype(int)] = 1.0
    gap = (np.asarray(implied, dtype=float)[:, None] - np.asarray(base_implied, dtype=float)[None, :]) / bandwidth
    weights = np.exp(-0.5 * gap**2)
    found = weights @ onehot
    total = found.sum(axis=1, keepdims=True)
    return np.where(total > 0, found / np.maximum(total, 1e-300), 1.0 / len(SCORES))


def _tilted_mean(dist: np.ndarray, theta: np.ndarray) -> np.ndarray:
    logits = np.log(np.maximum(dist, 1e-300)) + theta[:, None] * SCORES[None, :]
    logits -= logits.max(axis=1, keepdims=True)
    w = np.exp(logits) * (dist > 0)
    w /= w.sum(axis=1, keepdims=True)
    return np.asarray(w @ SCORES)


def tilt(dist: np.ndarray, mean: np.ndarray) -> np.ndarray:
    """Each row tilted so its mean is `mean` (clipped inside the row's support), by bisection on theta."""
    mean = np.asarray(mean, dtype=float)
    support = dist > 0
    low_score = np.where(support, SCORES[None, :], np.inf).min(axis=1)
    high_score = np.where(support, SCORES[None, :], -np.inf).max(axis=1)
    target = np.clip(mean, low_score + 1e-6, high_score - 1e-6)
    lo = np.full(len(dist), -_THETA)
    hi = np.full(len(dist), _THETA)
    for _ in range(_ITERATIONS):
        mid = 0.5 * (lo + hi)
        above = _tilted_mean(dist, mid) > target
        hi = np.where(above, mid, hi)
        lo = np.where(above, lo, mid)
    theta = 0.5 * (lo + hi)
    logits = np.log(np.maximum(dist, 1e-300)) + theta[:, None] * SCORES[None, :]
    logits -= logits.max(axis=1, keepdims=True)
    w = np.exp(logits) * support
    found: np.ndarray = w / w.sum(axis=1, keepdims=True)
    return found


def log_loss(dist: np.ndarray, scores: np.ndarray) -> float:
    p = dist[np.arange(len(scores)), np.clip(scores, 0, 60).astype(int)]
    return float(-np.sum(np.log(np.maximum(p, FLOOR_PROBABILITY))))


@dataclass(frozen=True, slots=True)
class Bandwidth:
    chosen: float
    losses: dict[float, float]


def choose_bandwidth(
    implied: np.ndarray,
    scores: np.ndarray,
    seasons: np.ndarray,
    fit_seasons: Sequence[int],
    bandwidths: Sequence[float] = BANDWIDTHS,
) -> Bandwidth:
    """The bandwidth with the least forward-chained log loss over the fit seasons (each season after the
    first scored by the kernel of the seasons before it); the smaller on a tie."""
    ordered = sorted(fit_seasons)
    losses: dict[float, float] = {}
    for h in bandwidths:
        total = 0.0
        for v in ordered[1:]:
            base = seasons < v
            test = seasons == v
            if base.any() and test.any():
                total += log_loss(kernel(implied[base], scores[base], implied[test], h), scores[test])
        losses[h] = total
    best = min(losses.values())
    return Bandwidth(min(h for h, loss in losses.items() if loss <= best), losses)


def quantile(dist: np.ndarray, q: float) -> np.ndarray:
    """Each row's smallest score whose cumulative probability reaches q."""
    cdf = np.cumsum(dist, axis=1)
    return SCORES[np.argmax(cdf >= q - 1e-12, axis=1)]


def band_masses(dist: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Each row's probability of the below, inside and above bands, and the band edges (q25, q75)."""
    low, high = quantile(dist, LOW_QUANTILE), quantile(dist, HIGH_QUANTILE)
    below = np.where(SCORES[None, :] < low[:, None], dist, 0.0).sum(axis=1)
    above = np.where(SCORES[None, :] > high[:, None], dist, 0.0).sum(axis=1)
    masses = np.column_stack([below, 1.0 - below - above, above])
    return masses, low, high


def band_of(scores: np.ndarray, low: np.ndarray, high: np.ndarray) -> np.ndarray:
    """0 below, 1 inside, 2 above, elementwise."""
    s = np.asarray(scores, dtype=float)
    return np.where(s < low, 0, np.where(s > high, 2, 1))


def mid_cdf(dist: np.ndarray, scores: np.ndarray) -> np.ndarray:
    """Each row's mid-distribution position of its score: P(below it) + P(it) / 2."""
    index = np.clip(np.asarray(scores), 0, 60).astype(int)
    cdf = np.cumsum(dist, axis=1)
    p = dist[np.arange(len(index)), index]
    return np.asarray(cdf[np.arange(len(index)), index] - 0.5 * p)
