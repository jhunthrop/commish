"""THE DISTRIBUTION: A SIMULATION OF THE GAME (preregistration section 2.6).

For each game, 10,000 draws, from numpy's `default_rng(seed)`, the seed the first 8 bytes, read as a
big-endian unsigned 64-bit integer, of the SHA-256 digest of "{run_seed}:{season}:{week}:{home club}".

- **the margin**: Normal around the closing spread with the fitted standard deviation of (margin less
  closing spread); the two clubs share it,
- **the volume chain, per club**: plays from a negative binomial around the team model's mean with a
  fitted dispersion, or at the Poisson boundary (fitted variance at or below the mean) a Normal with
  the fitted residual standard deviation, rounded and floored at 0; dropbacks Binomial(plays, the team
  model's pass rate plus the fitted script effect of the drawn margin); then per quarterback, his
  dropbacks allocated, sacks Binomial(his dropbacks, the team model's sack rate), scrambles
  Binomial(dropbacks less sacks, the starter's shrunk scramble rate), pass attempts the remainder; team
  targets Binomial(pass attempts, the club's season-to-date share of attempts with a targeted receiver);
  designed rushes plays less dropbacks (a sum of the quarterbacks' binomials is the club's binomial),
- **the allocation**: Dirichlet-multinomial among the club's projected players and the residual,
  around the normalised shares, one fitted concentration per position and kind,
- **each opportunity's outcome**: catches Binomial(targets, his catch probability), yards Normal
  around his expected yards per opportunity times his count with the kind's per-opportunity standard
  deviation times the position's yardage-variance scale, touchdowns Poisson at the reconciled rates,
  interceptions Poisson at the expected rate, the quarterback's passing touchdowns his share of the
  club's drawn receiving touchdowns by his drawn dropbacks; the value allowance per opportunity,
- **points** in each format.

The yardage noise enters each draw as the scale times a standard term (`noise`), so the scale's grid
(2.6: 0.50 to 2.00 by 0.05) is read on one set of draws. Floor, median and ceiling are the 10th, 50th
and 90th percentiles; the start-and-sit chance is the share of paired draws in which A outscores B,
ties half (same game: draw i shared; different games: independent games, independent draws).
"""

import hashlib
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Final

import numpy as np
import pandas as pd

from research.model.weekly4.play_model import (
    FORMAT_NAMES,
    INTERCEPTION,
    PASSING_TOUCHDOWN,
    PASSING_YARDS_PER_POINT,
    RECEPTION_VALUE,
    TOUCHDOWN,
    YARDS_PER_POINT,
)
from research.model.weekly4.point import Constants

MEAN_TOLERANCE_POINTS: Final = 0.25  # 2.6: "within 0.25 PPR points or 3 per cent ..., whichever is larger"
MEAN_TOLERANCE_SHARE: Final = 0.03
BAND: Final = (10.0, 50.0, 90.0)
_CONCENTRATION_CAP: Final = 1e6  # an infinite concentration (a multinomial) drawn as a very large one
_KINDS: Final = ("targets", "carries", "dropbacks")


def game_seed(run_seed: int, season: int, week: int, home: str) -> int:
    digest = hashlib.sha256(f"{run_seed}:{season}:{week}:{home}".encode()).digest()
    return int.from_bytes(digest[:8], "big")


@dataclass(frozen=True, slots=True)
class Dispersion:
    """The simulation's fitted constants (2.6), on the fit rows."""

    margin_sd: float
    script_slope: float  # realised pass rate less the model's, per point of margin over the spread
    plays_dispersion: float | None  # the negative binomial's size; None at the Poisson boundary
    plays_sd: float  # the Normal fallback's residual standard deviation
    concentration: Mapping[tuple[str, str], float]  # (position, kind) -> the Dirichlet concentration
    yards_sd: Mapping[str, float]  # kind -> the per-opportunity yards standard deviation
    scale: Mapping[str, float]  # position -> the yardage-variance scale


@dataclass(frozen=True, slots=True)
class Simulated:
    """One game's draws: per player (rows) and draw (columns), the points in each format at the
    dispersion's scale, the scale-free part and the standard yardage term."""

    players: list[str]
    positions: list[str]
    clubs: list[str]
    base: Mapping[str, np.ndarray]
    noise: np.ndarray
    points: Mapping[str, np.ndarray]


def _plays(rng: np.random.Generator, mean: float, d: Dispersion, draws: int) -> np.ndarray:
    if d.plays_dispersion is None:
        return np.maximum(np.rint(rng.normal(mean, d.plays_sd, draws)), 0.0).astype(np.int64)
    size = d.plays_dispersion
    rate = rng.gamma(size, max(mean, 1e-9) / size, draws)
    return rng.poisson(rate)


