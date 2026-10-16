"""NFLVERSE'S GAME TABLE INTO `nflverse_games` (Lane 66a; the round 4 preregistration, sections 2.5, 2.9).

The same `games.csv` the schedule ingest reads (`nflverse/nfldata`), kept one row per game with the
columns the round and the week facts read: the clubs, the Eastern day and time (and the instant they
make), the score and result, the closing figures, the roof, the surface, the recorded weather and the
venue. Every game type is kept, 2016 on; `game_type` says which.

A PASS IS STAMPED AND IDEMPOTENT. A game's row is written when it is new or when any of its values
moved (a future game's figures and venue move until kickoff, its result lands after), and `read_at`
is the pass that wrote it. A re-run over the same file writes nothing. A row missing a column the
table cannot do without (the clubs, the day, the venue) is refused, never written half.
"""

import re
from collections import Counter
from collections.abc import Iterable, Sequence
from dataclasses import asdict, dataclass
from datetime import date, datetime
from typing import Final

from sqlalchemy import Connection, tuple_
from sqlalchemy.dialects.postgresql import insert

from research.db.schema import NFLVERSE_GAMES
from research.errors import SchemaDriftError
from research.pipeline.nflverse.client import NflverseClient
from research.pipeline.nflverse.config import SEASON_TYPE
from research.pipeline.nflverse.csv import CsvRow
from research.pipeline.nflverse.ingest import schedule_client
from research.pipeline.nflverse.schedule import SCHEDULE_FILE, SCHEDULE_RELEASE, kickoff_instant

GAMES_FIRST_SEASON: Final = 2016
# A roof that keeps the weather out: the schedule ingest's `indoors` (`schedule._INDOOR_ROOFS`).
INDOOR_ROOFS: Final = ("dome", "closed")

_NUMBER: Final = re.compile(r"^-?\d+(\.\d+)?$")
_INTEGER: Final = re.compile(r"^-?\d+$")
_DAY: Final = re.compile(r"^\d{4}-\d{2}-\d{2}$")


@dataclass(frozen=True)
class GameRow:
    game_id: str
    season: int
    game_type: str
    week: int
    gameday: date
    gametime: str | None
    kickoff_at: datetime | None
    home_team: str
    away_team: str
    location: str
    home_score: int | None
    away_score: int | None
    result: int | None
    spread_line: float | None
    total_line: float | None
    roof: str | None
    surface: str | None
    temp: float | None
    wind: float | None
    stadium_id: str
    stadium: str


def _text(row: CsvRow, column: str) -> str | None:
    value = row.get(column)
    if value is None:
        raise SchemaDriftError(f"games.csv has no {column} column; the file's schema changed.")
    trimmed = value.strip()
    return trimmed or None


def _required(row: CsvRow, column: str) -> str:
    value = _text(row, column)
    if value is None:
        raise SchemaDriftError(f"games.csv row {row.get('game_id', '?')} has no {column}.")
    return value


def _number(row: CsvRow, column: str) -> float | None:
    value = _text(row, column)
    if value is None:
        return None
    if _NUMBER.fullmatch(value) is None:
        raise SchemaDriftError(f"games.csv row {row.get('game_id', '?')} has an unreadable {column} ({value!r}).")
    return float(value)


def _integer(row: CsvRow, column: str) -> int | None:
    value = _text(row, column)
    if value is None:
        return None
    if _INTEGER.fullmatch(value) is None:
        raise SchemaDriftError(f"games.csv row {row.get('game_id', '?')} has an unreadable {column} ({value!r}).")
    return int(value)


