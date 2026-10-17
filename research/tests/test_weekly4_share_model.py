# ruff: noqa: PLR2004 - hand-made cases
"""The share models (2.2) and the identities (2.6): each position's kinds, the week's realised shares
from the plays, the residual share shrunk toward the fit mean with six games, and the projected
players' shares plus the residual summing to 1 with a withheld player's share passed on."""

import numpy as np
import pandas as pd
import pytest

from research.model.weekly4.share_model import (
    SHARE_KINDS,
    fit_share_models,
    normalised_shares,
    predict_shares,
    residual_shares,
    share_features,
    week_counts,
)
from research.model.weekly4.tuning import DECAYS, Cell


def test_each_position_models_its_kinds() -> None:
    assert SHARE_KINDS["QB"] == ("dropbacks", "carries")
    assert SHARE_KINDS["RB"] == ("targets", "carries", "air_yards", "red_zone", "inside_ten")
    assert "dropbacks" not in SHARE_KINDS["WR"]


def test_the_features_read_the_decay_the_cell_names() -> None:
    names = share_features("targets", 0.7)
    assert "share_decay_0_7_targets" in names
    assert "share_decay_0_5_targets" not in names
    assert {"share_season_carries", "vacated_targets", "returning_targets", "rate_m_ppr", "implied_points"} <= set(
        names
    )


def _plays() -> pd.DataFrame:
    rows = [
        ("target", "a", 12.0, 15.0),
        ("target", "a", 5.0, 30.0),
        ("target", "b", -2.0, 8.0),
        ("carry", "c", np.nan, 5.0),
        ("dropback", "q", np.nan, 40.0),
    ]
    return pd.DataFrame(
        [
            {
                "season": 2022,
                "week": 5,
                "posteam": "AAA",
                "kind": k,
                "player_id": p,
                "air_yards": air,
                "yardline_100": yard,
            }
            for k, p, air, yard in rows
        ]
    )


def test_the_weeks_counts_from_its_plays() -> None:
    found = week_counts(_plays()).set_index("player_id")
    assert found.loc["a", "targets"] == 2.0
    assert found.loc["a", "air_yards"] == 17.0
    assert found.loc["a", "red_zone"] == 1.0
    assert found.loc["b", "inside_ten"] == 1.0
    assert found.loc["c", "carries"] == 1.0
    assert found.loc["q", "dropbacks"] == 1.0


def test_the_residual_is_the_share_outside_the_clubs_rows_shrunk_toward_the_fit_mean() -> None:
    history = pd.DataFrame(
        {
            "season": [2022] * 4,
            "week": [1, 1, 2, 2],
            "club": ["AAA"] * 4,
            "player_id": ["a", "x", "a", "x"],
            "targets": [8.0, 2.0, 9.0, 1.0],
        }
    )
    rows = pd.DataFrame({"season": [2022], "week": [3], "club": ["AAA"], "player_id": ["a"]})
    found = residual_shares(rows, history, {"targets": 0.05}, ("targets",))
    observed = 3.0 / 20.0
    assert found.loc[0, "residual_targets"] == pytest.approx((2 * observed + 6 * 0.05) / 8)


def _fit_rows(seasons: tuple[int, ...], per: int = 120) -> pd.DataFrame:
    rng = np.random.default_rng(3)
    names = sorted({n for kind in ("targets", "carries", "dropbacks") for d in DECAYS for n in share_features(kind, d)})
    frames = []
    for season in seasons:
        frame = pd.DataFrame(rng.random((per, len(names))), columns=names).assign(
            season=season, position=rng.choice(["QB", "RB", "WR", "TE"], per), roof="outdoors"
        )
        for kind in ("targets", "carries", "air_yards", "red_zone", "inside_ten", "dropbacks"):
            frame[f"w_{kind}"] = 30.0
            frame[f"y_{kind}"] = np.clip(frame.get(f"share_last_three_{kind}", 0.1) * 0.8, 0, 1)
        frames.append(frame)
    found = pd.concat(frames, ignore_index=True)
    for kind in ("air_yards", "red_zone", "inside_ten"):
        for d in DECAYS:
            for name in share_features(kind, d):
                if name not in found:
                    found[name] = 0.1
    return found


def test_a_one_season_refit_takes_the_cell_its_next_refit_chooses() -> None:
    rows = _fit_rows((2021, 2022))
    grid = (Cell(7, 0.0, 200, 50, 0.5), Cell(7, 0.0, 200, 50, 1.0))
    fitted = fit_share_models(rows, [(2021,), (2021, 2022)], grid)
    assert fitted.models[(2021,)].cell == fitted.models[(2021, 2022)].cell
    assert fitted.models[(2021,)].trained_on == (2021,)
    shares = predict_shares(rows.head(8), fitted.models[(2021, 2022)])
    assert shares.to_numpy().min() >= 0.0
    assert (shares.loc[rows.head(8)["position"] == "QB", "model_targets"] == 0.0).all()


def test_the_shares_and_the_residual_sum_to_one_and_a_withheld_share_passes_on() -> None:
    rows = pd.DataFrame(
        {
            "season": [2022] * 3,
            "week": [3] * 3,
            "club": ["AAA"] * 3,
            "withheld": [0, 0, 1],
            "model_targets": [0.3, 0.2, 0.4],
            "residual_targets": [0.1, 0.1, 0.1],
        }
    )
    found = normalised_shares(rows, ("targets",))
    assert found["share_targets"].to_numpy()[2] == 0.0
    assert found["share_targets"].sum() + 0.1 == pytest.approx(1.0)
    assert found["share_targets"].to_numpy()[0] == pytest.approx(0.3 * 0.9 / 0.5)
