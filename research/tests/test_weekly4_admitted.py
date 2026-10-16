"""Round 4's allow-list (preregistration section 5, items 1 to 8, and amendment 1 item 3): every read
kind has its explicit (source, metric) pairs, a week-W `game_result` or `points_allowed` row is
refused with `InputRuleError` through each read kind, and the recorded weather is admitted at t_g by
name whatever its stamp."""

from datetime import UTC, datetime, timedelta
from typing import get_args

import pytest

from research.model.weekly3.ledger import InputRuleError, ReadKind
from research.model.weekly4.features.admitted import (
    ADMITTED,
    GAME_WEATHER,
    admit_observations,
    admit_read,
)
from research.pipeline.observations import TeamWeekObservation

_KICKOFF = datetime(2023, 10, 22, 17, 0, tzinfo=UTC)
_T = _KICKOFF - timedelta(milliseconds=1)
_ROUND_FOUR_KINDS: tuple[ReadKind, ...] = (
    "plays",
    "charted",
    "figures",
    "live_figures",
    "weather",
    "depth",
    "depth_prior",
    "forecast",
    "schedule",
    "box",
    "filings",
    "prior",
)


def _kickoff_row(metric: str, week: int = 7, as_of: datetime = _KICKOFF) -> TeamWeekObservation:
    return TeamWeekObservation(2023, week, "KC", "nflverse_kickoff", metric, 1.0, as_of)


def test_every_round_four_kind_has_its_list_and_no_list_holds_an_outcome() -> None:
    assert set(_ROUND_FOUR_KINDS) <= set(ADMITTED)
    assert set(ADMITTED) <= set(get_args(ReadKind))
    for pairs in ADMITTED.values():
        assert ("nflverse_kickoff", "game_result") not in pairs
        assert ("nflverse_kickoff", "points_allowed") not in pairs
    assert {m for s, m in ADMITTED["figures"]} == {"implied_team_total", "point_spread"}
    assert {s for s, _ in ADMITTED["figures"]} == {"nflverse_kickoff"}
    assert {m for s, m in ADMITTED["weather"] if m in {"temperature_f", "wind_mph", "precipitation", "roof"}} == {
        "temperature_f",
        "wind_mph",
        "precipitation",
        "roof",
    }
    assert not any(s == "nflverse_kickoff" and m in {"temperature_f", "wind_mph"} for s, m in ADMITTED["weather"])


@pytest.mark.parametrize("kind", _ROUND_FOUR_KINDS)
@pytest.mark.parametrize("metric", ["game_result", "points_allowed"])
def test_a_week_w_outcome_row_is_refused_through_every_read_kind(kind: ReadKind, metric: str) -> None:
    for as_of in (_KICKOFF, _T - timedelta(days=1), _KICKOFF + timedelta(hours=23)):
        with pytest.raises(InputRuleError, match="allow-list refuses"):
            admit_observations(kind, [_kickoff_row(metric, as_of=as_of)], 2023, 7, _T)


def test_the_closing_figure_is_admitted_at_the_kickoff_by_name() -> None:
    stamp = admit_observations("figures", [_kickoff_row("implied_team_total")], 2023, 7, _T)
    assert stamp.rows == 1 and stamp.kind == "figures"


def test_a_weather_row_is_admitted_at_the_instant_by_name_though_stamped_after_the_game() -> None:
    row = TeamWeekObservation(2023, 7, "KC", GAME_WEATHER, "wind_mph", 14.0, _KICKOFF + timedelta(hours=31))
    stamp = admit_read("weather", [(GAME_WEATHER, "wind_mph")], [row], 2023, 7, _T)
    assert stamp.rows == 1 and stamp.moment == _T


def test_a_read_that_selects_an_unlisted_column_is_refused_before_any_row() -> None:
    with pytest.raises(InputRuleError, match="allow-list refuses"):
        admit_read("weather", [(GAME_WEATHER, "home_score")], [], 2023, 7, _T)
    with pytest.raises(InputRuleError, match="allow-list refuses"):
        admit_read("schedule", [("nflverse_schedule", "surface")], [], 2023, 7, _T)
