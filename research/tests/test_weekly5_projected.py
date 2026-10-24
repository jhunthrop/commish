"""Round 5's projected set (Lane 168; preregistration 2.2, guard test 3): a week-W snap row raises under the
input rule, a week-W chart row alone admits him, a snap in one of his club's last three games admits him, the
designation filter withholds, and the store's form of the rule reads the columns it was built under."""

import math
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

import pandas as pd
import pytest

from research.model.weekly3.ledger import InputRuleError
from research.model.weekly5.columns import EXCLUDED, FEATURE_INPUTS
from research.model.weekly5.projected import evidence, no_play_evidence, numbered

KICKOFF = datetime(2021, 10, 10, 17, tzinfo=UTC)
MOMENT = KICKOFF - timedelta(milliseconds=1)


@dataclass(frozen=True, slots=True)
class Chart:
    season: int
    week: int
    as_of: datetime
    player_id: str


@dataclass(frozen=True, slots=True)
class Snap:
    season: int
    week: int
    as_of: datetime
    player_id: str
    value: float


def test_guard_three_a_week_w_snap_row_raises() -> None:
    snaps = [Snap(2021, 5, KICKOFF - timedelta(days=2), "wr", 30.0)]
    with pytest.raises(InputRuleError):
        evidence("wr", [], snaps, {3, 4, 5}, 2021, 5, MOMENT)


def test_guard_three_a_week_w_chart_row_alone_admits_him() -> None:
    chart = [Chart(2021, 5, KICKOFF - timedelta(days=3), "wr")]
    assert evidence("wr", chart, [], set(), 2021, 5, MOMENT)


def test_a_chart_row_of_another_week_or_after_t_g_is_refused() -> None:
    with pytest.raises(InputRuleError):
        evidence("wr", [Chart(2021, 4, KICKOFF - timedelta(days=9), "wr")], [], set(), 2021, 5, MOMENT)
    with pytest.raises(InputRuleError):
        evidence("wr", [Chart(2021, 5, KICKOFF + timedelta(hours=1), "wr")], [], set(), 2021, 5, MOMENT)


def test_a_snap_in_one_of_his_clubs_last_three_games() -> None:
    snaps = [Snap(2021, 1, KICKOFF - timedelta(days=28), "wr", 12.0), Snap(2021, 3, KICKOFF - timedelta(days=14), "rb", 0.0)]
    assert not evidence("wr", [], snaps, {2, 3, 4}, 2021, 5, MOMENT)  # week 1 is not one of the last three
    assert evidence("wr", [], snaps, {1, 2, 3}, 2021, 5, MOMENT)
    assert not evidence("rb", [], snaps, {1, 2, 3}, 2021, 5, MOMENT)  # a snap row of 0 is no snap


def test_the_store_form_withholds_and_needs_evidence() -> None:
    rows = pd.DataFrame(
        {
            "position": ["WR"] * 4,
            "week": [5] * 4,
            "withheld": [0, 0, 1, 0],
            "depth_rank": [2.0, math.nan, 1.0, math.nan],
            "played_in_last_three": [0, 1, 1, 0],
        }
    )
    assert numbered(rows).tolist() == [True, True, False, False]
    counted = no_play_evidence(rows)
    assert counted.to_dict("records") == [{"position": "WR", "week": 5, "no_play_evidence": 1}]


def test_the_tree_inputs_hold_the_feature_row_less_the_named_columns() -> None:
    assert not EXCLUDED & set(FEATURE_INPUTS)
    assert "roof" in FEATURE_INPUTS and "surface" not in FEATURE_INPUTS
    assert {"implied_points", "depth_rank", "played_in_last_three", "default_no_game_this_season"} <= set(FEATURE_INPUTS)
    assert "precipitation_probability" not in FEATURE_INPUTS
