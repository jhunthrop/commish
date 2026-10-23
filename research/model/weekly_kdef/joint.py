"""THE JOINT DISTRIBUTION AND THE POINT (design 5.4; Amendment 7 item 4).

Each club-game is drawn jointly, 2,000 draws, numpy's `default_rng` seeded with the first 8 bytes (big
endian) of SHA-256 of "{run_seed}:{season}:{week}:{club}:kdef" (round 4's rule with ":kdef" appended),
the club the scoring club C of the row. One draw of C's points places the draw in one of the three bands;
then

- D's defense: sacks (negative binomial at the team model's mean, its dispersion fitted on the fit rows),
  interceptions and fumble recoveries (Poisson), each at its mean times its band's multiplier (the fit
  rows' mean observed over mean expected in that band); defensive touchdowns per takeaway; return
  touchdowns, safeties and blocks at their shrunk rates; yards allowed from the expected yards times a
  residual of its expected-yards third, rank-coupled to the drawn points by a Gaussian copula at the fit
  rows' Spearman between the points' position in their distribution and the yards residual;
- C's kicker: field-goal attempts and touchdown tries (Poisson) at their means times their band's
  multipliers; each attempt's distance band from the multinomial; each make from its band's probability;
  extra-point tries from the drawn touchdowns less the two-point tries; each extra point from its chance.

The point is the analytic expectation of the scored components over the same three bands, so draws and
point agree by construction up to sampling; a draw mean off the point by more than 0.25 points or 3 per
cent is a defect counted (`mean_breaches`).
"""

import hashlib
import math
from collections.abc import Mapping
from dataclasses import dataclass
from statistics import NormalDist
from types import MappingProxyType
from typing import Final

import numpy as np
import pandas as pd

from research.model.weekly_kdef import kernel, scoring
from research.model.weekly_kdef.expectations import Expectations
from research.model.weekly_kdef.scoring import FG_BANDS, FG_MISSED_POINTS, FG_POINTS, XP_MISSED_POINTS, XP_POINTS

FROZEN: Final = MappingProxyType
DRAWS: Final = 2_000
BAND_PERCENTILES: Final = (10.0, 50.0, 90.0)
MEAN_TOLERANCE_POINTS: Final = 0.25
MEAN_TOLERANCE_SHARE: Final = 0.03
BANDED: Final = ("sacks", "interceptions", "fumble_recoveries", "attempts", "touchdowns")
_NORMAL: Final = NormalDist()
_EDGE: Final = 1e-9
_INV: Final = np.vectorize(_NORMAL.inv_cdf)
_ERF: Final = np.vectorize(math.erf)


def club_game_seed(run_seed: int, season: int, week: int, club: str) -> int:
    digest = hashlib.sha256(f"{run_seed}:{season}:{week}:{club}:kdef".encode()).digest()
    return int.from_bytes(digest[:8], "big")


@dataclass(frozen=True, slots=True)
class Calibration:
    """What the joint reads from the fit rows."""

    multipliers: Mapping[str, tuple[float, float, float]]  # component -> (below, inside, above)
    sack_dispersion: float  # the negative binomial's size r (infinite: Poisson)
    yards_edges: tuple[float, float]  # the expected-yards thirds' edges
    yards_residuals: tuple[np.ndarray, np.ndarray, np.ndarray]  # each third's sorted actual over expected
    yards_rho: float  # the Spearman the copula reads


def _spearman(a: np.ndarray, b: np.ndarray) -> float:
    if len(a) < 3:  # noqa: PLR2004 - a correlation needs three points to mean anything
        return 0.0
    ra, rb = pd.Series(a).rank().to_numpy(), pd.Series(b).rank().to_numpy()
    if ra.std() == 0 or rb.std() == 0:
        return 0.0
    return float(np.corrcoef(ra, rb)[0, 1])


def _multiplier(observed: np.ndarray, expected: np.ndarray, band: np.ndarray) -> tuple[float, float, float]:
    found = []
    for b in range(3):
        rows = band == b
        mean = float(expected[rows].sum())
        found.append(float(observed[rows].sum()) / mean if mean > 0 else 1.0)
    return (found[0], found[1], found[2])


def _dispersion(observed: np.ndarray, mean: np.ndarray) -> float:
    excess = float(np.sum((observed - mean) ** 2 - mean))
    return float(np.sum(mean**2)) / excess if excess > 0 else math.inf


