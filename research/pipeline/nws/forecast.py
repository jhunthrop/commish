"""THE FORECAST PASS (Lane 66a; the round 4 preregistration, sections 2.5 and 2.10): `nws_forecast`.

Run by the hourly capture. For each game from the Tuesday of its week to its kickoff (the coming
eight days, so the current week and the next), at a US venue open to the sky or under a retractable
roof, it reads the National Weather Service's forecast for the kickoff hour at the stadium's
coordinates and writes it as the `nws_forecast` team-week source, both clubs' rows stamped at the
pass. A dome takes no forecast (its roof is the fact the screens say), a venue abroad takes none
(the round's no-weather default), and a game whose venue the stadium table does not confirm (no row,
or a `stadium` none of the row's names) takes none rather than another place's weather.

RATE. One grid read per venue per pass, shared by its games, and none for a game already read this
clock hour, so a game is read at most once an hour. The `/points` lookup is cached per venue and season
in `nws_grid_points`, and read again when the grid answers 404 (the cell moved).
"""

from collections import defaultdict
from collections.abc import Iterable, Iterator, Mapping, Sequence
from dataclasses import dataclass, replace
from datetime import datetime, time, timedelta
from typing import Final, Literal
from zoneinfo import ZoneInfo

from sqlalchemy import Connection, select
from sqlalchemy.dialects.postgresql import insert

from research.db.schema import NFLVERSE_GAMES, NWS_GRID_POINTS, STADIUMS, TEAM_WEEK_OBSERVATIONS
from research.errors import ResearchError
from research.pipeline.http import Fetcher, HttpResponse
from research.pipeline.nws.client import GridPoint, NwsClient, NwsError
from research.pipeline.nws.grid import KickoffForecast, kickoff_forecast
from research.pipeline.observations import TeamWeekObservation, record_team_observations

FORECAST_SOURCE: Final = "nws_forecast"
# A game is read from the Tuesday of its week; eight days ahead covers Tuesday to the next Monday.
FORECAST_HORIZON: Final = timedelta(days=8)
_TUESDAY: Final = 1
_EASTERN: Final = ZoneInfo("America/New_York")

Status = Literal["written", "fresh", "indoors", "abroad", "unknown-venue", "no-values", "failed"]


class ForecastMetric:
    TEMPERATURE = "temperature_f"
    WIND = "wind_mph"
    WIND_GUST = "wind_gust_mph"
    PRECIPITATION_PROBABILITY = "precipitation_probability"
    PRECIPITATION_AMOUNT = "precipitation_amount_in"
    SKY_COVER = "sky_cover_pct"
    PRECIPITATION_KIND = "precipitation_kind"
    ISSUED_AT = "forecast_issued_at"


@dataclass(frozen=True)
class ForecastGame:
    game_id: str
    season: int
    week: int
    home: str
    away: str
    kickoff_at: datetime
    stadium_id: str
    stadium: str


@dataclass(frozen=True)
class Venue:
    stadium_id: str
    aliases: tuple[str, ...]
    latitude: float
    longitude: float
    roof_type: str
    international: bool


@dataclass(frozen=True)
class ForecastOutcome:
    game_id: str
    status: Status
    detail: str = ""


def week_opens(kickoff: datetime) -> datetime:
    """00:00 Eastern on the Tuesday on or before the game's Eastern day: the start of its week."""
    day = kickoff.astimezone(_EASTERN).date()
    tuesday = day - timedelta(days=(day.weekday() - _TUESDAY) % 7)
    return datetime.combine(tuesday, time(0), _EASTERN)


def due_games(conn: Connection, now: datetime) -> list[ForecastGame]:
    """The games still ahead in the horizon whose week has opened."""
    table = NFLVERSE_GAMES
    query = (
        select(
            table.c.game_id,
            table.c.season,
            table.c.week,
            table.c.home_team,
            table.c.away_team,
            table.c.kickoff_at,
            table.c.stadium_id,
            table.c.stadium,
        )
        .where(table.c.kickoff_at > now, table.c.kickoff_at <= now + FORECAST_HORIZON)
        .order_by(table.c.kickoff_at, table.c.game_id)
    )
    games = [ForecastGame(*row) for row in conn.execute(query)]
    return [g for g in games if week_opens(g.kickoff_at) <= now]


