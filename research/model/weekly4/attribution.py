"""THE WHY, FROM THE MODEL'S OWN ATTRIBUTIONS (preregistration section 2.7): exact Shapley values of the
seven factor groups over their 2^7 = 128 coalitions of the deterministic point function.

v_i(S) is player i's point with the groups in S at their actual values and the others neutral
(`groups.neutralise`). Groups 3 to 6 enter the team model, so their neutral setting applies to the
whole club and the opponent's game, and the touchdown reconciliation is recomputed under it: the board
is rebuilt under each of their 16 neutral sets (home field's neutral the mean of the board at home 0 and
at home 1). Groups 1, 2 and 7 apply to the player alone, with his teammates' shares renormalised by the
identities: under each board, his model shares (role, teammates neutral) and his efficiency (at the role
prior) are recomputed, his teammates keep theirs, the normalisation and the touchdown scales are
recomputed with his alone changed (`_player_alone`). The values sum to the point less the neutral point.
A player on the rate m has every value 0 (his number reads no group).
"""

from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from itertools import combinations
from math import factorial
from typing import Final

import numpy as np
import pandas as pd

from research.model.weekly4.board import RoundShared, SeasonData, SeasonModels, Variant, build_board
from research.model.weekly4.efficiency import apply_efficiency
from research.model.weekly4.groups import GAME_GROUPS, GROUPS, neutral_efficiency, neutralise
from research.model.weekly4.history import STATS
from research.model.weekly4.play_model import (
    FORMAT_NAMES,
    INTERCEPTION,
    PASSING_TOUCHDOWN,
    PASSING_YARDS_PER_POINT,
    RECEPTION_VALUE,
    TOUCHDOWN,
    YARDS_PER_POINT,
)
from research.model.weekly4.share_model import predict_shares

PLAYER_GROUPS: Final = ("role", "teammates", "efficiency")
SHARE_GROUPS: Final = ("role", "teammates")
GAME: Final = ["season", "week", "club"]
KINDS: Final = ("targets", "carries", "dropbacks")


def subsets(items: Sequence[str]) -> list[frozenset[str]]:
    return [frozenset(c) for size in range(len(items) + 1) for c in combinations(items, size)]


def shapley(values: Mapping[frozenset[str], np.ndarray], groups: Sequence[str] = GROUPS) -> dict[str, np.ndarray]:
    """Each group's exact Shapley value from v(S) for every coalition S of present groups."""
    n = len(groups)
    found: dict[str, np.ndarray] = {}
    for g in groups:
        others = [x for x in groups if x != g]
        total = np.zeros_like(next(iter(values.values())))
        for coalition in subsets(others):
            weight = factorial(len(coalition)) * factorial(n - len(coalition) - 1) / factorial(n)
            total = total + weight * (values[coalition | {g}] - values[coalition])
        found[g] = total
    return found


def _sum_by_game(board: pd.DataFrame, values: np.ndarray) -> np.ndarray:
    found: np.ndarray = (
        pd.Series(values, index=board.index).groupby([board[c] for c in GAME]).transform("sum").to_numpy()
    )
    return found


def _efficiency(board: pd.DataFrame, shared: RoundShared, neutral: bool) -> pd.DataFrame:
    history_columns = [f"{kind}_{stat}" for kind, stats in STATS.items() for stat in stats]
    history = board[history_columns]
    if neutral:
        history = neutral_efficiency(history)
    priors = {f"role_prior_{k}": p.predict(board) for k, p in shared.efficiency.role_priors.items()}
    wx = [c for c in board.columns if "_wx_" in c]
    inputs = board[["position", *wx]].join(history).assign(**priors)
    return apply_efficiency(inputs, shared.efficiency)


@dataclass(frozen=True, slots=True)
class _Club:
    """A board's club-level terms per row, and each kind's sums over the projected model shares."""

    volume: Mapping[str, np.ndarray]
    model_sum: Mapping[str, np.ndarray]
    rate_sum: Mapping[str, np.ndarray]  # sum over projected of model share x touchdown rate per opportunity


def _rates(board: pd.DataFrame, eff: pd.DataFrame) -> dict[str, np.ndarray]:
    return {
        "targets": board["target_wx_td"].to_numpy() * eff["target_td_factor"].to_numpy(),
        "carries": board["carry_wx_td"].to_numpy() * eff["carry_td_factor"].to_numpy(),
    }


