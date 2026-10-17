# ruff: noqa: PLR2004 - hand-made cases
"""The team model (2.5): eight Poisson targets per club-game from the game terms, forward-chained by
season, plays and touchdowns never falling as the implied points rise."""

import numpy as np
import pandas as pd

from research.model.weekly4.team_model import (
    MONOTONE_IN_IMPLIED,
    TEAM_FEATURES,
    TEAM_TARGETS,
    fit_team_models,
    predict_team,
)
from research.model.weekly4.tuning import Cell


def _teams(seasons: tuple[int, ...], per: int = 160, seed: int = 0) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    rows = []
    for season in seasons:
        for i in range(per):
            implied = float(rng.uniform(14, 32))
            row: dict[str, object] = dict.fromkeys(TEAM_FEATURES, 0.0)
            row.update(
                {
                    "season": season,
                    "week": 1 + i % 17,
                    "club": f"C{i % 32}",
                    "implied_points": implied,
                    "opponent_implied_points": 46 - implied,
                    "spread": 2 * implied - 46,
                    "roof": "outdoors",
                    "wind_mph": float(i % 20),
                }
            )
            for target in TEAM_TARGETS:
                row[target] = float(rng.poisson(1 + implied / 10))
            row["plays"] = float(rng.poisson(50 + implied / 2))
            rows.append(row)
    return pd.DataFrame(rows)


def test_the_targets_and_the_constraints_are_the_preregistrations() -> None:
    assert TEAM_TARGETS == (
        "plays",
        "dropbacks",
        "sacks",
        "scrambles",
        "designed_rushes",
        "team_targets",
        "rushing_touchdowns",
        "receiving_touchdowns",
    )
    assert set(MONOTONE_IN_IMPLIED) == {"plays", "rushing_touchdowns", "receiving_touchdowns"}
    assert {"implied_points", "opponent_implied_points", "spread", "home", "rest_days", "roof"} <= set(TEAM_FEATURES)


def test_each_season_reads_the_model_fitted_before_it_and_touchdowns_rise_with_the_implied_points() -> None:
    teams = _teams((2016, 2017, 2018))
    grid = (Cell(7, 0.0, 200, 50),)
    fitted = fit_team_models(teams, (2018,), grid)
    assert fitted.models[2018].trained_on == (2016, 2017)
    frame = teams[teams["season"] == 2018].head(1)
    low = predict_team(frame.assign(implied_points=14.0), fitted.models[2018])
    high = predict_team(frame.assign(implied_points=32.0), fitted.models[2018])
    for target in MONOTONE_IN_IMPLIED:
        assert high[f"exp_{target}"].iloc[0] >= low[f"exp_{target}"].iloc[0]
    assert (predict_team(frame, fitted.models[2018])[[f"exp_{t}" for t in TEAM_TARGETS]] > 0).all(axis=None)
