"""THE SCHEDULE (`src/projections/nflverse/schedule.ts`): `nflverse/nfldata`'s `games.csv`.

Opponent, rest, venue, weather and the closing line, two rows per game (one per team). The two
source stamps are the point: half the file is knowable in May (`nflverse_schedule`, stamped May
20), half only at kickoff (`nflverse_kickoff`: the closing line at the real kickoff instant, the
recorded weather and the result after the game).
"""

import json
import re
from collections.abc import Sequence
from dataclasses import dataclass, replace
from datetime import UTC, datetime, timedelta
from typing import Final
from zoneinfo import ZoneInfo

from research.errors import SchemaDriftError
from research.pipeline.jscompat import js_is_finite, js_number, js_trim
from research.pipeline.nflverse.config import PUBLICATION_LAG_HOURS, SEASON_TYPE
from research.pipeline.nflverse.csv import CsvRow
from research.pipeline.nflverse.participation import utc_day_plus
from research.pipeline.nflverse.team_eras import final_week_of
from research.pipeline.observations import TeamWeekObservation

SCHEDULE_BASE_URL: Final = "https://raw.githubusercontent.com/nflverse/nfldata/master/"
SCHEDULE_RELEASE: Final = "data"
SCHEDULE_FILE: Final = "games.csv"


class ScheduleSource:
    SCHEDULE = "nflverse_schedule"
    KICKOFF = "nflverse_kickoff"


class ScheduleMetric:
    REST_DAYS = "rest_days"
    HOME_FIELD = "home_field"
    INDOORS = "indoors"
    DIVISION_GAME = "division_game"
    POINT_SPREAD = "point_spread"
    IMPLIED_TEAM_TOTAL = "implied_team_total"
    TEMPERATURE = "temperature_f"
    WIND_SPEED = "wind_mph"
    KICKOFF_INSTANT = "kickoff_instant"
    GAME_RESULT = "game_result"
    POINTS_ALLOWED = "points_allowed"


_EASTERN = ZoneInfo("America/New_York")
_GAMEDAY = re.compile(r"^(\d{4})-(\d{2})-(\d{2})$")
_GAMETIME = re.compile(r"^(\d{1,2}):(\d{2})$")
_INDOOR_ROOFS = ("dome", "closed")


def regular_season_games_per_team(season: int) -> int:
    return final_week_of(season) - 1


@dataclass(frozen=True)
class TeamGame:
    season: int
    week: int
    team: str
    opponent: str
    home: bool
    rest_days: float
    indoors: bool
    division_game: bool
    coach: str
    points_for: float | None
    points_against: float | None
    point_spread: float | None
    total_line: float | None
    temperature: float | None
    wind_speed: float | None
    kickoff_as_of: datetime
    kickoff_at: datetime | None


def schedule_published_as_of(season: int) -> datetime:
    """`schedulePublishedAsOf`: May 20 of the season, erring late."""
    return datetime(season, 5, 20, tzinfo=UTC)


def _eastern_offset(instant: datetime) -> timedelta:
    """How far behind UTC Eastern is at `instant` (positive), as the TypeScript reads it off Intl."""
    local = instant.astimezone(_EASTERN).replace(tzinfo=UTC)
    return instant - local


def kickoff_instant(gameday: str, gametime: str) -> datetime:
    """`kickoffInstant`: the file's local Eastern start, resolved in two passes across DST."""
    day = _GAMEDAY.match(gameday)
    time = _GAMETIME.match(gametime)
    if day is None or time is None:
        raise SchemaDriftError(
            f"Schedule row has no readable kickoff (gameday {json.dumps(gameday)}, gametime {json.dumps(gametime)}); "
            "a closing line cannot be stamped."
        )
    as_if_utc = utc_day_plus(int(day[1]), int(day[2]), int(day[3])) + timedelta(
        hours=int(time[1]), minutes=int(time[2])
    )
    instant = as_if_utc
    for _ in range(2):
        instant = as_if_utc + _eastern_offset(instant)
    return instant


def kickoff_as_of(gameday: str, lag_hours: int) -> datetime:
    """`kickoffAsOf`: end of the game's UTC day plus the lag, the same arithmetic as `gameDayAsOf`."""
    match = _GAMEDAY.match(gameday)
    if match is None:
        raise SchemaDriftError(
            f"Schedule row has no readable gameday (got {json.dumps(gameday)}); a game cannot be stamped."
        )
    return utc_day_plus(int(match[1]), int(match[2]), int(match[3]) + 1) + timedelta(hours=lag_hours)


def week_as_of_from_schedule(games: Sequence[TeamGame]) -> dict[float, datetime]:
    """`weekAsOfFromSchedule`: each week dated from its LAST game."""
    by_week: dict[float, datetime] = {}
    for game in games:
        known = by_week.get(game.week)
        if known is None or game.kickoff_as_of > known:
            by_week[game.week] = game.kickoff_as_of
    return by_week


def _required(row: CsvRow, column: str) -> str:
    value = row.get(column)
    if value is None or js_trim(value) == "":
        raise SchemaDriftError(f"Schedule row has no {column}; the games.csv schema changed.")
    return js_trim(value)


def _optional(row: CsvRow, column: str) -> float | None:
    raw = row.get(column)
    if raw is None or js_trim(raw) == "":
        return None
    value = js_number(raw)
    if not js_is_finite(value):
        raise SchemaDriftError(f"Schedule row has an unreadable {column} (got {json.dumps(raw)}).")
    return value


