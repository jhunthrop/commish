"""THE POINT: the analytic mean of steps 1 to 5 of preregistration section 2.1, deterministic.

**The club's volume** (2.5, 2.6): the team model's expected plays P, dropbacks D and sacks S; then
the simulation's chain in expectation, so the point is the mean of the same system the simulation
draws: scrambles Sc = (D - S) x the starter's shrunk scramble rate, pass attempts A = D - S - Sc, team
targets T = A x the club's season-to-date share of attempts with a targeted receiver, designed rushes
R = P - D.

**The player's counts** (2.2): his normalised share of each kind times its volume: targets, carries
(of R), dropbacks (of D); his sacks and scrambles are his dropback share of the club's.

**The value of each opportunity** (2.3, 2.4): the week's re-priced expected value, his shrunk
efficiency, the opponent's value allowance: a target is worth the reception value times his catch
probability (the week's times his shrunk catch factor) plus (expected yards plus his yards over
expected) over ten, plus the allowance; a carry (expected yards plus over expected) over ten plus the
allowance; a dropback (expected passing yards plus over expected) over 25 less two per expected
interception plus the allowance; a scramble the training seasons' yards per scramble over ten.

**The touchdowns** (2.6, the identities): each player's expected touchdowns are xTD times his shrunk
touchdown factor; the club's receiving touchdowns over its players and the residual are scaled to the
team model's receiving touchdowns, its rushing touchdowns (carries and scrambles) to its rushing
touchdowns, one scale per club, kind and game. The quarterback's passing touchdowns are the club's
receiving touchdowns times his dropback share. Yards and receptions are not scaled.

**Defaults** (2.10): a withheld player has no point; a player with no game this season takes the rate
m in each format.
"""

from dataclasses import dataclass
from typing import Final, Literal

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

GAME: Final = ["season", "week", "club"]


@dataclass(frozen=True, slots=True)
class Constants:
    """The fitted constants the point reads beside the models: a scramble's mean yards and touchdowns
    (the play model's training seasons) and the residual players' expected touchdowns per target and
    per carry (the fit rows' mean)."""

    scramble_yards: float
    scramble_touchdowns: float
    residual_target_td: float
    residual_carry_td: float


def _per_game(board: pd.DataFrame, values: np.ndarray, how: Literal["sum", "max"]) -> np.ndarray:
    grouped = pd.Series(values, index=board.index).groupby([board[c] for c in GAME])
    found: np.ndarray = grouped.transform(how).to_numpy(dtype=float)
    return found


def _starter_scramble_rate(board: pd.DataFrame) -> np.ndarray:
    """The club's projected quarterback with the largest dropback share: his shrunk scramble rate."""
    share = np.where(board["withheld"].to_numpy() == 0, board["share_dropbacks"].to_numpy(dtype=float), -1.0)
    best = _per_game(board, share, "max")
    rate = board["dropback_scramble_rate"].to_numpy(dtype=float)
    is_starter = (share == best) & (board["position"].to_numpy() == "QB") & (share >= 0)
    starter = _per_game(board, np.where(is_starter, rate, np.nan), "max")
    return np.where(np.isnan(starter), np.nanmean(rate) if np.isfinite(rate).any() else 0.0, starter)


def volumes(board: pd.DataFrame) -> pd.DataFrame:
    """The club's chain in expectation, per row."""
    plays = board["exp_plays"].to_numpy(dtype=float)
    dropbacks = np.minimum(board["exp_dropbacks"].to_numpy(dtype=float), plays)
    sacks = np.minimum(board["exp_sacks"].to_numpy(dtype=float), dropbacks)
    scramble_rate = _starter_scramble_rate(board)
    scrambles = (dropbacks - sacks) * scramble_rate
    attempts = dropbacks - sacks - scrambles
    return pd.DataFrame(
        {
            "team_plays": plays,
            "team_dropbacks": dropbacks,
            "sack_rate": np.where(dropbacks > 0, sacks / np.maximum(dropbacks, 1e-9), 0.0),
            "scramble_rate": scramble_rate,
            "team_scrambles": scrambles,
            "pass_attempts": attempts,
            "team_targets": attempts * board["target_rate"].to_numpy(dtype=float),
            "designed_rushes": np.maximum(plays - dropbacks, 0.0),
        },
        index=board.index,
    )


