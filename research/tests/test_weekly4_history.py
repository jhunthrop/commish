# ruff: noqa: PLR2004 - hand-made cases
"""A player's opportunity history at a row (2.3): decayed over his games this season before W and last
season, age counted in his games, and the week's expected value per opportunity re-priced with the
week's weather over this season's opportunities only."""

import numpy as np
import pandas as pd
import pytest

from research.model.weekly4.history import decayed_history, repriced, with_outcomes


def _play(season: int, week: int, kind: str, **values: float) -> dict[str, object]:
    base: dict[str, object] = {
        "season": season,
        "week": week,
        "game_id": f"{season}_{week}",
        "kind": kind,
        "player_id": "p",
        "complete_pass": 1.0,
        "yards_gained": 10.0,
        "touchdown": 0.0,
        "interception": 0.0,
        "sack": 0.0,
        "x_catch": 0.5,
        "x_yards": 6.0,
        "x_td": 0.1,
    }
    base.update(values)
    return base


def _rows(week: int) -> pd.DataFrame:
    return pd.DataFrame({"season": [2022], "week": [week], "player_id": ["p"]})


def test_the_ages_count_his_games_backward_from_the_week_across_both_seasons() -> None:
    plays = with_outcomes(
        pd.DataFrame(
            [
                _play(2021, 16, "target", yards_gained=20.0),  # age 2
                _play(2022, 2, "target", yards_gained=0.0, complete_pass=0.0),  # age 1
                _play(2022, 3, "target"),  # age 0
                _play(2022, 5, "target"),  # week W: not history
                _play(2020, 1, "target"),  # two seasons back: not history
            ]
        )
    )
    found = decayed_history(_rows(5), plays, decay=0.5)
    row = found.iloc[0]
    assert row["target_n"] == pytest.approx(1 + 0.5 + 0.25)
    assert row["target_catch"] == pytest.approx(1 + 0 + 0.25)
    assert row["target_xcatch"] == pytest.approx(0.5 * 1.75)
    # yards over expected: (10 - 6) + 0.5 * (0 - 6) + 0.25 * (20 - 6)
    assert row["target_yards_over"] == pytest.approx(4 - 3 + 3.5)
    assert row["target_n_this_season"] == pytest.approx(1.5)


def test_no_history_is_zero_counts() -> None:
    plays = with_outcomes(pd.DataFrame([_play(2022, 7, "target")]))
    found = decayed_history(_rows(5), plays, decay=0.85)
    assert found.iloc[0]["target_n"] == 0.0
    assert found.iloc[0]["carry_n"] == 0.0


def test_the_outcomes_of_a_dropback_count_a_scramble_and_the_snaps_without_a_sack() -> None:
    plays = with_outcomes(
        pd.DataFrame(
            [
                _play(2022, 1, "dropback", complete_pass=0.0, yards_gained=8.0, x_pass_yards=5.0),
                _play(2022, 1, "dropback", complete_pass=0.0, yards_gained=-7.0, sack=1.0, x_pass_yards=0.0),
            ]
        )
    )
    found = decayed_history(_rows(2), plays, decay=1.0).iloc[0]
    assert found["dropback_n"] == 2.0
    assert found["dropback_scrambles"] == 1.0
    assert found["dropback_not_sacked"] == 1.0
    assert found["dropback_yards_over"] == pytest.approx(-5.0)
    assert np.isfinite(found["dropback_n"])


def _windy_pricer(plays: pd.DataFrame, season: int) -> pd.DataFrame:
    """A play model whose catch probability is the wind over 100 and whose yards are the season."""
    return plays.assign(x_catch=plays["wind_mph"] / 100.0, x_yards=float(season), x_td=0.0)


def test_the_week_reprices_this_seasons_opportunities_with_its_own_weather() -> None:
    plays = pd.DataFrame(
        [
            _play(2021, 10, "target", wind_mph=0.0),  # last season: not re-priced
            _play(2022, 1, "target", wind_mph=0.0),
            _play(2022, 2, "target", wind_mph=5.0),
        ]
    ).assign(roof="outdoors", temperature_f=60.0, precipitation=0.0)
    rows = pd.DataFrame(
        {
            "season": [2022, 2022],
            "week": [3, 1],
            "player_id": ["p", "p"],
            "position": ["WR", "WR"],
            "roof": ["outdoors", "dome"],
            "temperature_f": [40.0, 70.0],
            "wind_mph": [20.0, 0.0],
            "precipitation": [1.0, 0.0],
        }
    )
    fallback = {("WR", "target"): {"catch": 0.6, "yards": 7.0, "td": 0.05}}
    found = repriced(rows, plays, 0.5, _windy_pricer, fallback)
    assert found.loc[0, "target_wx_catch"] == pytest.approx(0.2)  # both re-priced in the week's 20 mph
    assert found.loc[0, "target_wx_yards"] == pytest.approx(2022.0)
    assert found.loc[1, "target_wx_catch"] == pytest.approx(0.6)  # week 1: no history this season
    assert found.loc[1, "carry_wx_yards"] != found.loc[1, "carry_wx_yards"]  # no fallback cell: NaN
