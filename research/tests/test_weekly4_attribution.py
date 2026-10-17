"""The attributions of 2.7: exact Shapley values that sum to the point less the neutral point, and the
player-alone closed form that, with nothing neutralised, is the analytic point itself."""

import numpy as np
import pytest

from research.model.weekly4.attribution import _player_alone, shapley, subsets
from research.model.weekly4.groups import GROUPS
from research.model.weekly4.point import analytic_points
from research.tests.test_weekly4_point import CONSTANTS, _board


def test_the_values_sum_to_the_point_less_the_neutral_point() -> None:
    rng = np.random.default_rng(0)
    values = {s: np.array([rng.normal()]) for s in subsets(GROUPS)}
    found = shapley(values)
    total = np.sum(list(found.values()), axis=0)
    assert total[0] == pytest.approx(values[frozenset(GROUPS)][0] - values[frozenset()][0])


def test_an_additive_function_gives_each_group_its_own_part() -> None:
    weights = {g: float(i + 1) for i, g in enumerate(GROUPS)}
    values = {s: np.array([sum(weights[g] for g in s)]) for s in subsets(GROUPS)}
    found = shapley(values)
    for g in GROUPS:
        assert found[g][0] == pytest.approx(weights[g])


def test_with_nothing_neutralised_the_player_alone_point_is_the_analytic_point() -> None:
    board = _board()
    board = board.join(
        analytic_points(board, CONSTANTS).drop(columns=["season", "week", "club", "player_id", "position"])
    )
    board = board.assign(
        **{f"model_{k}": board[f"share_{k}"] for k in ("targets", "carries", "dropbacks")},
        residual_target_td=CONSTANTS.residual_target_td,
        residual_carry_td=CONSTANTS.residual_carry_td,
    )
    model = {k: board[f"model_{k}"].to_numpy() for k in ("targets", "carries", "dropbacks")}
    found = _player_alone(board, model, board, board, CONSTANTS.scramble_touchdowns, CONSTANTS.scramble_yards)
    for name in ("ppr", "half", "std"):
        assert list(found[name]) == pytest.approx(list(board[f"point_{name}"]))