def _venues(conn: Connection, ids: Iterable[str]) -> dict[str, Venue]:
    table = STADIUMS
    query = select(
        table.c.stadium_id,
        table.c.aliases,
        table.c.latitude,
        table.c.longitude,
        table.c.roof_type,
        table.c.international,
    ).where(table.c.stadium_id.in_(sorted(set(ids))))
    return {
        r.stadium_id: Venue(r.stadium_id, tuple(r.aliases), r.latitude, r.longitude, r.roof_type, r.international)
        for r in conn.execute(query)
    }


def plan(game: ForecastGame, venue: Venue | None) -> ForecastOutcome | None:
    """Why a game takes no forecast, or None when it takes one."""
    if venue is None:
        return ForecastOutcome(game.game_id, "unknown-venue", f"no stadium row for {game.stadium_id}")
    if game.stadium not in venue.aliases:
        return ForecastOutcome(game.game_id, "unknown-venue", f"{game.stadium} is none of {game.stadium_id}'s names")
    if venue.international:
        return ForecastOutcome(game.game_id, "abroad", "no weather term abroad")
    if venue.roof_type == "dome":
        return ForecastOutcome(game.game_id, "indoors", "a dome, no forecast")
    return None


def _read_this_hour(conn: Connection, games: Sequence[ForecastGame], now: datetime) -> set[str]:
    """The games whose forecast was already read in this clock hour (UTC)."""
    if not games:
        return set()
    hour = now.replace(minute=0, second=0, microsecond=0)
    table = TEAM_WEEK_OBSERVATIONS
    query = (
        select(table.c.season, table.c.week, table.c.team)
        .where(table.c.source == FORECAST_SOURCE, table.c.as_of >= hour, table.c.as_of <= now)
        .group_by(table.c.season, table.c.week, table.c.team)
    )
    read = {(r.season, r.week, r.team) for r in conn.execute(query)}
    return {g.game_id for g in games if (g.season, g.week, g.home) in read}


def _stored_point(conn: Connection, stadium_id: str, season: int) -> GridPoint | None:
    table = NWS_GRID_POINTS
    row = conn.execute(
        select(table.c.office, table.c.grid_x, table.c.grid_y, table.c.grid_url, table.c.time_zone).where(
            table.c.stadium_id == stadium_id, table.c.season == season
        )
    ).one_or_none()
    return None if row is None else GridPoint(*row)


def _store_point(conn: Connection, stadium_id: str, season: int, point: GridPoint, now: datetime) -> None:
    table = NWS_GRID_POINTS
    values = {
        "stadium_id": stadium_id,
        "season": season,
        "office": point.office,
        "grid_x": point.grid_x,
        "grid_y": point.grid_y,
        "grid_url": point.grid_url,
        "time_zone": point.time_zone,
        "read_at": now,
    }
    statement = insert(table).values(values)
    conn.execute(statement.on_conflict_do_update(index_elements=[table.c.stadium_id, table.c.season], set_=values))


def _lookup_point(conn: Connection, client: NwsClient, venue: Venue, season: int, now: datetime) -> GridPoint:
    """The service's cell for the venue, read and kept for the season."""
    point = client.point(venue.latitude, venue.longitude)
    _store_point(conn, venue.stadium_id, season, point, now)
    return point


def _grid(conn: Connection, client: NwsClient, venue: Venue, season: int, now: datetime) -> Mapping[str, object]:
    """The venue's grid answer, its cell looked up again once if the stored one answers 404."""
    point = _stored_point(conn, venue.stadium_id, season) or _lookup_point(conn, client, venue, season, now)
    try:
        return client.grid(point.grid_url)
    except NwsError as error:
        if error.kind != "not_found":
            raise
    return client.grid(_lookup_point(conn, client, venue, season, now).grid_url)


