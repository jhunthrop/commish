"""THE OFFICIAL INJURY REPORT, ARCHIVED VERBATIM (`src/projections/nflverse/injuries.ts`).

One row per (season, week, gsis id) in `nflverse_injuries`, in the report's own words, for every
player the universe holds (a foreign-key requirement, not a scoring one). Two published shapes:
2013 to 2024 carry `date_modified`, 2025 onward do not. Within a file, a duplicated player-week
keeps the later stamp, or the later row when there is no stamp. The upsert never lets a null stamp
erase a real one, and an unchanged re-run writes nothing.
"""

import functools
import json
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import Connection, func
from sqlalchemy.dialects.postgresql import insert

from research.db.schema import NFLVERSE_INJURIES
from research.db.upsert import changed_row_where, excluded_set
from research.errors import SchemaDriftError
from research.pipeline.jscompat import js_epoch_ms, js_is_integer, js_locale_compare, js_number, js_trim
from research.pipeline.nflverse.client import NflverseClient
from research.pipeline.nflverse.config import SEASON_TYPE, Releases
from research.pipeline.nflverse.csv import CsvRow
from research.pipeline.nflverse.injury_reports import INJURY_SOURCE, has_date_modified_column, report_filed_at
from research.pipeline.nflverse.universe_reads import known_player_ids
from research.pipeline.observations import INSERT_CHUNK_ROWS

_REQUIRED_COLUMNS = (
    "season",
    "game_type",
    "week",
    "gsis_id",
    "report_status",
    "report_primary_injury",
    "practice_status",
)
_NATURAL_KEYS = ("season", "week", "player_id", "ingested_at")


@dataclass(frozen=True)
class InjuryRow:
    season: int
    week: int
    player_id: str
    report_status: str
    primary_injury: str
    practice_status: str
    date_modified: datetime | None


def _assert_shape(rows: Sequence[CsvRow]) -> None:
    if not rows:
        return
    missing = [column for column in _REQUIRED_COLUMNS if column not in rows[0]]
    if missing:
        raise SchemaDriftError(
            f"nflverse injuries file is missing column(s) {', '.join(missing)}. The published schema changed; "
            "mapping this file anyway would silently coarsen every row on the missing column rather than refusing."
        )


def _trimmed(raw: str | None) -> str:
    return js_trim(raw or "")


def _keeps(candidate: InjuryRow, existing: InjuryRow) -> bool:
    if candidate.date_modified is None or existing.date_modified is None:
        return True
    return js_epoch_ms(candidate.date_modified) >= js_epoch_ms(existing.date_modified)


def _order(a: InjuryRow, b: InjuryRow) -> int:
    return (a.season - b.season) or (a.week - b.week) or js_locale_compare(a.player_id, b.player_id)


def map_injury_rows(rows: Sequence[CsvRow]) -> list[InjuryRow]:
    """`mapInjuryRows`: one row per player-week, the latest filing kept."""
    _assert_shape(rows)
    stamped = has_date_modified_column(rows)
    latest: dict[str, InjuryRow] = {}
    for row in rows:
        if row.get("game_type") != SEASON_TYPE:
            continue
        player_id = _trimmed(row.get("gsis_id"))
        if player_id == "":
            continue
        season_text = _trimmed(row.get("season"))
        week_text = _trimmed(row.get("week"))
        season = js_number(season_text)
        week = js_number(week_text)
        if season_text == "" or week_text == "" or not js_is_integer(season) or not js_is_integer(week):
            raise SchemaDriftError(
                "nflverse injuries row has no readable season/week "
                f"(got {json.dumps(row.get('season'))}/{json.dumps(row.get('week'))})."
            )
        candidate = InjuryRow(
            season=int(season),
            week=int(week),
            player_id=player_id,
            report_status=_trimmed(row.get("report_status")),
            primary_injury=_trimmed(row.get("report_primary_injury")),
            practice_status=_trimmed(row.get("practice_status")),
            date_modified=report_filed_at(row.get("date_modified")) if stamped else None,
        )
        key = f"{candidate.season}|{candidate.week}|{player_id}"
        existing = latest.get(key)
        if existing is None or _keeps(candidate, existing):
            latest[key] = candidate
    return sorted(latest.values(), key=functools.cmp_to_key(_order))


def record_injury_rows(conn: Connection, rows: Sequence[InjuryRow]) -> int:
    """`recordInjuryRows`: upsert on the natural key, coalescing the stamp, counting what moved."""
    table = NFLVERSE_INJURIES
    written = 0
    for start in range(0, len(rows), INSERT_CHUNK_ROWS):
        chunk = [
            {
                "season": row.season,
                "week": row.week,
                "player_id": row.player_id,
                "report_status": row.report_status,
                "primary_injury": row.primary_injury,
                "practice_status": row.practice_status,
                "date_modified": row.date_modified,
                "source": INJURY_SOURCE,
            }
            for row in rows[start : start + INSERT_CHUNK_ROWS]
        ]
        statement = insert(table).values(chunk)
        update = {
            **excluded_set(statement, table, _NATURAL_KEYS),
            "date_modified": func.coalesce(statement.excluded.date_modified, table.c.date_modified),
        }
        upsert = statement.on_conflict_do_update(
            index_elements=[table.c.season, table.c.week, table.c.player_id],
            set_=update,
            where=changed_row_where(statement, table, _NATURAL_KEYS),
        ).returning(table.c.season)
        written += len(conn.execute(upsert).all())
    return written


@dataclass(frozen=True)
class InjuryIngestReport:
    season: int
    rows_read: int
    written: int
    unknown_to_universe: int


def ingest_injuries(conn: Connection, client: NflverseClient, seasons: Sequence[int]) -> list[InjuryIngestReport]:
    """`ingestInjuries`: one archive pass per season, filtered to the stored universe."""
    known = known_player_ids(conn)
    reports: list[InjuryIngestReport] = []
    for season in seasons:
        rows = client.get_csv(Releases.INJURIES, f"injuries_{season}.csv")
        mapped = map_injury_rows(rows)
        insertable = [row for row in mapped if row.player_id in known]
        written = record_injury_rows(conn, insertable)
        reports.append(InjuryIngestReport(season, len(rows), written, len(mapped) - len(insertable)))
    return reports