def _allocate(rng: np.random.Generator, total: np.ndarray, shares: np.ndarray, alphas: np.ndarray) -> np.ndarray:
    """Dirichlet-multinomial counts (draws x players) of `total` among players with `shares` (the last
    column the residual) and concentrations `alphas`."""
    draws = len(total)
    if shares.sum() <= 0:
        return np.zeros((draws, len(shares)), dtype=np.int64)
    p = shares / shares.sum()
    alpha = np.minimum(alphas, _CONCENTRATION_CAP)
    shape = np.where(p > 0, alpha * p, 0.0)
    # Each weight Gamma(alpha_i p_i, 1 / alpha_i): mean p_i at its own position's concentration (one
    # concentration for all is the plain Dirichlet).
    weights = np.where(shape > 0, rng.gamma(np.maximum(shape, 1e-12), 1.0 / alpha, (draws, len(p))), 0.0)
    sums = weights.sum(axis=1, keepdims=True)
    probabilities = np.where(sums > 0, weights / np.where(sums > 0, sums, 1.0), p)
    return rng.multinomial(total, probabilities)


def _col(club: pd.DataFrame, name: str) -> np.ndarray:
    return club[name].to_numpy(dtype=float)


@dataclass(slots=True)
class _Draws:
    """One club's player draws while they are built."""

    base: dict[str, np.ndarray]
    noise: np.ndarray
    receiving_td: np.ndarray  # the club's drawn receiving touchdowns (players and residual)


def _alphas(club: pd.DataFrame, kind: str, d: Dispersion) -> np.ndarray:
    found = [d.concentration.get((str(p), kind), _CONCENTRATION_CAP) for p in club["position"]]
    fitted = [a for a in found if a < _CONCENTRATION_CAP]
    residual = float(np.median(fitted)) if fitted else _CONCENTRATION_CAP  # the residual: the club's median
    return np.array([*found, residual])


def _club_draws(
    rng: np.random.Generator, club: pd.DataFrame, deviation: np.ndarray, d: Dispersion, c: Constants
) -> _Draws:
    draws = len(deviation)
    first = club.iloc[0]
    plays = _plays(rng, float(first["team_plays"]), d, draws)
    pass_rate = float(first["team_dropbacks"]) / max(float(first["team_plays"]), 1e-9)
    p = np.clip(pass_rate + d.script_slope * deviation, 0.0, 1.0)
    dropbacks = rng.binomial(plays, p)
    designed = plays - dropbacks
    projected = club["withheld"].to_numpy() == 0
    share = {k: np.where(projected, _col(club, f"share_{k}"), 0.0) for k in _KINDS}
    residual = {k: float(first[f"residual_{k}"]) for k in _KINDS}
    dropped = _allocate(
        rng, dropbacks, np.append(share["dropbacks"], residual["dropbacks"]), _alphas(club, "dropbacks", d)
    )
    sacks = rng.binomial(dropped, float(first["sack_rate"]))
    scrambles = rng.binomial(dropped - sacks, float(first["scramble_rate"]))
    attempts = (dropped - sacks - scrambles).sum(axis=1)
    team_targets = rng.binomial(attempts, float(first["target_rate"]))
    targets = _allocate(
        rng, team_targets, np.append(share["targets"], residual["targets"]), _alphas(club, "targets", d)
    )
    carries = _allocate(rng, designed, np.append(share["carries"], residual["carries"]), _alphas(club, "carries", d))
    n = len(club)
    t, r, db, sc = targets[:, :n].T, carries[:, :n].T, dropped[:, :n].T, scrambles[:, :n].T
    catch = rng.binomial(t, _col(club, "catch_probability")[:, None])
    receiving_rate = (_col(club, "target_wx_td") * _col(club, "target_td_factor") * _col(club, "receiving_scale"))[
        :, None
    ]
    receiving_td = rng.poisson(t * receiving_rate)
    rushing_scale = _col(club, "rushing_scale")[:, None]
    rushing_td = rng.poisson(r * (_col(club, "carry_wx_td") * _col(club, "carry_td_factor"))[:, None] * rushing_scale)
    scramble_td = rng.poisson(sc * c.scramble_touchdowns * rushing_scale)
    interceptions = rng.poisson(db * _col(club, "dropback_wx_interception")[:, None])
    residual_rate = c.residual_target_td * float(first["receiving_scale"])
    residual_td = rng.poisson(targets[:, n] * residual_rate)
    club_receiving = receiving_td.sum(axis=0) + residual_td
    total_dropbacks = np.maximum(dropped.sum(axis=1), 1)
    passing_td = club_receiving[None, :] * db / total_dropbacks[None, :]
    z = rng.standard_normal((4, n, draws))
    per_target = (_col(club, "target_wx_yards") + _col(club, "target_yards_over"))[:, None]
    per_carry = (_col(club, "carry_wx_yards") + _col(club, "carry_yards_over"))[:, None]
    per_dropback = (_col(club, "dropback_wx_pass_yards") + _col(club, "dropback_yards_over"))[:, None]
    sd = d.yards_sd
    noise = (
        z[0] * sd["target"] * np.sqrt(t) / YARDS_PER_POINT
        + z[1] * sd["carry"] * np.sqrt(r) / YARDS_PER_POINT
        + z[2] * sd["dropback"] * np.sqrt(db) / PASSING_YARDS_PER_POINT
        + z[3] * sd["carry"] * np.sqrt(sc) / YARDS_PER_POINT
    )
    common = (
        t * per_target / YARDS_PER_POINT
        + r * per_carry / YARDS_PER_POINT
        + db * per_dropback / PASSING_YARDS_PER_POINT
        + sc * c.scramble_yards / YARDS_PER_POINT
        + TOUCHDOWN * (receiving_td + rushing_td + scramble_td)
        + PASSING_TOUCHDOWN * passing_td
        + INTERCEPTION * interceptions
    )
    base = {
        name: common
        + RECEPTION_VALUE[name] * catch
        + t * _col(club, f"allow_target_{name}")[:, None]
        + r * _col(club, f"allow_carry_{name}")[:, None]
        + db * _col(club, f"allow_dropback_{name}")[:, None]
        for name in FORMAT_NAMES
    }
    return _Draws(base, noise, club_receiving)


