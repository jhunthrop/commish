"""The analytic point (2.1 to 2.6): the club's volume chain, each player's counts as share times
volume, each opportunity's value, the touchdown reconciliation to the team model's touchdowns, the
quarterback's passing touchdowns from the club's receiving ones, and the rate m for a player with no
game this season."""

import numpy as np
import pandas as pd
import pytest

from research.model.weekly4.point import Constants, analytic_points


def _board() -> pd.DataFrame:
    base = {
        "season": 2023,
        "week": 7,
        "club": "AAA",
        "withheld": 0,
        "projected": 1,
        "default_no_game_this_season": 0,
        "rate_m_ppr": 9.0,
        "rate_m_half": 8.0,
        "rate_m_std": 7.0,
        "exp_plays": 64.0,
        "exp_dropbacks": 40.0,
        "exp_sacks": 2.0,
        "exp_rushing_touchdowns": 1.0,
        "exp_receiving_touchdowns": 1.5,
        "target_rate": 0.9,
        "residual_targets": 0.1,
        "residual_carries": 0.1,
        "residual_dropbacks": 0.0,
        "target_wx_catch": 0.6,
        "target_wx_yards": 7.0,
        "target_wx_td": 0.04,
        "carry_wx_yards": 4.0,
        "carry_wx_td": 0.03,
        "dropback_wx_pass_yards": 6.5,
        "dropback_wx_interception": 0.02,
        "target_catch_factor": 1.0,
        "target_yoe": 0.0,
        "target_td_factor": 1.0,
        "carry_yoe": 0.0,
        "carry_td_factor": 1.0,
        "dropback_yoe": 0.0,
        "dropback_scramble_rate": 0.05,
        **{f"allow_{k}_{f}": 0.0 for k in ("target", "carry", "dropback") for f in ("ppr", "half", "std")},
    }
    players = [
        ("qb", "QB", 0.0, 0.05, 1.0),
        ("wr", "WR", 0.5, 0.0, 0.0),
        ("rb", "RB", 0.4, 0.85, 0.0),
    ]
    return pd.DataFrame(
        [
            {**base, "player_id": p, "position": pos, "share_targets": t, "share_carries": c, "share_dropbacks": d}
            for p, pos, t, c, d in players
        ]
    )


CONSTANTS = Constants(scramble_yards=6.0, scramble_touchdowns=0.02, residual_target_td=0.04, residual_carry_td=0.03)


def test_the_volume_chain_and_the_counts() -> None:
    found = analytic_points(_board(), CONSTANTS)
    scrambles = (40 - 2) * 0.05
    attempts = 40 - 2 - scrambles
    assert found["team_targets"].iloc[0] == pytest.approx(attempts * 0.9)
    assert found["designed_rushes"].iloc[0] == pytest.approx(24.0)
    assert found.set_index("player_id").loc["wr", "targets"] == pytest.approx(0.5 * attempts * 0.9)


def test_the_touchdowns_reconcile_to_the_team_models() -> None:
    board = _board()
    found = analytic_points(board, CONSTANTS)
    targets = found["team_targets"].iloc[0]
    residual = 0.1 * targets * 0.04
    assert found["receiving_td"].sum() + residual * found["receiving_scale"].iloc[0] == pytest.approx(1.5)
    rushing_residual = 0.1 * 24.0 * 0.03
    assert found["rushing_td"].sum() + rushing_residual * found["rushing_scale"].iloc[0] == pytest.approx(1.0)
    qb = found.set_index("player_id").loc["qb"]
    assert qb["passing_td"] == pytest.approx(1.5 * 1.0)


def test_the_points_in_each_format_and_the_rate_for_no_game_this_season() -> None:
    board = _board()
    found = analytic_points(board, CONSTANTS).set_index("player_id")
    wr = found.loc["wr"]
    expected = wr["targets"] * (0.6 + 0.7) + 6 * wr["receiving_td"]
    assert wr["point_ppr"] == pytest.approx(expected)
    assert wr["point_ppr"] - wr["point_std"] == pytest.approx(wr["targets"] * 0.6)
    board.loc[board["player_id"] == "rb", "default_no_game_this_season"] = 1
    rb = analytic_points(board, CONSTANTS).set_index("player_id").loc["rb"]
    assert (rb["point_ppr"], rb["point_half"], rb["point_std"]) == (9.0, 8.0, 7.0)


def test_a_withheld_player_has_no_point() -> None:
    board = _board()
    board.loc[board["player_id"] == "wr", "withheld"] = 1
    board.loc[board["player_id"] == "wr", "projected"] = 0
    found = analytic_points(board, CONSTANTS).set_index("player_id")
    assert np.isnan(found["point_ppr"].to_numpy()[1])


def test_without_the_reconciliation_the_scales_are_one() -> None:
    found = analytic_points(_board(), CONSTANTS, reconcile=False)
    assert found["receiving_scale"].eq(1.0).all()
    assert found["rushing_scale"].eq(1.0).all()
