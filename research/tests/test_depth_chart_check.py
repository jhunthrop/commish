"""The depth chart stamp check's arithmetic on a constructed week (no store, no outcome)."""

from research.pipeline.nflverse.depth_chart_check import OUT, CheckInputs, Group, StampCheck, stamp_check

_W = (2022, 8)
_BEFORE = (2022, 7)
_AFTER = (2022, 9)
_PLAYERS = ("hurt", "hurt_kept", "fine", "fine_dropped", "filed", "questionable", "on_bye")


def _inputs(covered: frozenset[str]) -> CheckInputs:
    starters = {
        _BEFORE: {**dict.fromkeys(_PLAYERS, "KC"), "on_bye": "BUF", "fullback": "KC"},
        _W: {"hurt_kept": "KC", "fine": "KC", "on_bye": "BUF"},
    }
    filings = {
        _W: {"filed": 1.0},  # filed in week W: in neither group
        _AFTER: {"hurt": OUT, "hurt_kept": OUT, "questionable": 1.0},  # Questionable in W+1: in neither group
    }
    return CheckInputs(starters, filings, covered, frozenset({(2022, 8, "KC")}))


def test_each_covered_starter_falls_in_one_group_by_his_filings() -> None:
    check = stamp_check(_inputs(frozenset(_PLAYERS)), {_W})
    assert check.injured == Group(players=2, retained=1, byes=0)
    # fine (kept), fine_dropped (dropped) and on_bye (kept, his club had no week-8 game).
    assert check.comparison == Group(players=3, retained=2, byes=1)
    assert check.excluded == 1  # the fullback the filing ingest never covers
    # fine, fine_dropped and on_bye have no filing in 2022 at all.
    assert check.never_filed == 3  # noqa: PLR2004 - three comparison player-weeks
    assert not check.passed  # 0.50 retained against 0.67, more than 0.05 below


def test_a_starter_the_filings_never_cover_is_in_neither_group() -> None:
    check = stamp_check(_inputs(frozenset(_PLAYERS) - {"fine_dropped"}), {_W})
    assert check.comparison == Group(players=2, retained=2, byes=1)
    assert check.excluded == 2  # noqa: PLR2004 - the fullback and fine_dropped


def test_the_margin_is_five_points_of_retention() -> None:
    assert StampCheck(Group(100, 85), Group(100, 90)).passed
    assert not StampCheck(Group(100, 84), Group(100, 90)).passed


def test_a_group_with_no_players_fails_the_check() -> None:
    check = StampCheck(Group(0, 0), Group(100, 90))
    assert not check.passed
    assert check.lines()[-1].endswith("FAIL: the replay reads week W-1's chart")
    assert "on a bye week" in check.lines()[1]
