"""THE PLAY TABLE: nflverse's play-by-play, one row per regular-season play (`nflverse_pbp_plays`).

The weekly round 4's play model prices each target and carry from its depth, field position, down,
distance, location and weather, and its team model counts plays, dropbacks and touchdowns per game
(`docs/research/2026-10-16-weekly-projection-round4-preregistration.md` §2.3, §2.5). The store held
the play-by-play only as aggregates, so this keeps the plays themselves, trimmed to the table's
columns, each named as nflverse names it.

WHICH ROWS. Regular season only (`config.SEASON_TYPE`), and only rows with a `play_type`: the rows
without one are the file's game-start, timeout and quarter-end markers, not plays. A `play_type`
outside the table's vocabulary is a changed release, refused.

STRICT VALUES. Each column is read by its declared type: a flag is "1", "0" or NA (NULL), an integer
column refuses a fraction, a number column refuses text. NA and the empty field are NULL, never zero.

THE STAMP. Every play of a game is stamped as the play-by-play aggregates are (`context`): the end of
the game's UTC day plus the publication lag (preregistration §5 item 7). A re-run writes nothing new
(the key is the game and the play id, first statement kept, as the observations keep theirs).
"""

import datetime as dt
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from typing import Final

from sqlalchemy import Boolean, Column, Connection, Date, Double, Integer, Text

from research.db.schema import NFLVERSE_PBP_PLAYS
from research.db.schema.game_history import PLAY_TYPES
from research.errors import SchemaDriftError
from research.pipeline.jscompat import js_is_finite, js_is_integer, js_number, js_trim
from research.pipeline.nflverse.client import NflverseClient
from research.pipeline.nflverse.config import PUBLICATION_LAG_HOURS, SEASON_TYPE, ByteCaps, Releases
from research.pipeline.nflverse.csv import CsvRow
from research.pipeline.nflverse.pbp import play_by_play_file
from research.pipeline.nflverse.schedule import kickoff_as_of
from research.pipeline.observations import insert_ignoring_conflicts

# The table's columns that are not a column of the file: the stamp and the database's own instant.
_NOT_FROM_FILE: Final = frozenset({"as_of", "ingested_at"})
SOURCE_COLUMNS: Final = tuple(c.name for c in NFLVERSE_PBP_PLAYS.columns if c.name not in _NOT_FROM_FILE)
STREAM_COLUMNS: Final = (*SOURCE_COLUMNS, "season_type")
_FLAG_VALUES: Final = {"1": True, "0": False}


def _missing(raw: str | None) -> bool:
    return raw is None or js_trim(raw) == "" or raw == "NA"


def _drift(play: str, column: str, raw: str, wanted: str) -> SchemaDriftError:
    return SchemaDriftError(f'play-by-play play {play}: {column} is "{raw}", not {wanted}; the release changed.')


def _reader(column: "Column[object]") -> Callable[[str, str, str], object]:
    """The parser for one table column, chosen by its declared type."""
    kind = column.type

    def flag(play: str, name: str, raw: str) -> object:
        value = _FLAG_VALUES.get(raw)
        if value is None:
            raise _drift(play, name, raw, "a 0 or 1 flag")
        return value

    def number(play: str, name: str, raw: str) -> object:
        value = js_number(raw)
        if not js_is_finite(value):
            raise _drift(play, name, raw, "a number")
        return value

    def integer(play: str, name: str, raw: str) -> object:
        value = js_number(raw)
        if not js_is_integer(value):
            raise _drift(play, name, raw, "a whole number")
        return int(value)

    def day(play: str, name: str, raw: str) -> object:
        try:
            return dt.date.fromisoformat(raw)
        except ValueError as error:
            raise _drift(play, name, raw, "a YYYY-MM-DD date") from error

    if isinstance(kind, Boolean):
        return flag
    if isinstance(kind, Double):
        return number
    if isinstance(kind, Integer):
        return integer
    if isinstance(kind, Date):
        return day
    if isinstance(kind, Text):
        return lambda _play, _name, raw: raw
    raise TypeError(f"nflverse_pbp_plays.{column.name} has a type the play reader does not read.")


_READERS: Final = tuple(
    (c.name, c.nullable, _reader(c)) for c in NFLVERSE_PBP_PLAYS.columns if c.name not in _NOT_FROM_FILE
)


def map_play(row: CsvRow) -> dict[str, object] | None:
    """One file row as a table row, or None when it is not a regular-season play."""
    if row.get("season_type") != SEASON_TYPE or _missing(row.get("play_type")):
        return None
    play = f"{row.get('game_id')}/{row.get('play_id')}"
    if row.get("play_type") not in PLAY_TYPES:
        raise _drift(play, "play_type", row.get("play_type") or "", f"one of {', '.join(PLAY_TYPES)}")
    mapped: dict[str, object] = {}
    for name, nullable, read in _READERS:
        raw = row.get(name)
        if raw is None or _missing(raw):
            if not nullable:
                raise SchemaDriftError(f"play-by-play play {play} has no {name}; the release changed.")
            mapped[name] = None
            continue
        mapped[name] = read(play, name, raw)
    game_date = mapped["game_date"]
    assert isinstance(game_date, dt.date)  # a NOT NULL date column, read above
    mapped["as_of"] = kickoff_as_of(game_date.isoformat(), PUBLICATION_LAG_HOURS)
    return mapped


@dataclass(slots=True)
class PlayRows:
    """The plays of one stream, as they arrive: the table rows, and every file row read."""

    rows: list[dict[str, object]] = field(default_factory=list)
    read: int = 0

    def add(self, row: Mapping[str, str]) -> None:
        self.read += 1
        mapped = map_play(row)
        if mapped is not None:
            self.rows.append(mapped)


def record_plays(conn: Connection, rows: list[dict[str, object]]) -> int:
    """Insert the plays not yet stored; the count actually written."""
    return insert_ignoring_conflicts(conn, NFLVERSE_PBP_PLAYS, rows)


@dataclass(frozen=True, slots=True)
class PlaysReport:
    season: int
    rows_read: int
    plays: int
    games: int
    written: int

    def summary(self) -> str:
        return (
            f"play table {self.season}: {self.written} new plays of {self.plays} regular-season plays in "
            f"{self.games} games ({self.rows_read} file rows read)"
        )


def ingest_pbp_plays(conn: Connection, client: NflverseClient, season: int) -> PlaysReport:
    """The season's plays from the gzipped release asset into `nflverse_pbp_plays`."""
    plays = PlayRows()
    capped = NflverseClient(client.fetcher, client.base_url, ByteCaps.PLAY_BY_PLAY)
    capped.stream_csv(Releases.PBP, play_by_play_file(season, compressed=True), STREAM_COLUMNS, plays.add)
    wrong = {r["season"] for r in plays.rows} - {season}
    if wrong:
        raise SchemaDriftError(f"play_by_play_{season} holds plays of season {sorted(map(str, wrong))}; refused.")
    written = record_plays(conn, plays.rows)
    games = len({r["game_id"] for r in plays.rows})
    return PlaysReport(season, plays.read, len(plays.rows), games, written)
