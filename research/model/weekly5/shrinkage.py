"""VALUE AND EFFICIENCY, SEASON TO DATE AND SHRUNK (preregistration section 2.4).

For each quantity of 2.4's table, at a row (season s, week W): his opportunities in his games with a line
this season before W, each weighted d^a (a the game's age in those games, 0 for his latest); the weighted
rate sum(d^a num) / sum(d^a opportunities); the effective count n_eff = (sum w)^2 / sum w^2 over his
opportunities; and the posterior n_eff / (n_eff + k) x his rate + k / (n_eff + k) x the position's rate,
the position's rate the opportunity-weighted mean over the fit window's lined rows of weeks 1 to 17. With
no opportunity, n_eff is 0 and the posterior is the position's rate.

The touchdown conversions take the expected-touchdown weight u of 2.6 and 2.7 as their opportunity: each
of a game's u units carries d^a, so sum w = sum d^a u and sum w^2 = sum d^(2a) u, n_eff in
expected-touchdown units as k is (a reading: "the weights are d^a x u" read as the game's total weight,
its units weighted alike, so that at d = 1 n_eff is his expected touchdowns, the unit of k).

(d, k) are chosen per position and quantity on their own loss: the opportunity-weighted squared error of
the posterior at W against his realised rate in game W, over the fit window's lined rows of weeks 4 to 17
with an opportunity of the unit in game W. Ties (within 0.1 per cent of the best, relative) go to the
larger k, then the larger d. A quarterback's rushing yards per carry are unpooled: the plain rate, the
position's when he has no carry.

Only lined games of the row's season before W enter (`history_before`); a row of week W or later, or of
another season, raises `InputRuleError`. The fit refuses a row outside its window (`WindowError`).
"""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from types import MappingProxyType
from typing import Final

import numpy as np
import pandas as pd

from research.errors import ResearchError
from research.model.ros.outcomes import PRISTINE_SEASON
from research.model.weekly3.ledger import InputRuleError
from research.model.weekly4.tuning import TIE

FROZEN: Final = MappingProxyType
DECAYS: Final = (0.85, 0.95, 1.0)
COUNT_PRIORS: Final = (10.0, 20.0, 40.0, 80.0, 160.0, 320.0, 640.0)
CONVERSION_PRIORS: Final = (0.5, 1.0, 2.0, 4.0, 8.0, 16.0, 32.0)
CLOSED_FROM: Final = 2025  # 2.11, G5: no fit reads 2025 or 2026
LOSS_WEEKS: Final = tuple(range(4, 18))
RATE_WEEKS: Final = tuple(range(1, 18))
ROUND_FOUR_DECAY: Final = 0.5  # the share decay round 4's efficiency rode on (CR A.12), a reported view


@dataclass(frozen=True, slots=True)
class Quantity:
    numerator: str
    opportunity: str
    positions: tuple[str, ...]
    conversion: bool = False


RECEIVERS: Final = ("RB", "WR", "TE")
QUANTITIES: Final[Mapping[str, Quantity]] = FROZEN(
    {
        "receptions_per_target": Quantity("receptions", "targets", RECEIVERS),
        "receiving_yards_per_target": Quantity("receiving_yards", "targets", RECEIVERS),
        "rushing_yards_per_carry": Quantity("designed_yards", "designed", RECEIVERS),
        "xfp_per_target": Quantity("xfp_target", "targets", RECEIVERS),
        "xfp_per_carry": Quantity("xfp_carry", "designed", RECEIVERS),
        "fpoe_per_target": Quantity("fpoe_target", "targets", RECEIVERS),
        "fpoe_per_carry": Quantity("fpoe_carry", "designed", RECEIVERS),
        "passing_yards_per_attempt": Quantity("passing_yards", "pass_attempts", ("QB",)),
        "interceptions_per_attempt": Quantity("interceptions", "pass_attempts", ("QB",)),
        "sacks_per_dropback": Quantity("sacks", "dropbacks", ("QB",)),
        "scrambles_per_dropback": Quantity("scrambles", "dropbacks", ("QB",)),
        "rushing_conversion": Quantity("rushing_touchdowns", "u_rush", ("QB", *RECEIVERS), conversion=True),
        "receiving_conversion": Quantity("receiving_touchdowns", "u_receiving", RECEIVERS, conversion=True),
        "passing_conversion": Quantity("passing_touchdowns", "u_passing", ("QB",), conversion=True),
    }
)
QB_CARRY: Final = "qb_yards_per_carry"  # 2.4: "quarterbacks' rushing yards per carry are unpooled"