def yards_third(expected: np.ndarray, edges: tuple[float, float]) -> np.ndarray:
    return np.where(expected < edges[0], 0, np.where(expected < edges[1], 1, 2))


def calibrate(e: Expectations, rows: pd.DataFrame) -> Calibration:
    """The joint's constants from the fit rows (their expectations from the seasons before each)."""
    actual = rows["d_points_allowed"].to_numpy(dtype=float)
    band = kernel.band_of(actual, e.low, e.high)
    observed = {
        "sacks": rows["d_sacks"].to_numpy(dtype=float),
        "interceptions": rows["d_interceptions"].to_numpy(dtype=float),
        "fumble_recoveries": rows["d_fumble_recoveries"].to_numpy(dtype=float),
        "attempts": rows["club_fg_att"].to_numpy(dtype=float),
        "touchdowns": rows["club_td_tries"].to_numpy(dtype=float),
    }
    multipliers = {name: _multiplier(observed[name], getattr(e, name), band) for name in BANDED}
    scaled = np.array([multipliers["sacks"][b] for b in band]) * e.sacks
    residual = rows["d_yards_allowed"].to_numpy(dtype=float) / np.maximum(e.yards, _EDGE)
    edges_array = np.quantile(e.yards, (1 / 3, 2 / 3))
    edges = (float(edges_array[0]), float(edges_array[1]))
    third = yards_third(e.yards, edges)
    residuals = tuple(np.sort(residual[third == t]) if (third == t).any() else np.ones(1) for t in range(3))
    rho = _spearman(kernel.mid_cdf(e.dist, actual), residual)
    return Calibration(
        FROZEN(multipliers),
        _dispersion(observed["sacks"], scaled),
        edges,
        (residuals[0], residuals[1], residuals[2]),
        rho,
    )


def _weighted(e: Expectations, c: Calibration, name: str) -> np.ndarray:
    m = np.array(c.multipliers[name])
    return np.asarray(np.asarray(e.masses @ m) * getattr(e, name), dtype=float)


def _yards_points(e: Expectations, c: Calibration) -> np.ndarray:
    third = yards_third(e.yards, c.yards_edges)
    found = np.zeros(len(e.yards))
    for i, (expected, t) in enumerate(zip(e.yards, third, strict=True)):
        found[i] = float(np.mean(scoring.yards_allowed_points(expected * c.yards_residuals[int(t)])))
    return found


def defense_point(e: Expectations, c: Calibration) -> np.ndarray:
    """D's analytic expected points under the judged scoring."""
    allowed = e.dist @ scoring.points_allowed_points(kernel.SCORES)
    takeaways = _weighted(e, c, "interceptions") + _weighted(e, c, "fumble_recoveries")
    p = scoring.DEFENSE_POINTS
    counts = (
        _weighted(e, c, "sacks") * p["sacks"]
        + _weighted(e, c, "interceptions") * p["interceptions"]
        + _weighted(e, c, "fumble_recoveries") * p["fumble_recoveries"]
        + e.td_per_takeaway * takeaways * p["defensive_touchdowns"]
        + e.return_touchdowns * p["return_touchdowns"]
        + e.safeties * p["safeties"]
        + e.blocks * p["blocks"]
    )
    return np.asarray(allowed + _yards_points(e, c) + counts)


def _attempt_value(e: Expectations, fg_points: Mapping[str, float]) -> np.ndarray:
    points = np.array([fg_points[b] for b in FG_BANDS])
    return np.asarray(np.sum(e.bands * (e.makes * points + (1.0 - e.makes) * FG_MISSED_POINTS), axis=1))


def kicker_point(e: Expectations, c: Calibration, fg_points: Mapping[str, float] = FG_POINTS) -> np.ndarray:
    """C's kicker's analytic expected points under the judged scoring (or another distance table)."""
    field_goals = _weighted(e, c, "attempts") * _attempt_value(e, fg_points)
    tries = _weighted(e, c, "touchdowns") * (1.0 - e.two_point_rate)
    extra = tries * (e.extra_point * XP_POINTS + (1.0 - e.extra_point) * XP_MISSED_POINTS)
    return np.asarray(field_goals + extra)


@dataclass(frozen=True, slots=True)
class Drawn:
    """One row's scored draws for each position."""

    defense: np.ndarray
    kicker: np.ndarray


def _poisson(rng: np.random.Generator, mean: np.ndarray) -> np.ndarray:
    return np.asarray(rng.poisson(np.maximum(mean, 0.0)))


