"""THE FEATURE STORE'S READS: each selects exactly its kind's admitted pairs (`admitted.py`).

Every statement binds its season as `season`, so round 2's `guard_queries` sees it. The play,
depth-chart and charted rows of a season are read once, bounded to the weeks and the last instant
the build needs, and each instant then takes its rows with the same predicate as the as-of SQL
(`week < W` and the stamp at or before t_g; `as_of_rows`), so the per-instant view equals the
per-instant read and goes through the recording wrapper as one. The week-W reads (figures, weather,
the forecast, the schedule rows) are read per week or per instant.
"""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime
from types import MappingProxyType
from typing import Any, Final

from sqlalchemy import Connection, text

from research.model.instants import ms_instant
from research.model.weekly3.ledger import ReadKind, Stamped
from research.model.weekly4.features.admitted import (
    BOX_TEAM_METRICS,
    DEPTH_CHARTS,
    DEPTH_COLUMNS,
    FIGURE_METRICS,
    FORECAST_METRICS,
    GAME_WEATHER,
    LIVE_FIGURE_METRICS,
    LIVE_FIGURE_SOURCES,
    NGS_METRICS,
    PFR_METRICS,
    PLAYS,
    SCHEDULE_METRICS,
    STADIUM_COLUMNS,
    STADIUMS,
    WEATHER_COLUMNS,
    WEATHER_KEY_COLUMNS,
    WEATHER_SOURCE_COLUMNS,
)
from research.model.weekly4.features.plays import PLAY_COLUMNS, Play
from research.pipeline.nflverse.ngs import NGS_SOURCE
from research.pipeline.nflverse.pbp import PBP_SOURCE
from research.pipeline.nflverse.pfr_advstats import PFR_SOURCE
from research.pipeline.nflverse.schedule import ScheduleSource
from research.pipeline.nws.forecast import FORECAST_SOURCE
from research.pipeline.observations import PlayerWeekObservation, TeamWeekObservation

WEATHER_SELECTED: Final = (*WEATHER_KEY_COLUMNS, *WEATHER_COLUMNS, *WEATHER_SOURCE_COLUMNS)
CHARTED_SOURCES: Final = ((NGS_SOURCE, NGS_METRICS), (PFR_SOURCE, PFR_METRICS))
# Each club-row read's sources and metrics, by kind: the guard test compares their product with the list.
TEAM_READS: Final[Mapping[ReadKind, tuple[tuple[str, ...], tuple[str, ...]]]] = MappingProxyType(
    {
        "figures": ((ScheduleSource.KICKOFF,), FIGURE_METRICS),
        "live_figures": (LIVE_FIGURE_SOURCES, LIVE_FIGURE_METRICS),
        "forecast": ((FORECAST_SOURCE,), FORECAST_METRICS),
        "schedule": ((ScheduleSource.SCHEDULE,), SCHEDULE_METRICS),
        "box": ((PBP_SOURCE,), BOX_TEAM_METRICS),
    }
)

PLAYS_QUERY: Final = (
    f"select {', '.join(PLAY_COLUMNS)} from research.{PLAYS} "
    "where season = :season and week <= :last_week and as_of <= :until order by week, game_id, play_id"
)
WEATHER_QUERY: Final = (
    f"select {', '.join(WEATHER_SELECTED)} from research.{GAME_WEATHER} "
    "where season = :season and week = :week order by game_id"
)
DEPTH_QUERY: Final = (
    f"select {', '.join(DEPTH_COLUMNS)} from research.{DEPTH_CHARTS} "
    "where season = :season and week <= :last_week and as_of <= :until "
    "order by week, team, player_id, depth_order, slot, as_of"
)
STADIUM_QUERY: Final = f"select {', '.join(STADIUM_COLUMNS)} from research.{STADIUMS} order by stadium_id"
_TEAM_WEEK: Final = (
    "select distinct on (week, team, source, metric) season, week, team, source, metric, value, as_of "
    "from research.team_week_observations where season = :season and week >= :first and week <= :last "
    "and as_of <= :as_of and source = any(:sources) and metric = any(:metrics) "
    "order by week asc, team asc, source asc, metric asc, as_of desc"
)
_PLAYER_WEEK: Final = (
    "select distinct on (week, player_id, source, metric) season, week, player_id, source, metric, value, as_of "
    "from research.player_week_observations where season = :season and week >= :first and week <= :last "
    "and as_of <= :as_of and source = :source and metric = any(:metrics) "
    "order by week asc, player_id asc, source asc, metric asc, as_of desc"
)