class WindowError(ResearchError):
    """A fit given a row outside its window (2.11), or of a closed season."""


def rate_column(quantity: str) -> str:
    return f"shrunk_{quantity}"


def rate_inputs(position: str) -> tuple[str, ...]:
    """2.3: every shrunk rate his position carries, a quarterback's unpooled yards per carry among them."""
    found = tuple(rate_column(q) for q, spec in QUANTITIES.items() if position in spec.positions)
    return (*found, rate_column(QB_CARRY)) if position == "QB" else found


def prepared(games: pd.DataFrame) -> pd.DataFrame:
    """The lined games with the FPOE numerators."""
    return games.assign(
        fpoe_target=games["fp_target"] - games["xfp_target"], fpoe_carry=games["fp_carry"] - games["xfp_carry"]
    )


def check_window(seasons: Sequence[int] | np.ndarray, window: Sequence[int], what: str) -> None:
    """Refuse a row of a season outside `window` or of 2025 or 2026."""
    outside = sorted({int(s) for s in seasons if int(s) not in window or int(s) >= min(CLOSED_FROM, PRISTINE_SEASON)})
    if outside:
        raise WindowError(f"the {what} fits on {sorted(window)} and refuses rows of {outside}")


def history_before(games: pd.DataFrame, season: int, week: int) -> pd.DataFrame:
    """His lined games read for a row of (season, week): every one of the season and before W."""
    late = games[(games["season"] != season) | (games["week"] >= week)]
    if not late.empty:
        first = late.iloc[0]
        raise InputRuleError(
            f"the input rule refuses a {int(first['season'])} week {int(first['week'])} line in a read for "
            f"{season} week {week}"
        )
    return games


def weighted_sums(
    games: pd.DataFrame, season: int, week: int, decay: float, columns: Sequence[tuple[str, str]]
) -> pd.DataFrame:
    """Per player, for each (numerator, opportunity): sum d^a num, sum d^a opp and sum d^(2a) opp over his
    lined games of `season` before `week` (indexed by player)."""
    history = history_before(games, season, week)
    ordered = history.sort_values(["player_id", "week"], ascending=[True, False])
    age = ordered.groupby("player_id").cumcount().to_numpy(dtype=float)
    weight, square = decay**age, decay ** (2.0 * age)
    found: dict[str, np.ndarray] = {}
    for numerator, opportunity in columns:
        opp = ordered[opportunity].to_numpy(dtype=float)
        found[f"{numerator}|num"] = weight * ordered[numerator].to_numpy(dtype=float)
        found[f"{opportunity}|w"] = weight * opp
        found[f"{opportunity}|w2"] = square * opp
    frame = pd.DataFrame(found, index=ordered.index).assign(player_id=ordered["player_id"].to_numpy())
    return frame.groupby("player_id").sum()


def _pairs(quantities: Sequence[str]) -> list[tuple[str, str]]:
    found = {(QUANTITIES[q].numerator, QUANTITIES[q].opportunity) for q in quantities if q in QUANTITIES}
    if QB_CARRY in quantities:
        found.add(("rushing_yards", "carries"))
    return sorted(found)


