"""THE RECORDED KICKOFF WEATHER, FILLED (`game_weather`; preregistration §2.5, §2.9).

One row per regular-season game, each value with its source, filled in the preregistered order:

1. **the nflverse game table** (`games.csv` `temp`, `wind`), the values `nflverse_kickoff` holds,
2. **the gamebook line** in the play-by-play's `weather` text (`gamebook`), read from the play table,
3. **NOAA's ISD** hourly observation at the station nearest the stadium for the kickoff (`isd`).

Precipitation has no game-table value: the gamebook's preregistered word first, then ISD's one-hour
depth. A gamebook line with neither a temperature nor a wind was never filled in and says nothing. ISD's own flag and depth are kept for every game it was read for, so the word's agreement with
the gauge is a count over the table.

Only games played outside are filled: a roof of `dome` or `closed` keeps every weather value NULL
(the model's indoor constants apply there, preregistration §2.5), and the row still carries the roof.
The stadium's coordinates come from `research.stadiums` (Lane 66a's ingest of the reviewed Wikidata
seed); a run without that table reads no ISD and says so. The row's stamp is the recorded weather's,
the game's day plus the publication lag, as `nflverse_kickoff`'s temperature and wind.

A re-run rewrites a row only when a value moved (a later run with ISD reachable fills what an earlier
one could not), and counts what it wrote.
"""

from collections import Counter
from collections.abc import Callable, Mapping, Sequence
from dataclasses import asdict, dataclass, replace
from datetime import datetime
from typing import Final

from sqlalchemy import Connection, or_, text
from sqlalchemy.dialects.postgresql import insert

from research.db.schema import GAME_WEATHER, NFLVERSE_PBP_PLAYS
from research.errors import SchemaDriftError
from research.pipeline.jscompat import js_is_finite, js_number, js_trim
from research.pipeline.nflverse.client import NflverseClient
from research.pipeline.nflverse.config import PUBLICATION_LAG_HOURS, SEASON_TYPE
from research.pipeline.nflverse.csv import CsvRow
from research.pipeline.nflverse.ingest import schedule_client
from research.pipeline.nflverse.schedule import SCHEDULE_FILE, SCHEDULE_RELEASE, kickoff_as_of, kickoff_instant
from research.pipeline.weather import gamebook
from research.pipeline.weather.isd import Coordinates, IsdReader, KickoffWeather

GAMES_TABLE: Final = "nflverse_games"
GAMEBOOK: Final = "pbp_weather_text"
ISD: Final = "noaa_isd"
INDOOR_ROOFS: Final = frozenset({"dome", "closed"})


@dataclass(frozen=True, slots=True)
class GameRecord:
    game_id: str
    season: int
    week: int
    gameday: str
    kickoff_at: datetime
    home_team: str
    away_team: str
    roof: str | None
    stadium_id: str | None
    temp: float | None
    wind: float | None

    @property
    def outside(self) -> bool:
        return self.roof not in INDOOR_ROOFS


def _text(row: CsvRow, column: str) -> str | None:
    raw = row.get(column)
    return None if raw is None or js_trim(raw) in ("", "NA") else js_trim(raw)


def _number(row: CsvRow, column: str) -> float | None:
    raw = _text(row, column)
    if raw is None:
        return None
    value = js_number(raw)
    if not js_is_finite(value):
        raise SchemaDriftError(f'games.csv game {row.get("game_id")} has an unreadable {column} "{raw}".')
    return value


def game_records(rows: Sequence[CsvRow], seasons: Sequence[int]) -> list[GameRecord]:
    """`games.csv`'s regular-season games of `seasons`."""
    wanted = set(seasons)
    games: list[GameRecord] = []
    for row in rows:
        if row.get("game_type") != SEASON_TYPE:
            continue
        season = int(_number(row, "season") or 0)
        if season not in wanted:
            continue
        game_id, gameday, gametime = _text(row, "game_id"), _text(row, "gameday"), _text(row, "gametime")
        home, away, week = _text(row, "home_team"), _text(row, "away_team"), _number(row, "week")
        if game_id is None or gameday is None or gametime is None or home is None or away is None or week is None:
            raise SchemaDriftError(f"games.csv has a {season} game with no id, day, time, clubs or week.")
        games.append(
            GameRecord(
                game_id, season, int(week), gameday, kickoff_instant(gameday, gametime), home, away,
                _text(row, "roof"), _text(row, "stadium_id"), _number(row, "temp"), _number(row, "wind"),
            )
        )  # fmt: skip
    return games


