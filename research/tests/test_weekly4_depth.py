# ruff: noqa: PLR2004 - the expected weeks and counts are the rows written beside them
"""The week-W depth chart and its fallback (round 4 preregistration, section 5 item 6 and the stamp
check): on a pass the replay reads week W's chart stamped at or before t_g; on a fail week W-1's,
and then only a filing is evidence of a return."""

from datetime import UTC, datetime, timedelta

import pytest

from research.model.weekly3.ledger import InputRuleError
from research.model.weekly4.features.admitted import admit_read
from research.model.weekly4.features.players import DEPTH_PAIRS, depth_charts
from research.model.weekly4.features.reads import DepthRow

_T = datetime(2023, 10, 22, 16, 59, 59, 999000, tzinfo=UTC)
_WEDNESDAY = datetime(2023, 10, 18, 22, tzinfo=UTC)


def _rows() -> list[DepthRow]:
    return [
        DepthRow(2023, 6, "KC", "WR", 1, "old_starter", _WEDNESDAY - timedelta(days=7), "WR"),
        DepthRow(2023, 7, "KC", "WR", 2, "old_starter", _WEDNESDAY, "WR"),
        DepthRow(2023, 7, "KC", "WR", 1, "new_starter", _WEDNESDAY, "WR"),
        DepthRow(2023, 7, "KC", "LWR", 3, "new_starter", _WEDNESDAY, "WR"),
        DepthRow(2023, 7, "KC", "TE", 1, "late_add", _T + timedelta(hours=1), "TE"),
    ]


def test_on_a_pass_the_week_w_chart_at_the_instant_with_each_players_best_rank() -> None:
    charts, week, stamp = depth_charts(_rows(), 2023, 7, _T, "week")
    assert week == 7 and stamp.kind == "depth" and stamp.rows == 3
    assert charts == {"KC": {"old_starter": 2, "new_starter": 1}}


def test_on_a_fail_week_w_minus_ones_chart() -> None:
    charts, week, stamp = depth_charts(_rows(), 2023, 7, _T, "prior")
    assert week == 6 and stamp.kind == "depth_prior"
    assert charts == {"KC": {"old_starter": 1}}


def test_a_chart_of_another_week_cannot_pass_as_week_ws() -> None:
    misfiled = [DepthRow(2023, 8, "KC", "WR", 1, "x", _WEDNESDAY, "WR")]
    charts, _, stamp = depth_charts(misfiled, 2023, 7, _T, "week")
    assert charts == {} and stamp.rows == 0
    with pytest.raises(InputRuleError):
        admit_read("depth", DEPTH_PAIRS, misfiled, 2023, 7, _T)
