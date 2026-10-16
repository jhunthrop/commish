# ruff: noqa: PLR2004 - the expected values are the preregistration's constants and the rows beside them
"""Round 4's game terms and their defaults (preregistration sections 2.5 and 2.10, amendment 1 item
3): the closing figure, the live capture's 6-hour staleness rule, the recorded roof and weather with
indoor values, the binary indoors fallback, and the live forecast."""

import math
from datetime import UTC, datetime, timedelta

from research.model.weekly4.features.game import (
    FIGURE_FROM_GAME_TABLE,
    NO_FORECAST,
    NO_GAME_FIGURE,
    NO_ROOF_STATE,
    NO_WEATHER,
    live_figures,
    live_weather,
    replay_figures,
    replay_weather,
)
from research.model.weekly4.features.reads import Stadium, WeatherRow
from research.pipeline.observations import TeamWeekObservation

_T = datetime(2026, 10, 18, 16, 59, 59, 999000, tzinfo=UTC)


def _row(source: str, club: str, metric: str, value: float, as_of: datetime = _T) -> TeamWeekObservation:
    return TeamWeekObservation(2026, 7, club, source, metric, value, as_of)


def _weather(
    roof: str | None, temperature: float | None = 40.0, wind: float | None = 12.0, flag: int | None = 1
) -> WeatherRow:
    at = datetime(2023, 10, 22, 17, tzinfo=UTC)
    return WeatherRow(
        "g", 2023, 7, "KC", "DEN", "KAN00", at, at + timedelta(hours=31), temperature, wind, flag, roof, {}
    )


def test_the_closing_figure_and_its_absence() -> None:
    rows = [
        _row("nflverse_kickoff", "KC", "implied_team_total", 27.0),
        _row("nflverse_kickoff", "KC", "point_spread", 6.5),
        _row("nflverse_kickoff", "DEN", "implied_team_total", 20.5),
    ]
    found = replay_figures(rows, "KC", "DEN")
    assert (found.implied_points, found.opponent_implied_points, found.spread) == (27.0, 20.5, 6.5)
    missing = replay_figures(rows[:1], "KC", "DEN")
    assert math.isnan(missing.spread) and missing.defaults == {NO_GAME_FIGURE}


def _live(capture_age: timedelta) -> list[TeamWeekObservation]:
    captured, table = _T - capture_age, _T - timedelta(days=2)
    rows = []
    for source, at, own, theirs in (
        ("tank01_lines", captured, 25.0, 22.0),
        ("nflverse_game_figures", table, 24.0, 23.0),
    ):
        rows += [
            _row(source, "KC", "implied_team_total", own, at),
            _row(source, "KC", "point_spread", own - theirs, at),
            _row(source, "DEN", "implied_team_total", theirs, at),
        ]
    return rows


def test_the_live_capture_stands_six_hours_and_then_gives_way_to_the_game_tables_read() -> None:
    fresh = live_figures(_live(timedelta(hours=6)), "KC", "DEN", _T)
    assert (fresh.implied_points, fresh.source, fresh.defaults) == (25.0, "tank01_lines", frozenset())
    stale = live_figures(_live(timedelta(hours=6, seconds=1)), "KC", "DEN", _T)
    assert (stale.implied_points, stale.source, stale.defaults) == (
        24.0,
        "nflverse_game_figures",
        frozenset({FIGURE_FROM_GAME_TABLE}),
    )
    assert live_figures([], "KC", "DEN", _T).defaults == {NO_GAME_FIGURE}


def test_indoors_takes_the_indoor_values_and_outdoors_the_recorded_weather() -> None:
    dome = replay_weather(_weather("dome"), 1.0)
    assert (dome.indoor, dome.temperature_f, dome.wind_mph, dome.precipitation) == (1.0, 70.0, 0.0, 0.0)
    outdoors = replay_weather(_weather("outdoors"), 0.0)
    assert (outdoors.indoor, outdoors.temperature_f, outdoors.wind_mph, outdoors.precipitation) == (
        0.0,
        40.0,
        12.0,
        1.0,
    )
    missing = replay_weather(_weather("open", flag=None), 0.0)
    assert math.isnan(missing.precipitation) and missing.defaults == {NO_WEATHER}


def test_no_roof_state_reads_the_binary_indoors() -> None:
    closed = replay_weather(_weather(None), 1.0)
    assert closed.roof == "closed" and closed.temperature_f == 70.0 and NO_ROOF_STATE in closed.defaults
    assert replay_weather(_weather(None), 0.0).roof == "outdoors"


def test_live_weather_reads_the_forecast_and_abroad_takes_indoor_values() -> None:
    rows = [
        _row("nws_forecast", "KC", "temperature_f", 51.0),
        _row("nws_forecast", "KC", "wind_mph", 9.0),
        _row("nws_forecast", "KC", "precipitation_probability", 30.0),
    ]
    found = live_weather(Stadium("KAN00", "outdoors", False), rows, "KC")
    assert (found.temperature_f, found.wind_mph, found.precipitation_probability) == (51.0, 9.0, 0.3)
    assert live_weather(Stadium("LON00", "outdoors", True), rows, "KC").defaults == {NO_FORECAST}
    assert live_weather(Stadium("KAN00", "outdoors", False), [], "KC").defaults == {NO_FORECAST}