def home_club(game: pd.DataFrame) -> str:
    """nflverse's game id is season_week_away_home."""
    return str(game["game_id"].iloc[0]).split("_")[-1]


def simulate_game(game: pd.DataFrame, d: Dispersion, c: Constants, run_seed: int, draws: int) -> Simulated:
    """The game's draws for every row of its two clubs (`game` carries the point's columns)."""
    home = home_club(game)
    first = game.iloc[0]
    rng = np.random.default_rng(game_seed(run_seed, int(first["season"]), int(first["week"]), home))
    home_rows = game[game["club"] == home]
    spread = float(home_rows["spread"].iloc[0]) if not home_rows.empty else 0.0
    margin = rng.normal(spread, d.margin_sd, draws)
    clubs = [home, *sorted(set(game["club"]) - {home})]
    players: list[str] = []
    positions: list[str] = []
    owners: list[str] = []
    bases: dict[str, list[np.ndarray]] = {name: [] for name in FORMAT_NAMES}
    noises: list[np.ndarray] = []
    for club in clubs:
        rows = game[game["club"] == club].sort_values("player_id")
        if rows.empty:
            continue
        deviation = (margin - spread) if club == home else -(margin - spread)
        found = _club_draws(rng, rows, deviation, d, c)
        players += [str(p) for p in rows["player_id"]]
        positions += [str(p) for p in rows["position"]]
        owners += [club] * len(rows)
        for name in FORMAT_NAMES:
            bases[name].append(found.base[name])
        noises.append(found.noise)
    base = {name: np.vstack(parts).astype(float) for name, parts in bases.items()}
    noise = np.vstack(noises).astype(float)
    scale = np.array([d.scale.get(p, 1.0) for p in positions])[:, None]
    points = {name: values + scale * noise for name, values in base.items()}
    return Simulated(players, positions, owners, base, noise, points)


def bands(simulated: Simulated, name: str, scale: Mapping[str, float]) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Floor, median and ceiling per player at the positions' scales."""
    factor = np.array([scale.get(p, 1.0) for p in simulated.positions])[:, None]
    values = simulated.base[name] + factor * simulated.noise
    low, mid, high = np.percentile(values, BAND, axis=1)
    return low, mid, high


def mean_check(simulated: Simulated, game: pd.DataFrame) -> list[str]:
    """The simulation's mean against the point (2.6), PPR: each breach named, a defect."""
    points = game.set_index("player_id")["point_ppr"]
    floor, ceiling = np.percentile(simulated.points["ppr"], (BAND[0], BAND[2]), axis=1)
    breaches: list[str] = []
    for i, pid in enumerate(simulated.players):
        point = float(points.get(pid, np.nan))
        if np.isnan(point):
            continue
        mean = float(simulated.points["ppr"][i].mean())
        tolerance = max(MEAN_TOLERANCE_POINTS, MEAN_TOLERANCE_SHARE * abs(point))
        if abs(mean - point) > tolerance:
            breaches.append(f"{pid}: mean {mean:.3f} against the point {point:.3f}")
        elif not floor[i] <= point <= ceiling[i]:
            breaches.append(f"{pid}: point {point:.3f} outside [{floor[i]:.3f}, {ceiling[i]:.3f}]")
    return breaches


def paired_chance(a: np.ndarray, b: np.ndarray) -> float:
    """The share of paired draws in which A outscores B, ties half."""
    return float(np.mean(a > b) + 0.5 * np.mean(a == b))


def chance_matrix(draws: Sequence[np.ndarray]) -> np.ndarray:
    """Every pair's paired chance, row player over column player."""
    stacked = np.vstack(draws)
    n = len(stacked)
    found = np.full((n, n), 0.5)
    for i in range(n):
        rest = stacked[i + 1 :]
        if len(rest) == 0:
            continue
        wins = (stacked[i][None, :] > rest).mean(axis=1) + 0.5 * (stacked[i][None, :] == rest).mean(axis=1)
        found[i, i + 1 :] = wins
        found[i + 1 :, i] = 1.0 - wins
    return found
