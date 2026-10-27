"""Lane 245's probe: play scoring, coverage, the sheets, the range and the bar."""

from typing import Any

import numpy as np
import pandas as pd
import pytest

from research.explore.scheme_elasticity.bar import AMEND, DROP, HOLD, evaluate
from research.explore.scheme_elasticity.baseline import damped, form_of
from research.explore.scheme_elasticity.coverage import coverage
from research.explore.scheme_elasticity.measure import calibration, week_key
from research.explore.scheme_elasticity.plays import on_field, play_points, scheme_flags
from research.explore.scheme_elasticity.terms import TERMS
from research.model.weekly4.scoring import Row

_PLAY = {
    "season": 2022, "week": 1, "game_id": "g", "posteam": "A", "defteam": "B", "qb_dropback": True,
    "qb_scramble": False, "rush_attempt": False, "pass_attempt": True, "sack": False,
    "two_point_attempt": False, "qb_kneel": False, "qb_spike": False, "passer_player_id": "qb",
    "rusher_player_id": None, "receiver_player_id": "wr", "yards_gained": 25.0, "complete_pass": True,
    "interception": False, "fumble_lost": False, "pass_touchdown": True, "rush_touchdown": False,
    "td_player_id": "wr", "defenders_in_box": None, "n_defense_box": 8.0, "pass_rushers": 4.0,
    "offense_players": "qb;wr;te", "was_pressure": True, "man_zone": "MAN_COVERAGE",
    "coverage_type": "COVER_1", "n_blitzers": 2.0, "n_pass_rushers": 5.0, "is_play_action": False,
    "is_screen_pass": False,
}  # fmt: skip


def _plays(*changes: dict[str, Any]) -> pd.DataFrame:
    return pd.DataFrame([{**_PLAY, "play_id": i, **c} for i, c in enumerate(changes)])


def test_a_touchdown_pass_scores_for_both_roles_and_the_flags_are_set() -> None:
    scored = play_points(scheme_flags(_plays({})))
    row = scored.iloc[0]
    assert row["qb_points"] == pytest.approx(25 * 0.04 + 4)
    assert row["receiver_points"] == pytest.approx(1 + 2.5 + 6)
    assert (row["blitz"], row["pressure"], row["man"], row["box_heavy"]) == (1.0, 1.0, 1.0, 1.0)
    assert row["qb_id"] == "qb"


def test_a_sack_scores_nothing_and_a_scramble_scores_as_a_run_for_the_quarterback() -> None:
    sack = {"sack": True, "pass_attempt": False, "complete_pass": False, "yards_gained": -7.0, "pass_touchdown": False}
    scramble = {
        "qb_scramble": True, "pass_attempt": False, "complete_pass": False, "passer_player_id": None,
        "rusher_player_id": "qb", "receiver_player_id": None, "yards_gained": 12.0, "pass_touchdown": False,
    }  # fmt: skip
    scored = play_points(scheme_flags(_plays(sack, scramble)))
    assert scored["qb_points"].tolist() == pytest.approx([0.0, 1.2])
    assert scored["qb_id"].tolist() == ["qb", "qb"]
    assert scored["receiver_points"].tolist() == [0.0, 0.0]


def test_an_interception_and_a_missing_scheme_value_stay_what_they_are() -> None:
    pick = {
        "complete_pass": False, "interception": True, "pass_touchdown": False, "was_pressure": None,
        "man_zone": None, "n_blitzers": 0.0,
    }  # fmt: skip
    row = play_points(scheme_flags(_plays(pick))).iloc[0]
    assert row["qb_points"] == pytest.approx(-2.0)
    assert row["blitz"] == 0.0
    assert np.isnan(row["pressure"])
    assert np.isnan(row["man"])


def test_every_player_on_the_field_has_the_opportunity_and_only_the_target_scores() -> None:
    found = on_field(play_points(scheme_flags(_plays({}))))
    by = dict(zip(found["player_id"], found["points"], strict=True))
    assert by == {"qb": 0.0, "wr": pytest.approx(9.5), "te": 0.0}


def test_coverage_counts_populated_values_per_season() -> None:
    roles = [
        "season",
        "week",
        "game_id",
        "play_id",
        "qb_dropback",
        "rush_attempt",
        "two_point_attempt",
        "qb_kneel",
        "qb_spike",
    ]
    plays = _plays({}, {})[roles]
    participation = pd.DataFrame(
        {
            "season": [2022, 2022], "game_id": ["g", "g"], "play_id": [0, 1],
            "was_pressure": [True, None], "man_zone": ["MAN_COVERAGE", None], "coverage_type": [None, None],
            "pass_rushers": [4.0, 4.0], "offense_players": ["a", "b"], "defenders_in_box": [6.0, 7.0],
        }
    )  # fmt: skip
    ftn = pd.DataFrame(
        {
            "season": [2022, 2022], "week": [1, 1], "game_id": ["g", "g"], "play_id": [0, 1],
            "n_blitzers": [1.0, 0.0], "is_play_action": [False, True], "n_defense_box": [6.0, 7.0],
        }
    )  # fmt: skip
    found = coverage(plays, participation, ftn).set_index("column")
    assert found.loc["participation.was_pressure", "share"] == pytest.approx(0.5)
    assert found.loc["ftn.n_blitzers", "populated"] == len(ftn)


