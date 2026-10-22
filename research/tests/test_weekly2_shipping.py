"""Weekly round 2's two build items for shipping: the weekly pass's opponent-rating step, which
writes a week's ratings only once every earlier game of the season is in the play-by-play, and its
place in the pass (after the play-by-play it reads, before the register)."""

from datetime import UTC, datetime, timedelta

from research.inseason import usage_steps
from research.inseason.season_week import OPPONENT_RATINGS, STEPS
from research.pipeline.nflverse.context import DefenceWeek, informed_weeks

_KICKOFF = datetime(2026, 9, 10, tzinfo=UTC)


def _week(week: int, defence: str, offence: str, played: bool) -> DefenceWeek:
    allowed = 6.0 if played else None
    return DefenceWeek(2026, week, defence, offence, allowed, allowed, _KICKOFF + timedelta(weeks=week))


def test_a_week_is_informed_once_every_earlier_game_is_in_the_play_by_play() -> None:
    weeks = [
        _week(1, "KC", "BAL", True),
        _week(1, "BAL", "KC", True),
        _week(2, "KC", "CIN", True),
        _week(2, "CIN", "KC", False),  # played, its play-by-play not yet stored
        _week(3, "KC", "DEN", False),
        _week(3, "DEN", "KC", False),
        _week(4, "KC", "LV", False),
    ]
    assert informed_weeks(weeks, 2026) == frozenset({1, 2})


def test_a_prior_seasons_weeks_do_not_inform_this_one() -> None:
    weeks = [DefenceWeek(2025, 17, "KC", "LV", None, None, _KICKOFF), _week(1, "KC", "BAL", False)]
    assert informed_weeks(weeks, 2026) == frozenset({1})


def test_the_step_runs_after_the_play_by_play_and_before_the_register() -> None:
    at = STEPS.index(OPPONENT_RATINGS)
    assert STEPS[at - 1] == usage_steps.USAGE_STEPS[-1]
    assert STEPS.index(usage_steps.PLAY_BY_PLAY) < at < STEPS.index("freeze")
    assert STEPS[-5:] == ("props-snapshot", "grade", "freeze", "espn-fill", "scoreboard")
