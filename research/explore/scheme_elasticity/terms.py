"""THE ELASTICITY TERMS OF PLAN SECTION 5, point in time.

For a week W of season s every input reads only plays before W: the defence rates this season's
weeks before W (shrunk toward the league with R4 2.4's 6-game construction), the player splits his
history (this season before W, plus 2022 whole when s is 2023), shrunk with R4 2.3's empirical-Bayes
closed form (`weekly4.shrinkage`).

A term's multiplier: m = 1 + s_i x (min(1, r_i x r_D / r_league) - r_i) x d_post / e_i, capped to
[0.80, 1.25]; the play-action term m = 1 + s_i x (ratio - 1) with the defence-side ratio. A term with
fewer than 10 opportunities in the smaller arm of the player's history, or e_i <= 0, is 1 (fallback).
"""

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Final

import numpy as np
import pandas as pd

from research.model.weekly3.allowance import ALLOWANCE_PRIOR_GAMES
from research.model.weekly4.shrinkage import moment_fit, normal_posterior

MIN_ARM: Final = 10
CAP_LOW: Final = 0.80
CAP_HIGH: Final = 1.25
HISTORY_SEASON: Final = 2022  # the earlier season in the window, history for 2023 rows
TERMS: Final = ("blitz", "pressure", "play_action", "man_zone", "box")
TERM_POSITIONS: Final[Mapping[str, str]] = {
    "blitz": "QB", "pressure": "QB", "play_action": "QB", "man_zone": "WR,TE", "box": "RB",
}  # fmt: skip


def history(frame: pd.DataFrame, season: int, week: int) -> pd.DataFrame:
    """The player's window: season `season` before `week`, plus 2022 whole for a 2023 week."""
    this = (frame["season"] == season) & (frame["week"] < week)
    earlier = (frame["season"] == HISTORY_SEASON) & (season > HISTORY_SEASON)
    return frame[this | earlier]


def before(frame: pd.DataFrame, season: int, week: int) -> pd.DataFrame:
    """The defence's window: season `season` before `week` only."""
    return frame[(frame["season"] == season) & (frame["week"] < week)]


def shrink_toward(raw: float, games: int, league: float) -> float:
    return (games * raw + ALLOWANCE_PRIOR_GAMES * league) / (games + ALLOWANCE_PRIOR_GAMES)


@dataclass(frozen=True, slots=True)
class DefenceRates:
    by_defence: Mapping[str, float]
    league: float

    def of(self, defence: str) -> float:
        return self.by_defence.get(defence, self.league)


def defence_rates(window: pd.DataFrame, value: str = "condition") -> DefenceRates:
    """Each defence's mean of `value` over its plays in the window, shrunk with its games."""
    kept = window[window[value].notna()]
    if kept.empty:
        return DefenceRates({}, float("nan"))
    league = float(kept[value].mean())
    grouped = kept.groupby("defteam").agg(raw=(value, "mean"), games=("game_id", "nunique"))
    found = {str(d): shrink_toward(float(r.raw), int(r.games), league) for d, r in grouped.iterrows()}
    return DefenceRates(found, league)


@dataclass(frozen=True, slots=True)
class Splits:
    """Per player: arm counts and means, his overall mean and the shrunk split d."""

    frame: pd.DataFrame  # index player_id: n_c, n_n, mean_c, mean_n, n, mean, r, d_post
    pooled_fully: bool
    tau2: float
    prior: float


def splits(window: pd.DataFrame, shrink: bool = True) -> Splits:
    """Arm statistics per player over `window` (columns player_id, condition, points) and the
    empirical-Bayes posterior of d = mean_c - mean_n toward the pooled d."""
    kept = window[window["condition"].notna()]
    arm = pd.DataFrame(
        kept.groupby(["player_id", "condition"])["points"].agg(["count", "mean", "var"]).unstack("condition")
    )
    arm = arm.reindex(columns=pd.MultiIndex.from_product([["count", "mean", "var"], [0.0, 1.0]]))
    n_c = arm[("count", 1.0)].fillna(0.0).to_numpy()
    n_n = arm[("count", 0.0)].fillna(0.0).to_numpy()
    mean_c = arm[("mean", 1.0)].to_numpy()
    mean_n = arm[("mean", 0.0)].to_numpy()
    ss = (arm[("var", 1.0)].fillna(0.0) * np.maximum(n_c - 1, 0)) + (
        arm[("var", 0.0)].fillna(0.0) * np.maximum(n_n - 1, 0)
    )
    groups = int((n_c > 0).sum() + (n_n > 0).sum())
    dof = float(n_c.sum() + n_n.sum() - groups)
    noise = float(ss.sum() / dof) if dof > 0 else 0.0
    both = (n_c > 0) & (n_n > 0)
    prior = float(
        kept.loc[kept["condition"] == 1.0, "points"].mean() - kept.loc[kept["condition"] == 0.0, "points"].mean()
    )
    n_eff = np.where(both, n_c * n_n / np.maximum(n_c + n_n, 1.0), 0.0)
    observed = np.where(both, np.nan_to_num(mean_c) - np.nan_to_num(mean_n), 0.0)
    fit = moment_fit(observed, n_eff, noise, prior)
    # `shrink=False` is the unshrunk view added after the plan (reported, never the bar).
    posterior = normal_posterior(observed, n_eff, np.full(len(observed), prior), fit.k) if shrink else observed
    total = n_c + n_n
    frame = pd.DataFrame(
        {
            "n_c": n_c,
            "n_n": n_n,
            "mean": (np.nan_to_num(mean_c) * n_c + np.nan_to_num(mean_n) * n_n) / np.maximum(total, 1.0),
            "r": n_c / np.maximum(total, 1.0),
            "d_post": posterior,
        },
        index=arm.index,
    )
    return Splits(frame, fit.pooled_fully, fit.tau2, prior)


def capped(m: float) -> tuple[float, bool]:
    bounded = min(max(m, CAP_LOW), CAP_HIGH)
    return bounded, bounded != m


@dataclass(frozen=True, slots=True)
class TermValue:
    m: float
    used: bool
    capped: bool


FALLBACK: Final = TermValue(1.0, False, False)


def usable(row: pd.Series) -> bool:
    return bool(min(row["n_c"], row["n_n"]) >= MIN_ARM and row["mean"] > 0)


def mix_multiplier(row: pd.Series, share: float, opponent_rate: float, league_rate: float) -> TermValue:
    """m = 1 + s_i x (min(1, r_i x r_D / r_league) - r_i) x d_post / e_i, capped."""
    if not usable(row) or not np.isfinite(opponent_rate) or not league_rate > 0:
        return FALLBACK
    r_i = float(row["r"])
    against = min(1.0, r_i * opponent_rate / league_rate)
    value, was_capped = capped(1.0 + share * (against - r_i) * float(row["d_post"]) / float(row["mean"]))
    return TermValue(value, True, was_capped)


def play_action_multiplier(
    row: pd.Series, share: float, allowed_pa: float, allowed_np: float, league_share: float
) -> TermValue:
    """m = 1 + s_i x (ratio - 1), ratio = [(1 - p_i) a_np + p_i a_pa] / [(1 - p_lg) a_np + p_lg a_pa]."""
    if not usable(row):
        return FALLBACK
    p_i = float(row["r"])
    league_mix = (1.0 - league_share) * allowed_np + league_share * allowed_pa
    if not league_mix > 0:
        return FALLBACK
    ratio = ((1.0 - p_i) * allowed_np + p_i * allowed_pa) / league_mix
    value, was_capped = capped(1.0 + share * (ratio - 1.0))
    return TermValue(value, True, was_capped)
