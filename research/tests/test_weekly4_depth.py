# ruff: noqa: PLR2004 - the expected weeks and counts are the rows written beside them
"""The week-W depth chart and its fallback (round 4 preregistration, section 5 item 6, the stamp
check, amendment 2 item 5): on a pass the replay reads week W's chart at t_g; on a fail week W-1's;
a club's dated snapshots are not merged, only its newest at or before t_g is read; and a dated
chart's across-position rank r is read on the weekly charts' slot scale, ceil(r / s)."""

from datetime import UTC, datetime, timedelta

import pytest

from research.model.weekly3.ledger import InputRuleError
from research.model.weekly4.features.admitted import admit_read
from research.model.weekly4.features.depth import DEPTH_PAIRS, STARTING_SLOTS, depth_charts, slot_rank
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
    chart = depth_charts(_rows(), 2023, 7, _T, "week")
    assert chart.week == 7 and chart.stamp.kind == "depth" and chart.stamp.rows == 3
    assert chart.ranks == {"KC": {"old_starter": 2, "new_starter": 1}}
    assert not chart.mapped


def test_on_a_fail_week_w_minus_ones_chart() -> None:
    chart = depth_charts(_rows(), 2023, 7, _T, "prior")
    assert chart.week == 6 and chart.stamp.kind == "depth_prior"
    assert chart.ranks == {"KC": {"old_starter": 1}}


def test_only_the_clubs_newest_snapshot_at_the_instant_is_read() -> None:
    first, second = _T - timedelta(days=3), _T - timedelta(hours=5)
    rows = [
        DepthRow(2026, 7, "KC", "WR_1", 1, "demoted", first, "WR"),
        DepthRow(2026, 7, "KC", "WR_1", 4, "dropped", first, "WR"),
        DepthRow(2026, 7, "KC", "WR_1", 1, "promoted", second, "WR"),
        DepthRow(2026, 7, "KC", "WR_2", 2, "demoted", second, "WR"),
        DepthRow(2026, 7, "KC", "WR_2", 1, "after", _T + timedelta(minutes=5), "WR"),
        DepthRow(2026, 7, "BUF", "QB_9", 1, "qb", first, "QB"),
    ]
    chart = depth_charts(rows, 2026, 7, _T, "week")
    assert chart.ranks["KC"] == {"promoted": 1, "demoted": 1}  # 2 across the position: slot rank 1
    assert "dropped" not in chart.ranks["KC"]
    assert chart.ranks["BUF"] == {"qb": 1}
    assert chart.mapped


def test_the_across_position_rank_maps_to_the_slot_scale() -> None:
    assert STARTING_SLOTS == {"QB": 1, "RB": 1, "WR": 3, "TE": 1}
    assert [slot_rank(r, "WR") for r in (1, 3, 4, 6, 7)] == [1, 1, 2, 2, 3]
    assert [slot_rank(r, "RB") for r in (1, 2)] == [1, 2]
    assert slot_rank(2, "FB") == 2


def test_a_chart_of_another_week_cannot_pass_as_week_ws() -> None:
    misfiled = [DepthRow(2023, 8, "KC", "WR", 1, "x", _WEDNESDAY, "WR")]
    chart = depth_charts(misfiled, 2023, 7, _T, "week")
    assert chart.ranks == {} and chart.stamp.rows == 0
    with pytest.raises(InputRuleError):
        admit_read("depth", DEPTH_PAIRS, misfiled, 2023, 7, _T)