def row_sums(games: pd.DataFrame, rows: pd.DataFrame, decay: float, quantities: Sequence[str]) -> pd.DataFrame:
    """For every row, `weighted_sums` of its player at its (season, week), aligned to `rows`' index."""
    pairs = _pairs(quantities)
    columns = [f"{n}|num" for n, _ in pairs] + [f"{o}|{s}" for _, o in pairs for s in ("w", "w2")]
    parts: list[pd.DataFrame] = []
    for (season, week), keys in rows.groupby(["season", "week"], sort=True):
        s, w = int(str(season)), int(str(week))
        mine = games[(games["season"] == s) & (games["week"] < w)]
        sums = weighted_sums(mine, s, w, decay, pairs)
        joined = keys[["player_id"]].join(sums, on="player_id")
        parts.append(joined.drop(columns=["player_id"]))
    found = pd.concat(parts) if parts else pd.DataFrame(columns=columns)
    return found.reindex(index=rows.index, columns=list(dict.fromkeys(columns))).fillna(0.0)


def posterior(num: np.ndarray, w: np.ndarray, w2: np.ndarray, k: float, prior: float) -> np.ndarray:
    """2.4's posterior; with sum w = 0, n_eff is 0 and the posterior is the position's rate."""
    has = w > 0
    n_eff = np.where(has & (w2 > 0), w**2 / np.where(w2 > 0, w2, 1.0), 0.0)
    rate = np.where(has, num / np.where(has, w, 1.0), prior)
    if k <= 0:
        return np.where(has, rate, prior)
    return (n_eff / (n_eff + k)) * rate + (k / (n_eff + k)) * prior


@dataclass(frozen=True, slots=True)
class Shrinkage:
    """The window's fit: per (position, quantity) the chosen (d, k), the position's rate, and each cell's
    loss; the quarterback's position rate of yards per carry."""

    window: tuple[int, ...]
    cells: Mapping[tuple[str, str], tuple[float, float]]
    rates: Mapping[tuple[str, str], float]
    losses: Mapping[tuple[str, str], Mapping[tuple[float, float], float]]
    views: Mapping[tuple[str, str], Mapping[str, float]]  # reported: unshrunk and round 4's decay


def position_rates(games: pd.DataFrame) -> dict[tuple[str, str], float]:
    """Per (position, quantity): sum num / sum opportunity over the lined games given (weeks 1 to 17)."""
    found: dict[tuple[str, str], float] = {}
    rated = games[games["week"].isin(RATE_WEEKS)]
    for quantity, spec in [*QUANTITIES.items(), (QB_CARRY, Quantity("rushing_yards", "carries", ("QB",)))]:
        for position in spec.positions:
            mine = rated[rated["position"] == position]
            den = float(mine[spec.opportunity].sum())
            found[(position, quantity)] = float(mine[spec.numerator].sum()) / den if den > 0 else 0.0
    return found


def _choose(losses: Mapping[tuple[float, float], float]) -> tuple[float, float]:
    best = min(losses.values())
    tied = [cell for cell, loss in losses.items() if loss <= best + TIE * abs(best)]
    return max(tied, key=lambda cell: (cell[1], cell[0]))  # the larger k, then the larger d


def _loss(sums: pd.DataFrame, rows: pd.DataFrame, spec: Quantity, k: float, prior: float) -> float:
    now = rows[spec.opportunity].to_numpy(dtype=float)
    keep = now > 0
    if not keep.any():
        return 0.0
    num = sums[f"{spec.numerator}|num"].to_numpy(dtype=float)[keep]
    w = sums[f"{spec.opportunity}|w"].to_numpy(dtype=float)[keep]
    w2 = sums[f"{spec.opportunity}|w2"].to_numpy(dtype=float)[keep]
    realised = rows[spec.numerator].to_numpy(dtype=float)[keep] / now[keep]
    post = posterior(num, w, w2, k, prior)
    return float(np.sum(now[keep] * (post - realised) ** 2))