def _player_alone(  # noqa: PLR0913, PLR0917 - one board's closed form, every term named
    board: pd.DataFrame,
    model: Mapping[str, np.ndarray],
    eff: pd.DataFrame,
    actual_eff: pd.DataFrame,
    scramble_td: float,
    scramble_yards: float,
) -> dict[str, np.ndarray]:
    """Each row's point in each format with his own model shares `model` and efficiency `eff`, his
    teammates at the board's actual shares and efficiency, renormalised by the identities."""
    projected = board["projected"].to_numpy() == 1
    actual = {k: np.where(projected, board[f"model_{k}"].to_numpy(), 0.0) for k in KINDS}
    mine = {k: np.where(projected, model[k], 0.0) for k in KINDS}
    residual = {k: board[f"residual_{k}"].to_numpy() for k in KINDS}
    others = {k: _sum_by_game(board, actual[k]) - actual[k] for k in KINDS}
    denominator = {k: others[k] + mine[k] for k in KINDS}
    share = {
        k: np.where(denominator[k] > 0, mine[k] * (1 - residual[k]) / np.maximum(denominator[k], 1e-12), 0.0)
        for k in KINDS
    }
    targets = share["targets"] * board["team_targets"].to_numpy()
    carries = share["carries"] * board["designed_rushes"].to_numpy()
    dropbacks = share["dropbacks"] * board["team_dropbacks"].to_numpy()
    # The club's scramble rate is its starter's: his own, under his own efficiency, when he is the starter.
    starter = _is_starter(board)
    rate = np.where(starter, eff["dropback_scramble_rate"].to_numpy(), board["scramble_rate"].to_numpy())
    scrambles = dropbacks * (1.0 - board["sack_rate"].to_numpy()) * rate
    base_rates, my_rates = _rates(board, actual_eff), _rates(board, eff)
    scale = {}
    for kind, team_td, volume in (
        ("targets", "exp_receiving_touchdowns", "team_targets"),
        ("carries", "exp_rushing_touchdowns", "designed_rushes"),
    ):
        club = _sum_by_game(board, actual[kind] * base_rates[kind]) - actual[kind] * base_rates[kind]
        mates = (
            (1 - residual[kind])
            * board[volume].to_numpy()
            * np.where(denominator[kind] > 0, club / np.maximum(denominator[kind], 1e-12), 0.0)
        )
        own = share[kind] * board[volume].to_numpy() * my_rates[kind]
        if kind == "carries":
            qb_mates = (1 - residual["dropbacks"]) * np.where(
                denominator["dropbacks"] > 0, others["dropbacks"] / np.maximum(denominator["dropbacks"], 1e-12), 0.0
            )
            mates = mates + qb_mates * board["team_scrambles"].to_numpy() * scramble_td
            own = own + scrambles * scramble_td
            resid = (
                residual["carries"] * board["designed_rushes"].to_numpy() * shared_residual(board, "carry")
                + residual["dropbacks"] * board["team_scrambles"].to_numpy() * scramble_td
            )
        else:
            resid = residual["targets"] * board["team_targets"].to_numpy() * shared_residual(board, "target")
        total = mates + own + resid
        scale[kind] = np.where(total > 0, board[team_td].to_numpy() / np.maximum(total, 1e-12), 1.0)
    receiving_td = targets * my_rates["targets"] * scale["targets"]
    rushing_td = (carries * my_rates["carries"] + scrambles * scramble_td) * scale["carries"]
    passing_td = board["exp_receiving_touchdowns"].to_numpy() * share["dropbacks"]
    catch = np.clip(board["target_wx_catch"].to_numpy() * eff["target_catch_factor"].to_numpy(), 0.0, 1.0)
    found = {}
    for name in FORMAT_NAMES:
        per_target = (
            RECEPTION_VALUE[name] * catch
            + (board["target_wx_yards"].to_numpy() + eff["target_yoe"].to_numpy()) / YARDS_PER_POINT
            + board[f"allow_target_{name}"].to_numpy()
        )
        per_carry = (board["carry_wx_yards"].to_numpy() + eff["carry_yoe"].to_numpy()) / YARDS_PER_POINT + board[
            f"allow_carry_{name}"
        ].to_numpy()
        per_dropback = (
            (board["dropback_wx_pass_yards"].to_numpy() + eff["dropback_yoe"].to_numpy()) / PASSING_YARDS_PER_POINT
            + INTERCEPTION * board["dropback_wx_interception"].to_numpy()
            + board[f"allow_dropback_{name}"].to_numpy()
        )
        point = (
            targets * per_target
            + carries * per_carry
            + dropbacks * per_dropback
            + scrambles * scramble_yards / YARDS_PER_POINT
            + TOUCHDOWN * (receiving_td + rushing_td)
            + PASSING_TOUCHDOWN * passing_td
        )
        found[name] = np.where(projected, point, np.nan)
    return found