@dataclass(frozen=True, slots=True)
class WeatherRow:
    game_id: str
    season: int
    week: int
    home_team: str
    away_team: str
    stadium_id: str | None
    kickoff_at: datetime
    roof: str | None
    temperature_f: float | None = None
    temperature_source: str | None = None
    wind_mph: float | None = None
    wind_source: str | None = None
    precipitation: int | None = None
    precipitation_source: str | None = None
    precipitation_kind: str | None = None
    precipitation_mm: float | None = None
    isd_precipitation: int | None = None
    isd_station: str | None = None
    isd_distance_km: float | None = None
    isd_precipitation_station: str | None = None
    as_of: datetime | None = None


def _first(*candidates: tuple[float | None, str]) -> tuple[float | None, str | None]:
    for value, source in candidates:
        if value is not None:
            return value, source
    return None, None


IsdLookup = Callable[[GameRecord], KickoffWeather | None]


def fill(game: GameRecord, weather_text: str | None, isd: IsdLookup) -> WeatherRow:
    """One game's row, each value from the first source that has it."""
    row = WeatherRow(
        game.game_id, game.season, game.week, game.home_team, game.away_team, game.stadium_id, game.kickoff_at,
        game.roof, as_of=kickoff_as_of(game.gameday, PUBLICATION_LAG_HOURS),
    )  # fmt: skip
    if not game.outside:
        return row
    # A line with neither a temperature nor a wind ("Temp: ° F, Wind: mph") was never filled in, so it
    # says nothing about precipitation either.
    line = weather_text or ""
    filled_in = gamebook.temperature_f(line) is not None or gamebook.wind_mph(line) is not None
    station = isd(game)
    temperature, temperature_source = _first(
        (game.temp, GAMES_TABLE),
        (gamebook.temperature_f(line), GAMEBOOK),
        (None if station is None else station.temperature_f, ISD),
    )
    wind, wind_source = _first(
        (game.wind, GAMES_TABLE),
        (gamebook.wind_mph(line), GAMEBOOK),
        (None if station is None else station.wind_mph, ISD),
    )
    word = gamebook.precipitation(line) if filled_in else None
    flag, flag_source, kind = (
        (word.flag, GAMEBOOK, word.kind)
        if word is not None
        else (None, None, None)
        if station is None or station.precipitation is None
        else (station.precipitation, ISD, station.kind)
    )
    return replace(
        row,
        temperature_f=temperature, temperature_source=temperature_source,
        wind_mph=wind, wind_source=wind_source,
        precipitation=flag, precipitation_source=flag_source, precipitation_kind=kind,
        precipitation_mm=None if station is None else station.precipitation_mm,
        isd_precipitation=None if station is None else station.precipitation,
        isd_station=None if station is None else station.station,
        isd_distance_km=None if station is None else station.distance_km,
        isd_precipitation_station=None if station is None else station.precipitation_station,
    )  # fmt: skip


_TEXTS: Final = text(
    f"select distinct on (game_id) game_id, weather from {NFLVERSE_PBP_PLAYS.fullname} "
    "where season = any(:seasons) and weather is not null order by game_id, play_id"
)
_HAS_PLAYS: Final = text(f"select exists (select 1 from {NFLVERSE_PBP_PLAYS.fullname} where season = :season)")
_HAS_STADIUMS: Final = text("select to_regclass('research.stadiums') is not null")
_STADIUMS: Final = text("select stadium_id, latitude, longitude from research.stadiums")


def weather_texts(conn: Connection, seasons: Sequence[int]) -> dict[str, str]:
    return {str(r.game_id): str(r.weather) for r in conn.execute(_TEXTS, {"seasons": list(seasons)})}


def stadium_coordinates(conn: Connection) -> Coordinates | None:
    """Each stadium's coordinates, or None when `research.stadiums` is not in this store yet."""
    if not conn.execute(_HAS_STADIUMS).scalar_one():
        return None
    return {str(r.stadium_id): (float(r.latitude), float(r.longitude)) for r in conn.execute(_STADIUMS)}


