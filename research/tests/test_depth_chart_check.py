"""The depth chart stamp check's arithmetic on a constructed week (no store, no outcome)."""

from research.pipeline.nflverse.depth_chart_check import OUT, Group, StampCheck, stamp_check

_W = (2022, 8)
_BEFORE = (2022, 7)
_AFTER = (2022, 9)


def test_each_starter_falls_in_one_group_by_his_filings() -> None:
    starters = {
        _BEFORE: {"hurt", "hurt_kept", "fine", "fine_dropped", "filed", "questionable"},
        _W: {"hurt_kept", "fine"},
    }
    filings = {
        _W: {"filed": 1.0},  # filed in week W: in neither group
        _AFTER: {"hurt": OUT, "hurt_kept": OUT, "questionable": 1.0},  # Questionable in W+1: in neither group
    }
    check = stamp_check(starters, filings, {_W})
    assert check.injured == Group(players=2, retained=1)
    assert check.comparison == Group(players=2, retained=1)
    assert check.passed


def test_the_margin_is_five_points_of_retention() -> None:
    assert StampCheck(Group(100, 85), Group(100, 90)).passed
    assert not StampCheck(Group(100, 84), Group(100, 90)).passed


def test_a_group_with_no_players_fails_the_check() -> None:
    check = StampCheck(Group(0, 0), Group(100, 90))
    assert not check.passed
    assert check.lines()[-1].endswith("FAIL: the replay reads week W-1's chart")
