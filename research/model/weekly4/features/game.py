"""THE GAME: its expected score and margin, its roof and weather, home and rest (round 4
preregistration, section 2.5, the defaults of 2.10, and amendment 1 item 3).

Replay: the club's and the opponent's closing figures (`nflverse_kickoff`, stamped at the kickoff),
the recorded roof and weather (`game_weather`, admitted at t_g by name). Live: the newest
`tank01_lines` capture at or before t_g, giving way to the game table's weekly read
(`nflverse_game_figures`) when the capture is older than 6 hours at t_g; the newest `nws_forecast`
at or before t_g; the roof from the stadium table. Indoors (a dome or a closed roof) every weather
term takes its indoor value. The surface is not read: the store holds no (`nflverse_schedule`,
`surface`) metric, and section 2.10 has no default for it, so the feature stops (named in the report).
"""

import math
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Final

from research.model.weekly4.features.reads import Stadium, WeatherRow
from research.pipeline.game_figures import FigureMetric
from research.pipeline.nflverse.games import GAME_FIGURES_SOURCE
from research.pipeline.nflverse.schedule import ScheduleMetric
from research.pipeline.nws.forecast import ForecastMetric
from research.pipeline.observations import TeamWeekObservation
from research.pipeline.tank01.lines import LINES_SOURCE

INDOOR_ROOFS: Final = frozenset({"dome", "closed"})
INDOOR_TEMPERATURE_F: Final = 70.0  # 2.5: "a fixed 70 F, a stated constant"
INDOOR_WIND_MPH: Final = 0.0
INDOOR_PRECIPITATION: Final = 0.0
STALE_AFTER: Final = timedelta(hours=6)  # 2.10: "the newest older than 6 hours at t_g"
PERCENT: Final = 100.0
RETRACTABLE: Final = "retractable"

NO_GAME_FIGURE: Final = "no_game_figure"
FIGURE_FROM_GAME_TABLE: Final = "figure_from_the_game_tables_read"
NO_ROOF_STATE: Final = "no_roof_state"
NO_WEATHER: Final = "no_weather"
NO_FORECAST: Final = "no_forecast"
NO_WEATHER_ROW: Final = "no_game_weather_row"
NO_STADIUM_ROW: Final = "no_stadium_row"
NO_SCHEDULE_ROW: Final = "no_rest_or_division_row"
SURFACE_STOPPED: Final = "surface_stopped"


@dataclass(frozen=True, slots=True)
class Figures:
    implied_points: float
    opponent_implied_points: float
    spread: float  # the club's, positive when it is favoured
    source: str | None
    defaults: frozenset[str]


@dataclass(frozen=True, slots=True)
class Weather:
    roof: str | None
    indoor: float
    temperature_f: float
    wind_mph: float
    precipitation: float  # replay: the recorded 0 or 1; live: NaN, the probability carries it
    precipitation_probability: float  # live only: the forecast's chance, 0 to 1
    defaults: frozenset[str]


def _value(rows: Sequence[TeamWeekObservation], club: str, metric: str, source: str | None = None) -> float | None:
    for row in rows:
        if row.team == club and row.metric == metric and (source is None or row.source == source):
            return row.value
    return None


def replay_figures(rows: Sequence[TeamWeekObservation], club: str, opponent: str) -> Figures:
    own = _value(rows, club, ScheduleMetric.IMPLIED_TEAM_TOTAL)
    theirs = _value(rows, opponent, ScheduleMetric.IMPLIED_TEAM_TOTAL)
    spread = _value(rows, club, ScheduleMetric.POINT_SPREAD)
    if own is None or theirs is None or spread is None:
        return Figures(math.nan, math.nan, math.nan, None, frozenset({NO_GAME_FIGURE}))
    return Figures(own, theirs, spread, "nflverse_kickoff", frozenset())


def _newest(rows: Sequence[TeamWeekObservation], club: str, source: str) -> datetime | None:
    stamps = [r.as_of for r in rows if r.team == club and r.source == source]
    return max(stamps) if stamps else None