def _game(row: CsvRow) -> GameRow:
    gameday = _required(row, "gameday")
    if _DAY.fullmatch(gameday) is None:
        raise SchemaDriftError(f"games.csv row {row.get('game_id', '?')} has an unreadable gameday ({gameday!r}).")
    gametime = _text(row, "gametime")
    week = _integer(row, "week")
    if week is None:
        raise SchemaDriftError(f"games.csv row {row.get('game_id', '?')} has no week.")
    return GameRow(
        game_id=_required(row, "game_id"),
        season=int(_required(row, "season")),
        game_type=_required(row, "game_type"),
        week=week,
        gameday=date.fromisoformat(gameday),
        gametime=gametime,
        kickoff_at=None if gametime is None else kickoff_instant(gameday, gametime),
        home_team=_required(row, "home_team"),
        away_team=_required(row, "away_team"),
        location=_required(row, "location"),
        home_score=_integer(row, "home_score"),
        away_score=_integer(row, "away_score"),
        result=_integer(row, "result"),
        spread_line=_number(row, "spread_line"),
        total_line=_number(row, "total_line"),
        roof=_text(row, "roof"),
        surface=_text(row, "surface"),
        temp=_number(row, "temp"),
        wind=_number(row, "wind"),
        stadium_id=_required(row, "stadium_id"),
        stadium=_required(row, "stadium"),
    )


def map_games(rows: Iterable[CsvRow], seasons: Iterable[int]) -> list[GameRow]:
    """Every game of the named seasons, any game type."""
    wanted = {str(season) for season in seasons}
    return [_game(row) for row in rows if (row.get("season") or "").strip() in wanted]


def is_outdoors(game: GameRow) -> bool:
    """Neither a dome nor a closed roof: the schedule ingest's `indoors` 0, an unrecorded roof included."""
    return game.roof not in INDOOR_ROOFS


def missing_weather(games: Sequence[GameRow]) -> dict[int, tuple[int, int]]:
    """Per season, the outdoor regular-season club-games with no temperature or wind, and all of them."""
    outdoor = [g for g in games if g.game_type == SEASON_TYPE and is_outdoors(g)]
    missing = Counter(g.season for g in outdoor if g.temp is None or g.wind is None)
    total = Counter(g.season for g in outdoor)
    return {season: (2 * missing[season], 2 * total[season]) for season in sorted(total)}


@dataclass(frozen=True)
class GamesReport:
    games_per_season: dict[int, int]
    written: int
    missing_weather: dict[int, tuple[int, int]]

    def line(self) -> str:
        seasons = ", ".join(f"{s} {n}" for s, n in sorted(self.games_per_season.items()))
        weather = ", ".join(f"{s} {m} of {t}" for s, (m, t) in self.missing_weather.items())
        return f"{self.written} games written or updated; games per season: {seasons}; outdoor club-games with no recorded weather: {weather}"


_CHUNK: Final = 500


def _upsert(conn: Connection, games: Sequence[GameRow], read_at: datetime) -> int:
    """Insert a new game, update one whose values moved, leave the rest: the rows actually written."""
    table = NFLVERSE_GAMES
    values = [c.name for c in table.columns if c.name not in ("game_id", "read_at", "ingested_at")]
    written = 0
    for start in range(0, len(games), _CHUNK):
        chunk = [{**asdict(g), "read_at": read_at} for g in games[start : start + _CHUNK]]
        rows = insert(table).values(chunk)
        moved = tuple_(*(table.c[name] for name in values)).is_distinct_from(
            tuple_(*(rows.excluded[name] for name in values))
        )
        upsert = rows.on_conflict_do_update(
            index_elements=[table.c.game_id],
            set_={**{name: rows.excluded[name] for name in values}, "read_at": rows.excluded.read_at},
            where=moved,
        ).returning(table.c.game_id)
        written += len(conn.execute(upsert).all())
    return written


def ingest_games(conn: Connection, client: NflverseClient, seasons: Iterable[int], read_at: datetime) -> GamesReport:
    """One read of `games.csv` into `nflverse_games` for the named seasons, stamped at `read_at`."""
    rows = schedule_client(client).get_csv(SCHEDULE_RELEASE, SCHEDULE_FILE)
    games = map_games(rows, seasons)
    written = _upsert(conn, games, read_at)
    per_season = dict(sorted(Counter(g.season for g in games).items()))
    return GamesReport(per_season, written, missing_weather(games))
