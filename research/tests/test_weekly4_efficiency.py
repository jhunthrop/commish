# ruff: noqa: PLR2004 - hand-made cases
"""The efficiency of 2.3 fitted on the fit seasons and applied at each row: the role prior (the
position mean plus a linear term in the charted signals), the moment fits per position, kind and
component, and each row's shrunk factors."""

import numpy as np
import pandas as pd
import pytest

from research.model.weekly4.efficiency import (
    COMPONENTS,
    Efficiency,
    apply_efficiency,
    fit_efficiency,
    fit_role_prior,
)
from research.model.weekly4.shrinkage import MomentFit


def test_the_components_are_the_shrunk_terms_the_point_reads() -> None:
    assert set(COMPONENTS) == {
        ("target", "yards"),
        ("target", "catch"),
        ("target", "td"),
        ("carry", "yards"),
        ("carry", "td"),
        ("dropback", "yards"),
        ("dropback", "scramble"),
    }


def test_the_role_prior_is_a_weighted_line_in_the_charted_signals() -> None:
    rows = pd.DataFrame({"position": ["WR"] * 4, "sep": [1.0, 2.0, 3.0, np.nan], "default_no_sep": [0, 0, 0, 1]})
    outcome = pd.DataFrame({"yards_over": [1.0, 2.0, 3.0, 0.0], "n": [5.0, 5.0, 5.0, 5.0]})
    prior = fit_role_prior(rows, outcome, ("sep",))
    found = prior.predict(pd.DataFrame({"position": ["WR", "WR"], "sep": [2.5, np.nan], "default_no_sep": [0, 1]}))
    assert found[0] == pytest.approx(2.5 / 5)  # the sums over five opportunities each
    assert found[1] == pytest.approx(0.0)


def _plays(per: int = 50) -> pd.DataFrame:
    rng = np.random.default_rng(1)
    rows = []
    for player in range(20):
        skill = rng.normal(0, 0.1)
        for i in range(per):
            rows.append(
                {
                    "season": 2021,
                    "week": 1 + i % 17,
                    "player_id": f"p{player}",
                    "kind": "target",
                    "h_n": 1.0,
                    "h_catch": float(rng.random() < 0.6 + skill),
                    "h_xcatch": 0.6,
                    "h_yards_over": float(rng.normal(skill * 10, 5)),
                    "h_td": float(rng.random() < 0.05),
                    "h_xtd": 0.05,
                    "h_scrambles": 0.0,
                    "h_not_sacked": 0.0,
                    "h_interceptions": 0.0,
                    "h_xinterceptions": 0.0,
                }
            )
    return pd.DataFrame(rows)


def test_the_moment_fits_are_per_position_kind_and_component() -> None:
    plays = _plays()
    positions = {f"p{i}": "WR" for i in range(20)}
    fitted = fit_efficiency(plays, positions)
    catch = fitted.cells[("WR", "target", "catch")]
    assert catch.mean == pytest.approx(plays["h_catch"].mean() - 0.6)
    assert catch.units == 20
    assert ("WR", "target", "yards") in fitted.cells
    assert fitted.cells[("WR", "target", "td")].mean == pytest.approx(plays["h_td"].sum() / plays["h_xtd"].sum())


def test_a_row_without_history_takes_the_prior_and_a_long_history_moves_toward_its_own() -> None:
    cells = {
        ("WR", "target", "catch"): MomentFit(0.02, 0.004, 0.24, 50),
        ("WR", "target", "yards"): MomentFit(0.0, 0.5, 60.0, 50),
        ("WR", "target", "td"): MomentFit(1.0, 0.2, 1.0, 50),
    }
    efficiency = Efficiency(cells, {})
    rows = pd.DataFrame(
        {
            "position": ["WR", "WR"],
            "target_n": [0.0, 200.0],
            "target_catch": [0.0, 150.0],
            "target_xcatch": [0.0, 120.0],
            "target_yards_over": [0.0, 400.0],
            "target_td": [0.0, 20.0],
            "target_xtd": [0.0, 10.0],
            "target_wx_catch": [0.6, 0.6],
            "role_prior_target": [0.0, 0.0],
        }
    )
    found = apply_efficiency(rows, efficiency)
    assert found.loc[0, "target_catch_factor"] == pytest.approx((0.6 + 0.02) / 0.6)
    assert found.loc[0, "target_yoe"] == pytest.approx(0.0)
    assert found.loc[0, "target_td_factor"] == pytest.approx(1.0)
    assert found["target_catch_factor"].to_numpy()[1] > found["target_catch_factor"].to_numpy()[0]
    assert 0.0 < found["target_yoe"].to_numpy()[1] < 2.0
    assert 1.0 < found["target_td_factor"].to_numpy()[1] < 2.0
