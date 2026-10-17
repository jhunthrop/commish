"""THE GAME: its expected score and margin, its roof and weather, home and rest (round 4
preregistration, section 2.5, the defaults of 2.10, and amendment 1 item 3).

Replay: the club's and the opponent's closing figures (`nflverse_kickoff`, stamped at the kickoff),
the recorded roof and weather (`game_weather`, admitted at t_g by name). Live: the newest
`tank01_lines` capture at or before t_g, giving way to the game table's weekly read
(`nflverse_game_figures`) when the capture is older than 6 hours at t_g; the newest `nws_forecast`
at or before t_g, every figure of a game from one capture; the roof from the stadium table. Indoors
(a dome or a closed roof) every weather term takes its indoor value. The surface is the game row's
(`nflverse_games`, by name), the stadium row's when the game's is null (amendment 2 item 1).
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
SURFACE_FROM_STADIUM: Final = "surface"  # amendment 2 item 1: the `default_surface` indicator
NO_SURFACE: Final = "no_surface"
ROOF_UNDECIDED: Final = "roof_undecided"  # amendment 2 item 13


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


def _one_read(
    rows: Sequence[TeamWeekObservation], club: str, opponent: str, source: str
) -> tuple[datetime, float, float, float] | None:
    """The source's three figures for the game, all from one read (one capture or one game-table
    pass): the club's implied points and spread and the opponent's implied points, stamped alike."""
    found: dict[tuple[str, str], TeamWeekObservation] = {}
    for row in rows:
        if row.source == source and row.team in (club, opponent):
            found[(row.team, row.metric)] = row
    parts = [
        found.get((club, FigureMetric.IMPLIED_TEAM_TOTAL)),
        found.get((opponent, FigureMetric.IMPLIED_TEAM_TOTAL)),
        found.get((club, FigureMetric.POINT_SPREAD)),
    ]
    if any(p is None for p in parts) or len({p.as_of for p in parts if p is not None}) != 1:
        return None
    own, theirs, spread = (p for p in parts if p is not None)
    return own.as_of, own.value, theirs.value, spread.value


def live_figures(rows: Sequence[TeamWeekObservation], club: str, opponent: str, moment: datetime) -> Figures:
    """The capture while it is no more than 6 hours old at t_g, else the game table's read (2.10);
    a game's figures are never mixed from two reads."""
    capture = _one_read(rows, club, opponent, LINES_SOURCE)
    if capture is not None and moment - capture[0] <= STALE_AFTER:
        return Figures(capture[1], capture[2], capture[3], LINES_SOURCE, frozenset())
    table = _one_read(rows, club, opponent, GAME_FIGURES_SOURCE)
    if table is not None:
        return Figures(table[1], table[2], table[3], GAME_FIGURES_SOURCE, frozenset({FIGURE_FROM_GAME_TABLE}))
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
    """The stadium's roof and the newest forecast at or before t_g; with none, NaN with `no_forecast`
    (2.10). A domestic dome takes the indoor values. A retractable roof's state is NaN with
    `roof_undecided` and the forecast beside it, lane 69's fitted rule deciding (amendment 2 item 13).
    A venue abroad takes 2.10's row like any other, never the indoor values (item 14)."""
    if stadium is None:
        nan = math.nan
        return Weather(None, nan, nan, nan, nan, nan, frozenset({NO_STADIUM_ROW, NO_FORECAST}))
    if stadium.roof_type == "dome" and not stadium.international:
        return _indoor("dome", frozenset())
    temperature = _value(forecast, club, ForecastMetric.TEMPERATURE)
    wind = _value(forecast, club, ForecastMetric.WIND)
    chance = _value(forecast, club, ForecastMetric.PRECIPITATION_PROBABILITY)
    defaults = {NO_FORECAST} if temperature is None or wind is None or chance is None else set()
    undecided = stadium.roof_type == RETRACTABLE
    if undecided:
        defaults.add(ROOF_UNDECIDED)
    return Weather(
        None if undecided else stadium.roof_type,
        math.nan if undecided else float(stadium.roof_type == "dome"),
        math.nan if temperature is None else temperature,
        math.nan if wind is None else wind,
        math.nan,
        math.nan if chance is None else chance / PERCENT,
        frozenset(defaults),
    )


def game_surface(recorded: str | None, stadium: Stadium | None) -> tuple[str | None, frozenset[str]]:
    """The game's surface (`nflverse_games`, by name, amendment 2 item 1), else the stadium row's,
    counted under `surface`; with neither, none with `no_surface`."""
    if recorded:
        return recorded, frozenset()
    if stadium is not None and stadium.surface:
        return stadium.surface, frozenset({SURFACE_FROM_STADIUM})
    return None, frozenset({SURFACE_FROM_STADIUM, NO_SURFACE})


@dataclass(frozen=True, slots=True)
class Venue:
    home: float
    rest_days: float
    division_game: float
    indoors: float | None
    surface: str | None
    defaults: frozenset[str]


def venue(
    schedule_rows: Mapping[str, float], home: float, recorded_surface: str | None, stadium: Stadium | None
) -> Venue:
    rest = schedule_rows.get(ScheduleMetric.REST_DAYS)
    division = schedule_rows.get(ScheduleMetric.DIVISION_GAME)
    surface, surface_defaults = game_surface(recorded_surface, stadium)
    defaults = {NO_SCHEDULE_ROW} if rest is None or division is None else set()
    if stadium is None:
        defaults.add(NO_STADIUM_ROW)
    return Venue(
        home,
        math.nan if rest is None else rest,
        math.nan if division is None else division,
        schedule_rows.get(ScheduleMetric.INDOORS),
        surface,
        frozenset(defaults) | surface_defaults,
    )