def test_form_is_this_seasons_mean_before_the_week_else_last_seasons() -> None:
    this = pd.DataFrame(
        {
            "week": [1, 2, 6],
            "player_id": ["a", "a", "a"],
            "ppr": [10.0, 20.0, 99.0],
            "half": [1.0] * 3,
            "std": [1.0] * 3,
        }
    )
    last = pd.DataFrame({"week": [1], "player_id": ["b"], "ppr": [7.0], "half": [1.0], "std": [1.0]})
    form = form_of(this, last, 6)
    assert form["a"]["ppr"] == pytest.approx(15.0)
    assert form["b"]["ppr"] == pytest.approx(7.0)


def test_the_damped_sheet_takes_the_square_root_of_the_two_ratios() -> None:
    found = damped({"ppr": 10.0, "half": 8.0, "std": 6.0}, 1.21, 1.0)
    assert found is not None
    assert found["ppr"] == pytest.approx(11.0)
    assert damped(None, 1.0, 1.0) is None


def test_the_range_is_fitted_on_one_season_and_measured_on_the_other() -> None:
    rows = []
    for season in (2022, 2023):
        for i in range(50):
            x = float(i % 10 + 5)
            actual = {"ppr": x + (i % 5) - 2.0, "half": x, "std": x}
            rows.append(
                Row(week_key(season, 6), f"p{i}", "QB", actual, {"sheet": {"ppr": x, "half": x, "std": x}}, None)
            )
    found = calibration(rows, "sheet", 2022, 2023)["QB|ppr"]
    assert found["n"] == len(rows) // 2
    assert found["below_floor"] == pytest.approx(0.1, abs=0.1)
    assert found["above_ceiling"] == pytest.approx(0.1, abs=0.1)


def _difference(pooled: float, bound: float, by: dict[str, float], position_bound: float = -1.0) -> dict[str, Any]:
    return {
        "pooled": pooled, "lower_bound": bound, "weeks": 24, "by_position": by,
        "position_lower_bound": dict.fromkeys(by, position_bound),
    }  # fmt: skip


def _comparisons(pooled: dict[str, Any], season: dict[str, Any]) -> dict[str, Any]:
    names = ["terms", *(f"only_{t}" for t in TERMS)]
    return {
        label: {"vs_sheet": dict.fromkeys(names, pooled if label == "pooled" else season)}
        for label in ("pooled", "2022", "2023")
    }


EVEN = {"QB": 0.05, "RB": 0.0, "WR": 0.0, "TE": 0.0}


def test_the_bar_amends_round_five_only_when_every_condition_holds_in_both_seasons() -> None:
    found = evaluate(_comparisons(_difference(0.04, 0.01, EVEN), _difference(0.04, 0.0, EVEN)))
    assert found["passed"]
    assert found["recommendation"] == AMEND


def test_the_bar_holds_when_the_focus_gain_is_not_in_both_seasons() -> None:
    season = _difference(0.04, 0.0, {"QB": -0.01, "RB": 0.0, "WR": 0.0, "TE": 0.0})
    found = evaluate(_comparisons(_difference(0.04, 0.01, EVEN), season))
    assert found["passed"]
    assert found["recommendation"] == HOLD


def test_the_bar_drops_below_the_margin_or_under_a_floor() -> None:
    small = evaluate(_comparisons(_difference(0.01, 0.005, EVEN), _difference(0.01, 0.0, EVEN)))
    assert (small["passed"], small["recommendation"]) == (False, DROP)
    floor = {"QB": 0.2, "RB": -0.03, "WR": 0.0, "TE": 0.0}
    under = evaluate(_comparisons(_difference(0.05, 0.01, floor), _difference(0.05, 0.0, floor)))
    assert under["condition_2"] is False
    assert under["recommendation"] == DROP


def test_a_term_alone_clearing_on_qb_holds_for_round_six() -> None:
    found = evaluate(_comparisons(_difference(0.01, -0.01, EVEN, 0.01), _difference(0.01, 0.0, EVEN)))
    assert not found["passed"]
    assert found["terms_alone_clearing"]["blitz"] == ["QB"]
    assert found["recommendation"] == HOLD
