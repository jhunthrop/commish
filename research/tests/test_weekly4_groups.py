"""The seven factor groups of 2.7 and their neutral values: who a coalition neutralises, and how."""

import pandas as pd
import pytest

from research.model.weekly4.groups import GROUPS, league_means, neutralise


def _rows() -> pd.DataFrame:
    return pd.DataFrame(
        {
            "season": [2023, 2023],
            "week": [7, 7],
            "club": ["AAA", "BBB"],
            "share_season_targets": [0.2, 0.1],
            "share_last_three_targets": [0.3, 0.05],
            "share_decay_0_7_targets": [0.25, 0.08],
            "snap_season": [0.8, 0.5],
            "snap_last_three": [0.9, 0.4],
            "snap_trend": [0.1, -0.1],
            "vacated_targets": [0.1, 0.0],
            "returning_targets": [0.0, 0.2],
            "returning_teammates": [0, 1],
            "vacating_teammates": [1, 0],
            "allowance_targets": [1.2, 0.9],
            "allow_target_ppr": [0.3, -0.2],
            "opponent_pass_rate_allowed": [2.0, -1.0],
            "opponent_sack_rate": [0.08, 0.05],
            "implied_points": [27.0, 20.0],
            "opponent_implied_points": [20.0, 27.0],
            "spread": [7.0, -7.0],
            "roof": ["outdoors", "outdoors"],
            "indoor": [0.0, 0.0],
            "temperature_f": [30.0, 30.0],
            "wind_mph": [18.0, 18.0],
            "precipitation": [1.0, 1.0],
            "home": [1.0, 0.0],
            "rest_days": [10.0, 6.0],
        }
    )


def test_the_groups_are_the_seven_named() -> None:
    assert GROUPS == ("role", "teammates", "matchup", "game", "weather", "home_rest", "efficiency")


def test_role_takes_his_last_three_equal_to_his_season() -> None:
    found = neutralise(_rows(), {"role"}, league_means(_rows()))
    assert list(found["share_last_three_targets"]) == [0.2, 0.1]
    assert list(found["share_decay_0_7_targets"]) == [0.2, 0.1]
    assert list(found["snap_trend"]) == [0.0, 0.0]


def test_teammates_matchup_game_weather_and_home() -> None:
    rows = _rows()
    means = league_means(rows)
    found = neutralise(rows, {"teammates", "matchup", "game", "weather"}, means)
    assert list(found["vacated_targets"]) == [0.0, 0.0]
    assert list(found["returning_teammates"]) == [0, 0]
    assert list(found["allowance_targets"]) == [1.0, 1.0]
    assert list(found["allow_target_ppr"]) == [0.0, 0.0]
    assert list(found["opponent_pass_rate_allowed"]) == [0.0, 0.0]
    assert list(found["opponent_sack_rate"]) == pytest.approx([0.065, 0.065])
    assert list(found["implied_points"]) == [means["implied_points"]] * 2
    assert list(found["spread"]) == [0.0, 0.0]
    assert list(found["roof"]) == ["dome", "dome"]
    assert list(found["wind_mph"]) == [0.0, 0.0]
    home = neutralise(rows, {"home_rest"}, means, home=1.0)
    assert list(home["home"]) == [1.0, 1.0]
    assert list(home["rest_days"]) == [7.0, 7.0]


def test_an_empty_coalition_changes_nothing() -> None:
    rows = _rows()
    pd.testing.assert_frame_equal(neutralise(rows, set(), league_means(rows)), rows)
