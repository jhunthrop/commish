"""Round 4's read kinds on round 3's recording wrapper (preregistration section 5, items 2, 3, 6, 7
and 8): the game's figures admitted at the kickoff, the recorded weather admitted at t_g by name
whatever its stamp, the week-W depth chart (and week W-1's on the check's fallback), the live
forecast at or before t_g, and the play and charted rows of earlier weeks stamped at or before t_g."""

from datetime import UTC, datetime, timedelta

import pytest

from research.model.reads.stamps import Newest
from research.model.weekly3.ledger import InputRuleError, ReadKind, Stamp, admit, stamp_of, violation
from research.pipeline.observations import TeamWeekObservation

_KICKOFF = datetime(2023, 10, 22, 17, 0, tzinfo=UTC)
_T = _KICKOFF - timedelta(milliseconds=1)
_BEFORE = _T - timedelta(days=4)
_AFTER_GAME = _KICKOFF + timedelta(hours=30)


def _row(week: int, as_of: datetime) -> TeamWeekObservation:
    return TeamWeekObservation(2023, week, "KC", "s", "m", 1.0, as_of)


@pytest.mark.parametrize("kind", ["plays", "charted"])
def test_earlier_weeks_stamped_before_the_instant_are_admitted_and_week_w_is_refused(kind: ReadKind) -> None:
    assert admit([_row(6, _BEFORE)], 2023, 7, _T, kind).newest == Newest(2023, 6, _BEFORE)
    with pytest.raises(InputRuleError, match="week 7"):
        admit([_row(7, _BEFORE)], 2023, 7, _T, kind)
    with pytest.raises(InputRuleError, match="after the instant"):
        admit([_row(6, _T + timedelta(milliseconds=1))], 2023, 7, _T, kind)


def test_the_figures_are_admitted_stamped_at_the_kickoff_and_refused_one_ms_later() -> None:
    found = admit([_row(7, _KICKOFF)], 2023, 7, _T, "figures")
    assert found == Stamp(2023, 7, _T, "figures", Newest(2023, 7, _KICKOFF), 1)
    with pytest.raises(InputRuleError, match="after the kickoff"):
        admit([_row(7, _KICKOFF + timedelta(milliseconds=1))], 2023, 7, _T, "figures")
    with pytest.raises(InputRuleError, match="week 6"):
        admit([_row(6, _BEFORE)], 2023, 7, _T, "figures")


def test_the_recorded_weather_is_admitted_by_name_whatever_its_stamp_but_only_week_ws() -> None:
    assert admit([_row(7, _AFTER_GAME)], 2023, 7, _T, "weather").rows == 1
    with pytest.raises(InputRuleError, match="week 6"):
        admit([_row(6, _BEFORE)], 2023, 7, _T, "weather")


def test_the_depth_chart_is_week_ws_or_on_the_fallback_week_w_minus_ones() -> None:
    assert admit([_row(7, _BEFORE)], 2023, 7, _T, "depth").rows == 1
    with pytest.raises(InputRuleError, match="week 6"):
        admit([_row(6, _BEFORE)], 2023, 7, _T, "depth")
    with pytest.raises(InputRuleError, match="after the instant"):
        admit([_row(7, _T + timedelta(hours=1))], 2023, 7, _T, "depth")
    assert admit([_row(6, _BEFORE)], 2023, 7, _T, "depth_prior").rows == 1
    with pytest.raises(InputRuleError, match="week 7"):
        admit([_row(7, _BEFORE)], 2023, 7, _T, "depth_prior")


def test_the_live_forecast_and_figures_are_week_ws_at_or_before_the_instant() -> None:
    for kind in ("forecast", "live_figures"):
        assert admit([_row(7, _BEFORE)], 2023, 7, _T, kind).rows == 1
        with pytest.raises(InputRuleError, match="after the instant"):
            admit([_row(7, _KICKOFF)], 2023, 7, _T, kind)


def test_violation_reads_each_new_kind_as_admit_does() -> None:
    assert violation(Stamp(2023, 7, _T, "figures", Newest(2023, 7, _KICKOFF), 1)) is None
    assert violation(Stamp(2023, 7, _T, "weather", Newest(2023, 7, _AFTER_GAME), 1)) is None
    assert violation(Stamp(2023, 7, _T, "depth_prior", Newest(2023, 6, _BEFORE), 1)) is None
    assert violation(Stamp(2023, 7, _T, "plays", Newest(2023, 7, _BEFORE), 1)) is not None
    assert violation(Stamp(2023, 7, _T, "figures", Newest(2023, 7, _AFTER_GAME), 1)) is not None
    with pytest.raises(InputRuleError):
        stamp_of(Newest(2023, 7, _AFTER_GAME), 2023, 7, _T, "depth")