def forecast_rows(game: ForecastGame, forecast: KickoffForecast, now: datetime) -> list[TeamWeekObservation]:
    """Both clubs' rows of the forecast's values at kickoff, a value it does not hold left out."""
    values = (
        (ForecastMetric.TEMPERATURE, forecast.temperature_f),
        (ForecastMetric.WIND, forecast.wind_mph),
        (ForecastMetric.WIND_GUST, forecast.wind_gust_mph),
        (ForecastMetric.PRECIPITATION_PROBABILITY, forecast.precipitation_probability),
        (ForecastMetric.PRECIPITATION_AMOUNT, forecast.precipitation_amount_in),
        (ForecastMetric.SKY_COVER, forecast.sky_cover_pct),
        (
            None if forecast.precipitation_kind is None else ForecastMetric.PRECIPITATION_KIND,
            forecast.precipitation_kind,
        ),
        (ForecastMetric.ISSUED_AT, forecast.issued_at.timestamp()),
    )
    return [
        TeamWeekObservation(game.season, game.week, team, FORECAST_SOURCE, metric, float(value), now)
        for team in (game.home, game.away)
        for metric, value in values
        if metric is not None and value is not None
    ]


@dataclass(frozen=True)
class ForecastResult:
    outcomes: list[ForecastOutcome]
    requests: int
    written: int

    @property
    def failed(self) -> list[ForecastOutcome]:
        return [o for o in self.outcomes if o.status == "failed"]

    def line(self) -> str:
        counts: dict[str, int] = defaultdict(int)
        for outcome in self.outcomes:
            counts[outcome.status] += 1
        summary = ", ".join(f"{n} {status}" for status, n in sorted(counts.items())) or "no game due"
        failures = "".join(f"; {o.game_id} failed: {o.detail}" for o in self.failed)
        return (
            f"{len(self.outcomes)} games ({summary}), {self.requests} requests, {self.written} rows written{failures}"
        )


class _CountingFetcher:
    """The pass's fetcher, counting each request for its line."""

    def __init__(self, fetcher: Fetcher) -> None:
        self._fetcher = fetcher
        self.requests = 0

    def get(self, url: str, headers: Mapping[str, str] | None = None) -> HttpResponse:
        self.requests += 1
        return self._fetcher.get(url, headers)

    def stream(self, url: str, headers: Mapping[str, str] | None = None) -> tuple[int, Iterator[bytes]]:
        self.requests += 1
        return self._fetcher.stream(url, headers)


def _venue_outcomes(
    conn: Connection, client: NwsClient, venue: Venue, games: Sequence[ForecastGame], now: datetime
) -> tuple[list[ForecastOutcome], list[TeamWeekObservation]]:
    try:
        with conn.begin_nested():
            document = _grid(conn, client, venue, games[0].season, now)
    except (ResearchError, OSError) as error:
        return [ForecastOutcome(g.game_id, "failed", str(error)) for g in games], []
    outcomes: list[ForecastOutcome] = []
    rows: list[TeamWeekObservation] = []
    for game in games:
        try:
            forecast = kickoff_forecast(document, game.kickoff_at)
        except ResearchError as error:
            outcomes.append(ForecastOutcome(game.game_id, "failed", str(error)))
            continue
        if forecast.is_empty:
            outcomes.append(ForecastOutcome(game.game_id, "no-values", "the forecast does not reach the kickoff yet"))
            continue
        rows.extend(forecast_rows(game, forecast, now))
        outcomes.append(ForecastOutcome(game.game_id, "written"))
    return outcomes, rows


def run_forecast_pass(conn: Connection, client: NwsClient, now: datetime) -> ForecastResult:
    """Every due game's forecast at kickoff, or the reason it takes none."""
    counting = _CountingFetcher(client.fetcher)
    client = replace(client, fetcher=counting)
    games = due_games(conn, now)
    venues = _venues(conn, (g.stadium_id for g in games))
    outcomes: list[ForecastOutcome] = []
    wanted: dict[str, list[ForecastGame]] = defaultdict(list)
    for game in games:
        skip = plan(game, venues.get(game.stadium_id))
        if skip is None:
            wanted[game.stadium_id].append(game)
        else:
            outcomes.append(skip)
    fresh = _read_this_hour(conn, [g for gs in wanted.values() for g in gs], now)
    outcomes.extend(ForecastOutcome(g, "fresh", "read this hour") for g in sorted(fresh))
    rows: list[TeamWeekObservation] = []
    for stadium_id, stadium_games in sorted(wanted.items()):
        due = [g for g in stadium_games if g.game_id not in fresh]
        if due:
            venue_outcomes, venue_rows = _venue_outcomes(conn, client, venues[stadium_id], due, now)
            outcomes.extend(venue_outcomes)
            rows.extend(venue_rows)
    written = record_team_observations(conn, rows)
    return ForecastResult(outcomes, counting.requests, written)
