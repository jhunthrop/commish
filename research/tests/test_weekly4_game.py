# ruff: noqa: PLR2004 - the expected values are the preregistration's constants and the rows beside them
"""Round 4's game terms and their defaults (preregistration sections 2.5 and 2.10, amendment 1 item
3, amendment 2 items 1, 13 and 14): the closing figure, the live capture's 6-hour staleness rule and
one capture per game, the recorded roof and weather with indoor values, the binary indoors fallback,
the live forecast, the undecided retractable roof, the venue abroad, and the surface."""

import math
from dataclasses import replace
from datetime import UTC, datetime, timedelta

from research.model.weekly4.features.game import (
    FIGURE_FROM_GAME_TABLE,
    NO_FORECAST,
    NO_GAME_FIGURE,
    NO_ROOF_STATE,
    NO_SCHEDULE_ROW,
    NO_STADIUM_ROW,
    NO_SURFACE,
    NO_WEATHER,
    ROOF_UNDECIDED,
    SURFACE_FROM_STADIUM,
    game_surface,
    live_figures,
    live_weather,
    replay_figures,
    replay_weather,
    venue,
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


def _stadium(stadium_id: str, roof: str, abroad: bool = False, surface: str | None = "grass") -> Stadium:
    return Stadium(stadium_id, roof, abroad, surface, _T - timedelta(days=4))


_FORECAST = [
    _row("nws_forecast", "KC", "temperature_f", 51.0),
    _row("nws_forecast", "KC", "wind_mph", 9.0),
    _row("nws_forecast", "KC", "precipitation_probability", 30.0),
]


def test_live_weather_reads_the_forecast_and_a_domestic_dome_the_indoor_values() -> None:
    found = live_weather(_stadium("KAN00", "outdoors"), _FORECAST, "KC")
    assert (found.roof, found.indoor) == ("outdoors", 0.0)
    assert (found.temperature_f, found.wind_mph, found.precipitation_probability) == (51.0, 9.0, 0.3)
    assert live_weather(_stadium("KAN00", "outdoors"), [], "KC").defaults == {NO_FORECAST}
    dome = live_weather(_stadium("MIN00", "dome"), [], "KC")
    assert (dome.roof, dome.temperature_f, dome.defaults) == ("dome", 70.0, frozenset())
    assert live_weather(None, _FORECAST, "KC").defaults == {NO_STADIUM_ROW, NO_FORECAST}


def test_a_live_retractable_roof_is_undecided_with_the_forecast_beside_it() -> None:
    found = live_weather(_stadium("ATL97", "retractable"), _FORECAST, "KC")
    assert found.roof is None and math.isnan(found.indoor)
    assert found.temperature_f == 51.0 and found.defaults == {ROOF_UNDECIDED}


def test_a_live_game_abroad_takes_2_10s_row_never_the_indoor_values() -> None:
    found = live_weather(_stadium("LON00", "outdoors", abroad=True), [], "KC")
    assert found.defaults == {NO_FORECAST} and math.isnan(found.temperature_f) and found.roof == "outdoors"
    earlier = live_weather(_stadium("LON00", "outdoors", abroad=True), _FORECAST, "KC")
    assert earlier.temperature_f == 51.0 and earlier.defaults == frozenset()
    abroad_dome = live_weather(_stadium("MEX00", "dome", abroad=True), [], "KC")
    assert math.isnan(abroad_dome.temperature_f) and abroad_dome.defaults == {NO_FORECAST}


def test_the_game_rows_surface_by_name_and_the_stadiums_as_fallback() -> None:
    assert game_surface("fieldturf", _stadium("KAN00", "outdoors")) == ("fieldturf", frozenset())
    assert game_surface(None, _stadium("KAN00", "outdoors")) == ("grass", frozenset({SURFACE_FROM_STADIUM}))
    assert game_surface(None, None) == (None, frozenset({SURFACE_FROM_STADIUM, NO_SURFACE}))
    found = venue({"rest_days": 7.0, "division_game": 1.0}, 1.0, "grass", None)
    assert (found.surface, found.rest_days, found.defaults) == ("grass", 7.0, frozenset({NO_STADIUM_ROW}))
    assert NO_SCHEDULE_ROW in venue({}, 0.0, "grass", _stadium("KAN00", "outdoors")).defaults


def test_a_games_live_figures_come_from_one_capture() -> None:
    rows = _live(timedelta(hours=1))
    older = _T - timedelta(hours=3)
    mixed = [r if r.team == "KC" or r.source != "tank01_lines" else replace(r, as_of=older) for r in rows]
    found = live_figures(mixed, "KC", "DEN", _T)
    assert found.source == "nflverse_game_figures" and found.defaults == {FIGURE_FROM_GAME_TABLE}
