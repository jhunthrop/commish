# ruff: noqa: PLR2004 - hand-made cases
"""The play-level expected-points model (2.3): each kind's sub-models, xFP in each format from the
catch, yards and touchdown terms, and the forward-chained fits (a season's plays priced by the model
fitted on the seasons before it)."""

import numpy as np
import pandas as pd
import pytest

from research.model.weekly4.play_model import (
    SUBMODELS,
    actual_points,
    fit_play_models,
    play_matrix,
    price,
    scramble,
    targets_of,
    xfp_columns,
)
from research.model.weekly4.tuning import Cell


def _plays(seasons: tuple[int, ...], per: int = 240, seed: int = 0) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    rows = []
    for season in seasons:
        for i in range(per):
            kind = ("target", "carry", "dropback")[i % 3]
            yard = float(rng.integers(1, 99))
            complete = float(rng.random() < 0.6) if kind != "carry" else np.nan
            rows.append(
                {
                    "season": season,
                    "week": 1 + i % 17,
                    "game_id": f"{season}_{i % 17}",
                    "play_id": i,
                    "kind": kind,
                    "player_id": f"p{i % 7}",
                    "posteam": "AAA",
                    "defteam": "BBB",
                    "down": float(1 + i % 4),
                    "ydstogo": 10.0,
                    "yardline_100": yard,
                    "air_yards": float(rng.integers(-3, 30)) if kind == "target" else np.nan,
                    "pass_location": ("left", "middle", "right")[i % 3] if kind != "carry" else None,
                    "run_location": "left" if kind == "carry" else None,
                    "run_gap": "end" if kind == "carry" else None,
                    "roof": "outdoors",
                    "indoor": 0.0,
                    "temperature_f": 60.0,
                    "wind_mph": float(i % 20),
                    "precipitation": 0.0,
                    "complete_pass": complete,
                    "yards_gained": float(rng.integers(-2, 25)),
                    "touchdown": float(yard < 8 and rng.random() < 0.5),
                    "interception": 0.0 if kind != "dropback" else float(rng.random() < 0.03),
                    "sack": 0.0 if kind != "dropback" else float(rng.random() < 0.06),
                }
            )
    return pd.DataFrame(rows)


def test_each_kind_has_its_named_sub_models() -> None:
    assert set(SUBMODELS["target"]) == {"catch", "yards", "td"}
    assert set(SUBMODELS["carry"]) == {"yards", "td"}
    assert set(SUBMODELS["dropback"]) == {"complete", "pass_yards", "pass_td", "interception"}


def test_the_targets_of_a_target_count_yards_on_a_catch_only() -> None:
    plays = pd.DataFrame(
        {
            "kind": ["target", "target"],
            "complete_pass": [1.0, 0.0],
            "yards_gained": [12.0, 0.0],
            "touchdown": [1.0, 0.0],
        }
    )
    found = targets_of(plays, "target")
    assert list(found["catch"]) == [1.0, 0.0]
    assert list(found["yards"]) == [12.0, 0.0]
    assert list(found["td"]) == [1.0, 0.0]


def test_a_dropbacks_passing_touchdown_is_a_completed_one_and_a_scramble_is_its_own() -> None:
    plays = pd.DataFrame(
        {
            "kind": ["dropback"] * 4,
            "complete_pass": [1.0, 0.0, 0.0, 0.0],
            "yards_gained": [20.0, 7.0, 0.0, -6.0],
            "touchdown": [1.0, 1.0, 0.0, 0.0],
            "interception": [0.0, 0.0, 0.0, 0.0],
            "sack": [0.0, 0.0, 0.0, 1.0],
        }
    )
    found = targets_of(plays, "dropback")
    assert list(found["pass_td"]) == [1.0, 0.0, 0.0, 0.0]
    assert list(found["pass_yards"]) == [20.0, 0.0, 0.0, 0.0]
    assert list(scramble(plays)) == [False, True, False, False]


def test_xfp_in_each_format() -> None:
    priced = pd.DataFrame({"kind": ["target"], "x_catch": [0.5], "x_yards": [8.0], "x_td": [0.1]})
    found = xfp_columns(priced)
    assert found["xfp_ppr"].iloc[0] == pytest.approx(0.5 + 0.8 + 0.6)
    assert found["xfp_half"].iloc[0] == pytest.approx(0.25 + 0.8 + 0.6)
    assert found["xfp_std"].iloc[0] == pytest.approx(0.8 + 0.6)
    dropback = pd.DataFrame(
        {"kind": ["dropback"], "x_pass_yards": [7.5], "x_pass_td": [0.05], "x_interception": [0.02]}
    )
    assert xfp_columns(dropback)["xfp_ppr"].iloc[0] == pytest.approx(0.3 + 0.2 - 0.04)


def test_the_matrix_encodes_categories_with_missing_as_nan() -> None:
    plays = _plays((2016,), per=6)
    x, categorical = play_matrix(plays[plays["kind"] == "target"], "target")
    assert x.shape[1] == len(categorical)
    assert np.isnan(play_matrix(plays.assign(pass_location=None)[plays["kind"] == "target"], "target")[0]).any()


def test_each_season_is_priced_by_the_model_fitted_on_the_seasons_before_it() -> None:
    plays = _plays((2016, 2017, 2018, 2019), per=300)
    grid = (Cell(7, 0.0, 200, 50), Cell(15, 0.0, 200, 50))
    fitted = fit_play_models(plays, (2018, 2019), grid)
    assert set(fitted.models) == {2018, 2019}
    assert fitted.models[2018].trained_on == (2016, 2017)
    assert fitted.models[2019].trained_on == (2016, 2017, 2018)
    priced = price(plays[plays["season"] == 2019], fitted.models[2019])
    assert {"x_catch", "x_yards", "x_td", "xfp_ppr"} <= set(priced.columns)
    target = priced[priced["kind"] == "target"]
    assert target["x_catch"].between(0, 1).all()
    assert fitted.cells["target|catch"][2019] in grid


def test_actual_points_are_scored_as_the_xfp_is() -> None:
    plays = pd.DataFrame(
        {
            "kind": ["target", "carry", "dropback"],
            "complete_pass": [1.0, np.nan, 1.0],
            "yards_gained": [15.0, 4.0, 25.0],
            "touchdown": [1.0, 0.0, 1.0],
            "interception": [0.0, 0.0, 0.0],
            "sack": [0.0, 0.0, 0.0],
        }
    )
    found = actual_points(plays)
    assert list(found["fp_ppr"]) == pytest.approx([1 + 1.5 + 6, 0.4, 1 + 4])
    assert list(found["fp_std"]) == pytest.approx([1.5 + 6, 0.4, 1 + 4])