def plays(conn: Connection, season: int, last_week: int, until: datetime) -> list[Play]:
    """The season's plays of weeks 1 to `last_week` stamped at or before `until`."""
    rows = conn.execute(text(PLAYS_QUERY), {"season": season, "last_week": last_week, "until": until})
    found: list[Play] = []
    for row in rows.mappings():
        values: dict[str, Any] = dict(row)
        values["as_of"] = ms_instant(values["as_of"])
        found.append(Play(**values))
    return found


def as_of_rows[R: Stamped](rows: Sequence[R], first_week: int, last_week: int, moment: datetime) -> list[R]:
    """The rows an as-of read of weeks `first_week` to `last_week` at `moment` returns."""
    return [r for r in rows if first_week <= r.week <= last_week and r.as_of <= moment]


@dataclass(frozen=True, slots=True)
class WeatherRow:
    """One game's recorded weather and roof (`game_weather`), and the source of each value."""

    game_id: str
    season: int
    week: int
    home_team: str
    away_team: str
    stadium_id: str | None
    kickoff_at: datetime
    as_of: datetime
    temperature_f: float | None
    wind_mph: float | None
    precipitation: int | None
    roof: str | None
    sources: Mapping[str, object]


def weather(conn: Connection, season: int, week: int) -> list[WeatherRow]:
    found: list[WeatherRow] = []
    for row in conn.execute(text(WEATHER_QUERY), {"season": season, "week": week}).mappings():
        found.append(
            WeatherRow(
                str(row["game_id"]),
                int(row["season"]),
                int(row["week"]),
                str(row["home_team"]),
                str(row["away_team"]),
                row["stadium_id"],
                ms_instant(row["kickoff_at"]),
                ms_instant(row["as_of"]),
                row["temperature_f"],
                row["wind_mph"],
                row["precipitation"],
                row["roof"],
                {name: row[name] for name in WEATHER_SOURCE_COLUMNS},
            )
        )
    return found


@dataclass(frozen=True, slots=True)
class DepthRow:
    season: int
    week: int
    team: str
    slot: str
    depth_order: int
    player_id: str
    as_of: datetime
    position: str


def depth_rows(conn: Connection, season: int, last_week: int, until: datetime) -> list[DepthRow]:
    rows = conn.execute(text(DEPTH_QUERY), {"season": season, "last_week": last_week, "until": until})
    return [DepthRow(r[0], r[1], r[2], r[3], r[4], r[5], ms_instant(r[6]), r[7]) for r in rows]


@dataclass(frozen=True, slots=True)
class Stadium:
    stadium_id: str
    roof_type: str
    international: bool


def stadiums(conn: Connection) -> dict[str, Stadium]:
    """The venues (schedule knowledge, section 5 item 4)."""
    return {str(r[0]): Stadium(str(r[0]), str(r[1]), bool(r[2])) for r in conn.execute(text(STADIUM_QUERY))}


def team_rows(  # noqa: PLR0913, PLR0917 - the as-of read's every bound, named
    conn: Connection, kind: ReadKind, season: int, first: int, last: int, as_of: datetime
) -> list[TeamWeekObservation]:
    """The kind's club rows of weeks `first` to `last`, the newest per club, metric and source at
    or before `as_of`: week W's closing figures at its kickoff (item 2), the live figures and
    forecast at t_g (2.5, 2.10), the schedule rows of week W (item 4), the play-by-play club rows
    of earlier weeks (`box`)."""
    sources, metrics = TEAM_READS[kind]
    params = {
        "season": season,
        "first": first,
        "last": last,
        "as_of": as_of,
        "sources": list(sources),
        "metrics": list(metrics),
    }
    return [
        TeamWeekObservation(r.season, r.week, r.team, r.source, r.metric, r.value, ms_instant(r.as_of))
        for r in conn.execute(text(_TEAM_WEEK), params)
    ]


def charted(conn: Connection, season: int, last_week: int, until: datetime) -> list[PlayerWeekObservation]:
    """The NGS and PFR rows of weeks 1 to `last_week` stored at or before `until`."""
    found: list[PlayerWeekObservation] = []
    for source, metrics in CHARTED_SOURCES:
        params = {
            "season": season,
            "first": 1,
            "last": last_week,
            "as_of": until,
            "source": source,
            "metrics": list(metrics),
        }
        found.extend(
            PlayerWeekObservation(r.season, r.week, r.player_id, r.source, r.metric, r.value, ms_instant(r.as_of))
            for r in conn.execute(text(_PLAYER_WEEK), params)
        )
    return found