def _is_starter(board: pd.DataFrame) -> np.ndarray:
    """The club's projected quarterback with the largest dropback share (`point`'s starter)."""
    share = np.where(board["projected"].to_numpy() == 1, board["share_dropbacks"].to_numpy(dtype=float), -1.0)
    best = pd.Series(share, index=board.index).groupby([board[c] for c in GAME]).transform("max").to_numpy()
    found: np.ndarray = (share == best) & (share >= 0) & (board["position"].to_numpy() == "QB")
    return found


def shared_residual(board: pd.DataFrame, kind: str) -> np.ndarray:
    """The residual players' expected touchdowns per opportunity, carried on the board (`point.Constants`)."""
    return board[f"residual_{kind}_td"].to_numpy()


def coalition_points(
    data: SeasonData,
    models: SeasonModels,
    shared: RoundShared,
    transform: Callable[[pd.DataFrame], pd.DataFrame] | None = None,
) -> dict[frozenset[str], dict[str, np.ndarray]]:
    """v(S) for every coalition S of present groups: each row's point in each format."""
    c = models.constants
    found: dict[frozenset[str], dict[str, np.ndarray]] = {}
    for game_neutral in subsets(sorted(GAME_GROUPS)):
        homes = (0.0, 1.0) if "home_rest" in game_neutral else (None,)
        parts: dict[frozenset[str], list[dict[str, np.ndarray]]] = {}
        for home in homes:
            board = build_board(data, models, shared, Variant(groups=game_neutral, transform=transform), home=home)
            board = board.assign(residual_target_td=c.residual_target_td, residual_carry_td=c.residual_carry_td)
            actual_eff = _efficiency(board, shared, neutral=False)
            neutral_eff = _efficiency(board, shared, neutral=True)
            for share_neutral in subsets(SHARE_GROUPS):
                model = predict_shares(neutralise(board, share_neutral, {}), models.shares)
                shares = {k: model[f"model_{k}"].to_numpy() for k in KINDS}
                for efficiency_neutral in (False, True):
                    eff = neutral_eff if efficiency_neutral else actual_eff
                    neutral = game_neutral | share_neutral | ({"efficiency"} if efficiency_neutral else set())
                    present = frozenset(GROUPS) - neutral
                    point = _player_alone(board, shares, eff, actual_eff, c.scramble_touchdowns, c.scramble_yards)
                    rate_only = board["default_no_game_this_season"].to_numpy() == 1
                    point = {n: np.where(rate_only, board[f"rate_m_{n}"].to_numpy(), v) for n, v in point.items()}
                    parts.setdefault(present, []).append(point)
        for present, points in parts.items():
            found[present] = {n: np.mean([p[n] for p in points], axis=0) for n in FORMAT_NAMES}
    return found


def attributions(data: SeasonData, models: SeasonModels, shared: RoundShared) -> pd.DataFrame:
    """Per row: each group's Shapley value in each format, the neutral point and the point."""
    values = coalition_points(data, models, shared)
    rows = data.rows[["season", "week", "club", "player_id", "position"]].copy()
    for name in FORMAT_NAMES:
        by = {s: v[name] for s, v in values.items()}
        for group, value in shapley(by).items():
            rows[f"why_{group}_{name}"] = value
        rows[f"neutral_{name}"] = by[frozenset()]
        rows[f"point_{name}"] = by[frozenset(GROUPS)]
    return rows