def _integer(row: CsvRow, column: str) -> float:
    value = _optional(row, column)
    if value is None:
        raise SchemaDriftError(f"Schedule row has no {column}; the games.csv schema changed.")
    return value


def map_schedule(
    rows: Sequence[CsvRow], seasons: Sequence[int], lag_hours: int = PUBLICATION_LAG_HOURS
) -> list[TeamGame]:
    """`mapSchedule`: two `TeamGame`s per regular-season game, the spread flipped for the away side."""
    wanted = set(seasons)
    games: list[TeamGame] = []
    for row in rows:
        if row.get("game_type") != SEASON_TYPE:
            continue
        season = _integer(row, "season")
        if season not in wanted:
            continue
        home = _home_side(row, int(season), lag_hours)
        games.extend([home, _away_side(row, home)])
    return games


def _home_side(row: CsvRow, season: int, lag_hours: int) -> TeamGame:
    gameday = _required(row, "gameday")
    gametime = row.get("gametime")
    return TeamGame(
        season=season,
        week=int(_integer(row, "week")),
        team=_required(row, "home_team"),
        opponent=_required(row, "away_team"),
        home=True,
        rest_days=_integer(row, "home_rest"),
        indoors=(row.get("roof") or "") in _INDOOR_ROOFS,
        division_game=_optional(row, "div_game") == 1,
        coach=_required(row, "home_coach"),
        points_for=_optional(row, "home_score"),
        points_against=_optional(row, "away_score"),
        point_spread=_optional(row, "spread_line"),
        total_line=_optional(row, "total_line"),
        temperature=_optional(row, "temp"),
        wind_speed=_optional(row, "wind"),
        kickoff_as_of=kickoff_as_of(gameday, lag_hours),
        kickoff_at=None if gametime is None else kickoff_instant(gameday, gametime),
    )


def _away_side(row: CsvRow, home: TeamGame) -> TeamGame:
    """The same game from the visitor's side: teams, rest, coach and score swapped, spread negated."""
    return replace(
        home,
        team=home.opponent,
        opponent=home.team,
        home=False,
        rest_days=_integer(row, "away_rest"),
        coach=_required(row, "away_coach"),
        points_for=home.points_against,
        points_against=home.points_for,
        point_spread=None if home.point_spread is None else -home.point_spread,
    )


def _game_result(game: TeamGame) -> float | None:
    if game.points_for is None or game.points_against is None:
        return None
    if game.points_for > game.points_against:
        return 1.0
    return 0.5 if game.points_for == game.points_against else 0.0


def schedule_observations(games: Sequence[TeamGame]) -> list[TeamWeekObservation]:
    """`scheduleObservations`: a fact the file does not carry emits no row, never a zero."""
    rows: list[TeamWeekObservation] = []
    for game in games:

        def obs(source: str, as_of: datetime, metric: str, value: float, game: TeamGame = game) -> TeamWeekObservation:
            return TeamWeekObservation(
                season=game.season,
                week=game.week,
                team=game.team,
                source=source,
                metric=metric,
                value=value,
                as_of=as_of,
            )

        published = schedule_published_as_of(game.season)
        at_kickoff = game.kickoff_at if game.kickoff_at is not None else game.kickoff_as_of
        after = game.kickoff_as_of
        schedule, kickoff = ScheduleSource.SCHEDULE, ScheduleSource.KICKOFF
        rows.extend(
            [
                obs(schedule, published, ScheduleMetric.REST_DAYS, game.rest_days),
                obs(schedule, published, ScheduleMetric.HOME_FIELD, 1.0 if game.home else 0.0),
                obs(schedule, published, ScheduleMetric.INDOORS, 1.0 if game.indoors else 0.0),
                obs(schedule, published, ScheduleMetric.DIVISION_GAME, 1.0 if game.division_game else 0.0),
                obs(kickoff, at_kickoff, ScheduleMetric.KICKOFF_INSTANT, 1.0),
            ]
        )
        if game.point_spread is not None:
            rows.append(obs(kickoff, at_kickoff, ScheduleMetric.POINT_SPREAD, game.point_spread))
            if game.total_line is not None:
                implied = game.total_line / 2 + game.point_spread / 2
                rows.append(obs(kickoff, at_kickoff, ScheduleMetric.IMPLIED_TEAM_TOTAL, implied))
        if game.temperature is not None:
            rows.append(obs(kickoff, after, ScheduleMetric.TEMPERATURE, game.temperature))
        if game.wind_speed is not None:
            rows.append(obs(kickoff, after, ScheduleMetric.WIND_SPEED, game.wind_speed))
        result = _game_result(game)
        if result is not None:
            rows.append(obs(kickoff, after, ScheduleMetric.GAME_RESULT, result))
        if game.points_against is not None:
            rows.append(obs(kickoff, after, ScheduleMetric.POINTS_ALLOWED, game.points_against))
    return rows


def game_result_observations(games: Sequence[TeamGame]) -> list[TeamWeekObservation]:
    return [row for row in schedule_observations(games) if row.metric == ScheduleMetric.GAME_RESULT]


def points_allowed_observations(games: Sequence[TeamGame]) -> list[TeamWeekObservation]:
    return [row for row in schedule_observations(games) if row.metric == ScheduleMetric.POINTS_ALLOWED]