def isd_lookup(reader: IsdReader | None, coordinates: Coordinates | None) -> IsdLookup:
    def lookup(game: GameRecord) -> KickoffWeather | None:
        place = None if coordinates is None or game.stadium_id is None else coordinates.get(game.stadium_id)
        if reader is None or place is None:
            return None
        latitude, longitude = place
        return reader.weather(latitude, longitude, game.season, game.kickoff_at)

    return lookup


def record_weather(conn: Connection, rows: Sequence[WeatherRow]) -> int:
    """Insert new games and rewrite a game whose values moved; the count written."""
    written = 0
    for row in rows:
        values = asdict(row)
        statement = insert(GAME_WEATHER).values(values)
        changed = {k: statement.excluded[k] for k in values if k != "game_id"}
        moved = or_(*(GAME_WEATHER.c[k].is_distinct_from(statement.excluded[k]) for k in changed))
        upsert = statement.on_conflict_do_update(index_elements=["game_id"], set_=changed, where=moved)
        written += len(conn.execute(upsert.returning(GAME_WEATHER.c.game_id)).all())
    return written


@dataclass(frozen=True, slots=True)
class WeatherReport:
    season: int
    games: int
    outside: int
    written: int
    sources: Mapping[str, Counter[str | None]]
    missing: Mapping[str, int]
    precipitation: Counter[int | None]
    agreement: tuple[int, int]
    isd_read: bool

    def lines(self) -> list[str]:
        def shown(counts: Counter[str | None]) -> str:
            return ", ".join(f"{source or 'missing'} {n}" for source, n in sorted(counts.items(), key=str))

        agree, both = self.agreement
        isd = "" if self.isd_read else " (no ISD read: research.stadiums is not in this store)"
        return [
            f"game weather {self.season}: {self.written} rows written, {self.games} games, {self.outside} outside{isd}",
            f"  temperature: {shown(self.sources['temperature'])}",
            f"  wind: {shown(self.sources['wind'])}",
            f"  precipitation: {shown(self.sources['precipitation'])}; flag 1 in {self.precipitation[1]}, "
            f"0 in {self.precipitation[0]}",
            f"  the gamebook word against ISD's gauge: {agree} of {both} games with both agree",
        ]


def weather_report(season: int, rows: Sequence[WeatherRow], written: int, isd_read: bool) -> WeatherReport:
    outside = [r for r in rows if r.roof not in INDOOR_ROOFS]
    both = [r for r in outside if r.precipitation_source == GAMEBOOK and r.isd_precipitation is not None]
    return WeatherReport(
        season,
        len(rows),
        len(outside),
        written,
        {
            "temperature": Counter(r.temperature_source for r in outside),
            "wind": Counter(r.wind_source for r in outside),
            "precipitation": Counter(r.precipitation_source for r in outside),
        },
        {
            "temperature": sum(r.temperature_f is None for r in outside),
            "wind": sum(r.wind_mph is None for r in outside),
            "precipitation": sum(r.precipitation is None for r in outside),
        },
        Counter(r.precipitation for r in outside),
        (sum(r.precipitation == r.isd_precipitation for r in both), len(both)),
        isd_read,
    )


def ingest_game_weather(
    conn: Connection, client: NflverseClient, reader: IsdReader | None, seasons: Sequence[int]
) -> list[WeatherReport]:
    """Every regular-season game of `seasons`; `reader` None reads no ISD. A season with no plays in the
    play table is refused: its gamebook lines are not stored yet, and ISD would stand in for them."""
    unplayed = [s for s in seasons if not conn.execute(_HAS_PLAYS, {"season": s}).scalar_one()]
    if unplayed:
        raise SchemaDriftError(f"the play table holds no plays of {unplayed}; run pbp-plays for them first.")
    games = game_records(schedule_client(client).get_csv(SCHEDULE_RELEASE, SCHEDULE_FILE), seasons)
    texts = weather_texts(conn, seasons)
    coordinates = stadium_coordinates(conn)
    lookup = isd_lookup(reader, coordinates)
    reports = []
    for season in seasons:
        rows = [fill(g, texts.get(g.game_id), lookup) for g in games if g.season == season]
        written = record_weather(conn, rows)
        reports.append(weather_report(season, rows, written, reader is not None and coordinates is not None))
    return reports