def live_figures(rows: Sequence[TeamWeekObservation], club: str, opponent: str, moment: datetime) -> Figures:
    """The capture while it is no more than 6 hours old at t_g, else the game table's read (2.10)."""
    captured = _newest(rows, club, LINES_SOURCE)
    fresh = captured is not None and moment - captured <= STALE_AFTER
    for source, defaults in (
        (LINES_SOURCE, frozenset[str]()),
        (GAME_FIGURES_SOURCE, frozenset({FIGURE_FROM_GAME_TABLE})),
    ):
        if source == LINES_SOURCE and not fresh:
            continue
        own = _value(rows, club, FigureMetric.IMPLIED_TEAM_TOTAL, source)
        theirs = _value(rows, opponent, FigureMetric.IMPLIED_TEAM_TOTAL, source)
        spread = _value(rows, club, FigureMetric.POINT_SPREAD, source)
        if own is not None and theirs is not None and spread is not None:
            return Figures(own, theirs, spread, source, defaults)
    return Figures(math.nan, math.nan, math.nan, None, frozenset({NO_GAME_FIGURE}))


def _indoor(roof: str, defaults: frozenset[str]) -> Weather:
    return Weather(roof, 1.0, INDOOR_TEMPERATURE_F, INDOOR_WIND_MPH, INDOOR_PRECIPITATION, 0.0, defaults)


def replay_weather(row: WeatherRow | None, indoors: float | None) -> Weather:
    """The recorded roof and weather; with no roof value the binary `indoors` (1 closed, 0 outdoors)."""
    defaults: set[str] = set()
    roof = None if row is None else row.roof
    if row is None:
        defaults.add(NO_WEATHER_ROW)
    if roof is None:
        defaults.add(NO_ROOF_STATE)
        roof = "closed" if indoors == 1.0 else "outdoors"
    if roof in INDOOR_ROOFS:
        return _indoor(roof, frozenset(defaults))
    temperature = None if row is None else row.temperature_f
    wind = None if row is None else row.wind_mph
    flag = None if row is None else row.precipitation
    if temperature is None or wind is None or flag is None:
        defaults.add(NO_WEATHER)
    return Weather(
        roof,
        0.0,
        math.nan if temperature is None else float(temperature),
        math.nan if wind is None else float(wind),
        math.nan if flag is None else float(flag),
        math.nan,
        frozenset(defaults),
    )


def live_weather(stadium: Stadium | None, forecast: Sequence[TeamWeekObservation], club: str) -> Weather:
    """The stadium's roof and the newest forecast; a game abroad takes the indoor values with
    `no_forecast` (2.5), and with no forecast row the weather is NaN with `no_forecast` (2.10)."""
    if stadium is None:
        nan = math.nan
        return Weather(None, nan, nan, nan, nan, nan, frozenset({NO_STADIUM_ROW, NO_FORECAST}))
    if stadium.international:
        return _indoor(stadium.roof_type, frozenset({NO_FORECAST}))
    if stadium.roof_type == "dome":
        return _indoor("dome", frozenset())
    temperature = _value(forecast, club, ForecastMetric.TEMPERATURE)
    wind = _value(forecast, club, ForecastMetric.WIND)
    chance = _value(forecast, club, ForecastMetric.PRECIPITATION_PROBABILITY)
    defaults = frozenset({NO_FORECAST}) if temperature is None or wind is None or chance is None else frozenset()
    return Weather(
        stadium.roof_type,
        0.0,
        math.nan if temperature is None else temperature,
        math.nan if wind is None else wind,
        math.nan,
        math.nan if chance is None else chance / PERCENT,
        defaults,
    )


@dataclass(frozen=True, slots=True)
class Venue:
    home: float
    rest_days: float
    division_game: float
    indoors: float | None
    defaults: frozenset[str]


def venue(schedule_rows: Mapping[str, float], home: float) -> Venue:
    rest = schedule_rows.get(ScheduleMetric.REST_DAYS)
    division = schedule_rows.get(ScheduleMetric.DIVISION_GAME)
    defaults = frozenset({NO_SCHEDULE_ROW}) if rest is None or division is None else frozenset()
    return Venue(
        home,
        math.nan if rest is None else rest,
        math.nan if division is None else division,
        schedule_rows.get(ScheduleMetric.INDOORS),
        defaults | {SURFACE_STOPPED},
    )