def _scale(board: pd.DataFrame, players: np.ndarray, residual: np.ndarray, team: np.ndarray, on: bool) -> np.ndarray:
    total = _per_game(board, players, "sum") + residual
    return np.where(on & (total > 0), team / np.maximum(total, 1e-12), 1.0)


def analytic_points(board: pd.DataFrame, constants: Constants, reconcile: bool = True) -> pd.DataFrame:
    """Each row's counts, touchdowns and point in each format (`point_<format>`); NaN when withheld."""
    v = volumes(board)
    projected = board["withheld"].to_numpy() == 0

    def col(name: str) -> np.ndarray:
        return board[name].to_numpy(dtype=float)

    targets = np.where(projected, col("share_targets"), 0.0) * v["team_targets"].to_numpy()
    carries = np.where(projected, col("share_carries"), 0.0) * v["designed_rushes"].to_numpy()
    drop_share = np.where(projected, col("share_dropbacks"), 0.0)
    dropbacks = drop_share * v["team_dropbacks"].to_numpy()
    scrambles = drop_share * v["team_scrambles"].to_numpy()
    receiving_xtd = targets * col("target_wx_td") * col("target_td_factor")
    rushing_xtd = carries * col("carry_wx_td") * col("carry_td_factor") + scrambles * constants.scramble_touchdowns
    residual_receiving = col("residual_targets") * v["team_targets"].to_numpy() * constants.residual_target_td
    residual_rushing = (
        col("residual_carries") * v["designed_rushes"].to_numpy() * constants.residual_carry_td
        + col("residual_dropbacks") * v["team_scrambles"].to_numpy() * constants.scramble_touchdowns
    )
    receiving_scale = _scale(board, receiving_xtd, residual_receiving, col("exp_receiving_touchdowns"), reconcile)
    rushing_scale = _scale(board, rushing_xtd, residual_rushing, col("exp_rushing_touchdowns"), reconcile)
    receiving_td = receiving_xtd * receiving_scale
    rushing_td = rushing_xtd * rushing_scale
    passing_td = (
        col("exp_receiving_touchdowns") * drop_share
        if reconcile
        else _unreconciled_passing(board, receiving_xtd, residual_receiving, drop_share)
    )
    catch = np.clip(col("target_wx_catch") * col("target_catch_factor"), 0.0, 1.0)
    found = (
        board[["season", "week", "club", "player_id", "position"]]
        .join(v)
        .assign(
            targets=targets,
            carries=carries,
            dropbacks=dropbacks,
            scrambles=scrambles,
            catch_probability=catch,
            receiving_td=receiving_td,
            rushing_td=rushing_td,
            passing_td=passing_td,
            receiving_scale=receiving_scale,
            rushing_scale=rushing_scale,
        )
    )
    rate_only = col("default_no_game_this_season") == 1
    for name in FORMAT_NAMES:
        per_target = (
            RECEPTION_VALUE[name] * catch
            + (col("target_wx_yards") + col("target_yoe")) / YARDS_PER_POINT
            + col(f"allow_target_{name}")
        )
        per_carry = (col("carry_wx_yards") + col("carry_yoe")) / YARDS_PER_POINT + col(f"allow_carry_{name}")
        per_dropback = (
            (col("dropback_wx_pass_yards") + col("dropback_yoe")) / PASSING_YARDS_PER_POINT
            + INTERCEPTION * col("dropback_wx_interception")
            + col(f"allow_dropback_{name}")
        )
        point = (
            targets * per_target
            + carries * per_carry
            + dropbacks * per_dropback
            + scrambles * constants.scramble_yards / YARDS_PER_POINT
            + TOUCHDOWN * (receiving_td + rushing_td)
            + PASSING_TOUCHDOWN * passing_td
        )
        point = np.where(rate_only, col(f"rate_m_{name}"), point)
        found[f"point_{name}"] = np.where(projected, point, np.nan)
    return found


def _unreconciled_passing(
    board: pd.DataFrame, receiving_xtd: np.ndarray, residual: np.ndarray, drop_share: np.ndarray
) -> np.ndarray:
    """Without the reconciliation (an ablation): the club's receivers' expected touchdowns, unscaled,
    times his dropback share."""
    found: np.ndarray = (_per_game(board, receiving_xtd, "sum") + residual) * drop_share
    return found