def fit_shrinkage(games: pd.DataFrame, window: Sequence[int], decays: Sequence[float] = DECAYS) -> Shrinkage:
    """(d, k) per position and quantity on the window's lined games, and the position's rates."""
    check_window(games["season"].unique(), window, "shrinkage")
    games = prepared(games)
    rates = position_rates(games)
    loss_rows = games[games["week"].isin(LOSS_WEEKS)]
    sums = {d: row_sums(games, loss_rows, d, list(QUANTITIES)) for d in (*decays, ROUND_FOUR_DECAY)}
    cells: dict[tuple[str, str], tuple[float, float]] = {}
    losses: dict[tuple[str, str], Mapping[tuple[float, float], float]] = {}
    views: dict[tuple[str, str], Mapping[str, float]] = {}
    for quantity, spec in QUANTITIES.items():
        grid = CONVERSION_PRIORS if spec.conversion else COUNT_PRIORS
        for position in spec.positions:
            mine = loss_rows["position"].to_numpy() == position
            rows = loss_rows[mine]
            prior = rates[(position, quantity)]
            found = {(d, k): _loss(sums[d][mine], rows, spec, k, prior) for d in decays for k in grid}
            cells[(position, quantity)] = _choose(found)
            losses[(position, quantity)] = FROZEN(found)
            chosen_d, chosen_k = cells[(position, quantity)]
            views[(position, quantity)] = FROZEN(
                {
                    "shrunk": found[(chosen_d, chosen_k)],
                    "season_to_date_unshrunk": _loss(sums[1.0][mine], rows, spec, 0.0, prior),
                    "round_four_share_decay": _loss(sums[ROUND_FOUR_DECAY][mine], rows, spec, chosen_k, prior),
                }
            )
    return Shrinkage(tuple(window), FROZEN(cells), FROZEN(rates), FROZEN(losses), FROZEN(views))


def shrunk_rates(
    games: pd.DataFrame,
    rows: pd.DataFrame,
    fit: Shrinkage,
    neutral: bool = False,
    decay: float | None = None,
) -> pd.DataFrame:
    """Every row's shrunk rates (`shrunk_<quantity>`) of its position, NaN for a quantity his position does
    not carry. `neutral`: every rate at the position's rate (the why's group 7, n_eff = 0); `decay`: every
    quantity at that decay with its chosen k (the reported view of round 4's share decay)."""
    games = prepared(games)
    names = [*QUANTITIES, QB_CARRY]
    found = pd.DataFrame(np.nan, index=rows.index, columns=[rate_column(q) for q in names])
    wanted = {decay} if decay is not None else {d for d, _ in fit.cells.values()} | {1.0}
    sums = {d: row_sums(games, rows, d, names) for d in sorted(wanted)}
    positions = rows["position"].to_numpy()
    for (position, quantity), (d, k) in fit.cells.items():
        spec = QUANTITIES[quantity]
        mine = positions == position
        prior = fit.rates[(position, quantity)]
        if neutral:
            found.loc[mine, rate_column(quantity)] = prior
            continue
        s = sums[decay if decay is not None else d][mine]
        found.loc[mine, rate_column(quantity)] = posterior(
            s[f"{spec.numerator}|num"].to_numpy(dtype=float),
            s[f"{spec.opportunity}|w"].to_numpy(dtype=float),
            s[f"{spec.opportunity}|w2"].to_numpy(dtype=float),
            k,
            prior,
        )
    qb = positions == "QB"
    prior = fit.rates.get(("QB", QB_CARRY), 0.0)
    s = sums[decay if decay is not None else 1.0][qb]
    found.loc[qb, rate_column(QB_CARRY)] = (
        prior
        if neutral
        else posterior(
            s["rushing_yards|num"].to_numpy(dtype=float),
            s["carries|w"].to_numpy(dtype=float),
            s["carries|w2"].to_numpy(dtype=float),
            0.0,
            prior,
        )
    )
    return found


def fit_payload(fit: Shrinkage) -> dict[str, object]:
    """The record's view of the fit: the chosen (d, k), the position's rates and the reported losses."""
    return {
        "window": list(fit.window),
        "cells": {f"{p}|{q}": {"decay": d, "k": k} for (p, q), (d, k) in fit.cells.items()},
        "position_rates": {f"{p}|{q}": v for (p, q), v in fit.rates.items()},
        "losses": {f"{p}|{q}": dict(v) for (p, q), v in fit.views.items()},
    }
