"""EVERY NFL DRAFT PICK (`src/projections/nflverse/draft-picks.ts`), into `nfl_draft_picks`.

One file for the whole history. A row missing any of season, round, pick, gsis id, position or
club is dropped (a round-seven pick pfr never gave an NFL id is the real case). A pick is knowable
from May 1 of its draft year. A pick never changes once made, so the write is insert-or-ignore.
"""

import functools
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy import Connection

from research.db.schema import NFL_DRAFT_PICKS
from research.pipeline.jscompat import js_is_integer, js_number, js_trim
from research.pipeline.nflverse.client import NflverseClient
from research.pipeline.nflverse.config import Files, Releases
from research.pipeline.nflverse.csv import CsvRow
from research.pipeline.nflverse.universe_reads import known_player_ids
from research.pipeline.observations import insert_ignoring_conflicts


@dataclass(frozen=True)
class DraftPickRow:
    season: int
    round: int
    pick: int
    player_id: str
    position: str
    team: str
    as_of: datetime


def _text(row: CsvRow, column: str) -> str | None:
    raw = row.get(column)
    if raw is None or js_trim(raw) == "":
        return None
    return js_trim(raw)


def _whole(row: CsvRow, column: str, at_least: int) -> int | None:
    raw = _text(row, column)
    if raw is None:
        return None
    value = js_number(raw)
    return int(value) if js_is_integer(value) and value >= at_least else None


def draft_known_by_as_of(season: int) -> datetime:
    return datetime(season, 5, 1, tzinfo=UTC)


def map_draft_picks(
    rows: Sequence[CsvRow], as_of: Callable[[int], datetime] = draft_known_by_as_of
) -> list[DraftPickRow]:
    entries: list[DraftPickRow] = []
    for row in rows:
        season = _whole(row, "season", 1936)
        round_ = _whole(row, "round", 1)
        pick = _whole(row, "pick", 1)
        player_id = _text(row, "gsis_id")
        position = _text(row, "position")
        team = _text(row, "team")
        if season is None or round_ is None or pick is None or player_id is None or position is None or team is None:
            continue
        entries.append(DraftPickRow(season, round_, pick, player_id, position, team, as_of(season)))

    def order(a: DraftPickRow, b: DraftPickRow) -> int:
        return (a.season - b.season) or (a.pick - b.pick)

    return sorted(entries, key=functools.cmp_to_key(order))


def record_draft_picks(conn: Connection, rows: Sequence[DraftPickRow]) -> int:
    return insert_ignoring_conflicts(
        conn,
        NFL_DRAFT_PICKS,
        [
            {
                "season": r.season,
                "round": r.round,
                "pick": r.pick,
                "player_id": r.player_id,
                "position": r.position,
                "team": r.team,
                "as_of": r.as_of,
            }
            for r in rows
        ],
    )


@dataclass(frozen=True)
class DraftPickIngestReport:
    entries_read: int
    written: int
    unknown_to_universe: int


def ingest_draft_picks(conn: Connection, client: NflverseClient) -> DraftPickIngestReport:
    entries = map_draft_picks(client.get_csv(Releases.DRAFT_PICKS, Files.DRAFT_PICKS))
    known = known_player_ids(conn)
    insertable = [entry for entry in entries if entry.player_id in known]
    written = record_draft_picks(conn, insertable)
    return DraftPickIngestReport(len(entries), written, len(entries) - len(insertable))