def _defense_draws(  # noqa: PLR0913, PLR0917 - one row's draw, named
    rng: np.random.Generator, e: Expectations, i: int, c: Calibration, u: np.ndarray, band: np.ndarray
) -> dict[str, np.ndarray]:
    def banded(name: str) -> np.ndarray:
        return np.asarray(np.array(c.multipliers[name])[band] * float(getattr(e, name)[i]), dtype=float)

    sack_mean = banded("sacks")
    if math.isinf(c.sack_dispersion):
        sacks = _poisson(rng, sack_mean)
    else:
        r = c.sack_dispersion
        sacks = rng.poisson(rng.gamma(r, np.maximum(sack_mean, _EDGE) / r))
    interceptions = _poisson(rng, banded("interceptions"))
    recoveries = _poisson(rng, banded("fumble_recoveries"))
    touchdowns = rng.binomial(interceptions + recoveries, min(max(float(e.td_per_takeaway[i]), 0.0), 1.0))
    z = _INV(np.clip(u, _EDGE, 1.0 - _EDGE))
    rho = 2.0 * math.sin(math.pi * c.yards_rho / 6.0)
    zy = rho * z + math.sqrt(max(1.0 - rho * rho, 0.0)) * rng.standard_normal(len(u))
    uy = 0.5 * (1.0 + _ERF(zy / math.sqrt(2.0)))
    residuals = c.yards_residuals[int(yards_third(np.array([e.yards[i]]), c.yards_edges)[0])]
    picked = residuals[np.minimum((uy * len(residuals)).astype(int), len(residuals) - 1)]
    return {
        "sacks": sacks.astype(float),
        "interceptions": interceptions.astype(float),
        "fumble_recoveries": recoveries.astype(float),
        "defensive_touchdowns": touchdowns.astype(float),
        "return_touchdowns": _poisson(rng, np.full(len(u), float(e.return_touchdowns[i]))).astype(float),
        "safeties": _poisson(rng, np.full(len(u), float(e.safeties[i]))).astype(float),
        "blocks": _poisson(rng, np.full(len(u), float(e.blocks[i]))).astype(float),
        "yards_allowed": float(e.yards[i]) * picked,
    }


def _kicker_draws(
    rng: np.random.Generator, e: Expectations, i: int, c: Calibration, band: np.ndarray
) -> dict[str, np.ndarray]:
    attempts = _poisson(rng, np.array(c.multipliers["attempts"])[band] * float(e.attempts[i]))
    counts = rng.multinomial(attempts, e.bands[i] / e.bands[i].sum())
    made = rng.binomial(counts, e.makes[i])
    tries = _poisson(rng, np.array(c.multipliers["touchdowns"])[band] * float(e.touchdowns[i]))
    extra = rng.binomial(tries, 1.0 - float(e.two_point_rate[i]))
    extra_made = rng.binomial(extra, float(e.extra_point[i]))
    found = {f"fg_made_{b}": made[:, j].astype(float) for j, b in enumerate(FG_BANDS)}
    found |= {f"fg_missed_{b}": (counts[:, j] - made[:, j]).astype(float) for j, b in enumerate(FG_BANDS)}
    found |= {
        "fg_blocked": np.zeros(len(band)),
        "xp_made": extra_made.astype(float),
        "xp_missed": (extra - extra_made).astype(float),
    }
    return found


def draw_row(e: Expectations, i: int, c: Calibration, seed: int, draws: int = DRAWS) -> Drawn:
    """Row i's joint draws, scored: D's defense and C's kicker."""
    rng = np.random.default_rng(seed)
    u = rng.random(draws)
    cdf = np.cumsum(e.dist[i])
    points = kernel.SCORES[np.minimum(np.searchsorted(cdf, u, side="left"), len(kernel.SCORES) - 1)]
    band = kernel.band_of(points, np.full(draws, e.low[i]), np.full(draws, e.high[i])).astype(int)
    defense = {"points_allowed": points, **_defense_draws(rng, e, i, c, u, band)}
    kicker = _kicker_draws(rng, e, i, c, band)
    return Drawn(scoring.defense_points(defense), scoring.kicker_points(kicker))


def bands_of(draws: np.ndarray) -> tuple[float, float, float]:
    low, mid, high = np.percentile(draws, BAND_PERCENTILES)
    return float(low), float(mid), float(high)


def breached(mean: float, point: float) -> bool:
    return abs(mean - point) > max(MEAN_TOLERANCE_POINTS, MEAN_TOLERANCE_SHARE * abs(point))
