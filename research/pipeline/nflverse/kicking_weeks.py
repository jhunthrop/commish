"""THE KICKER'S WEEKLY LINE (`src/projections/nflverse/kicking-weeks.ts`).

From the modern `stats_player` release, rows whose position is `K`, kicking columns only, into
`nflverse_kicking_weeks`. A blank count is zero; a missing column is a schema change and throws
(it would otherwise produce a kicker who never kicked). An unchanged re-run writes nothing.
"""

import functools
import json
from collections.abc import Sequence
from dataclasses import dataclass

from sqlalchemy import Connection
from sqlalchemy.dialects.postgresql import insert

from research.db.schema import NFLVERSE_KICKING_WEEKS
from research.db.upsert import changed_row_where, excluded_set
from research.errors import SchemaDriftError
from research.pipeline.jscompat import js_is_finite, js_is_integer, js_locale_compare, js_number, js_trim
from research.pipeline.nflverse.client import NflverseClient
from research.pipeline.nflverse.config import SEASON_TYPE, Releases
from research.pipeline.nflverse.csv import CsvRow
from research.pipeline.nflverse.universe_reads import known_player_ids

KICKING_WEEK_SOURCE = "nflverse_kicking_weeks"
_KICKER_POSITION = "K"
_INSERT_CHUNK_ROWS = 1_000
_NATURAL_KEYS = ("season", "week", "player_id", "ingested_at")

# Table column -> release column. The two 60+ buckets are spelled with a trailing underscore upstream.
NUMERIC_COLUMNS: dict[str, str] = {
    "fg_made": "fg_made",
    "fg_att": "fg_att",
    "fg_missed": "fg_missed",
    "fg_blocked": "fg_blocked",
    "fg_made_0_19": "fg_made_0_19",
    "fg_made_20_29": "fg_made_20_29",
    "fg_made_30_39": "fg_made_30_39",
    "fg_made_40_49": "fg_made_40_49",
    "fg_made_50_59": "fg_made_50_59",
    "fg_made_60": "fg_made_60_",
    "fg_missed_0_19": "fg_missed_0_19",
    "fg_missed_20_29": "fg_missed_20_29",
    "fg_missed_30_39": "fg_missed_30_39",
    "fg_missed_40_49": "fg_missed_40_49",
    "fg_missed_50_59": "fg_missed_50_59",
    "fg_missed_60": "fg_missed_60_",
    "pat_made": "pat_made",
    "pat_att": "pat_att",
    "pat_missed": "pat_missed",
    "pat_blocked": "pat_blocked",
}
_REQUIRED_COLUMNS = ("player_id", "position", "season", "week", "season_type", "team", *NUMERIC_COLUMNS.values())


@dataclass(frozen=True)
class KickingWeekRow:
    season: int
    week: int
    player_id: str
    team: str
    counts: dict[str, float]


def _trimmed(raw: str | None) -> str:
    return js_trim(raw or "")


def count(row: CsvRow, column: str, release: str) -> float:
    """A blank count is zero; anything unreadable throws."""
    raw = _trimmed(row.get(column))
    if raw == "":
        return 0.0
    value = js_number(raw)
    if not js_is_finite(value):
        shown = "undefined" if row.get(column) is None else json.dumps(row.get(column))
        raise SchemaDriftError(f"nflverse {release} row has an unreadable {column} ({shown}).")
    return value


def parse_season_week(row: CsvRow, release: str) -> tuple[int, int]:
    season_text = _trimmed(row.get("season"))
    week_text = _trimmed(row.get("week"))
    season = js_number(season_text)
    week = js_number(week_text)
    if season_text == "" or week_text == "" or not js_is_integer(season) or not js_is_integer(week):
        raise SchemaDriftError(
            f"nflverse {release} row has no readable season/week "
            f"(got {json.dumps(row.get('season'))}/{json.dumps(row.get('week'))})."
        )
    return int(season), int(week)


def _assert_shape(rows: Sequence[CsvRow]) -> None:
    if not rows:
        return
    missing = [column for column in _REQUIRED_COLUMNS if column not in rows[0]]
    if missing:
        raise SchemaDriftError(
            f"nflverse stats_player file is missing column(s) {', '.join(missing)}. The published schema changed; "
            "mapping this file anyway would read every missing column as zero and produce a kicker who never kicked."
        )


def _order(a: KickingWeekRow, b: KickingWeekRow) -> int:
    return (a.season - b.season) or (a.week - b.week) or js_locale_compare(a.player_id, b.player_id)


def map_kicking_week_rows(rows: Sequence[CsvRow]) -> list[KickingWeekRow]:
    _assert_shape(rows)
    by_key: dict[str, KickingWeekRow] = {}
    for row in rows:
        if _trimmed(row.get("season_type")) != SEASON_TYPE:
            continue
        if _trimmed(row.get("position")) != _KICKER_POSITION:
            continue
        player_id = _trimmed(row.get("player_id"))
        if player_id == "":
            continue
        season, week = parse_season_week(row, "stats_player")
        team = _trimmed(row.get("team"))
        if team == "":
            continue
        counts = {field: count(row, column, "stats_player") for field, column in NUMERIC_COLUMNS.items()}
        by_key[f"{season}|{week}|{player_id}"] = KickingWeekRow(season, week, player_id, team, counts)
    return sorted(by_key.values(), key=functools.cmp_to_key(_order))


def record_kicking_week_rows(conn: Connection, rows: Sequence[KickingWeekRow]) -> int:
    table = NFLVERSE_KICKING_WEEKS
    written = 0
    for start in range(0, len(rows), _INSERT_CHUNK_ROWS):
        chunk = [
            {
                "season": row.season,
                "week": row.week,
                "player_id": row.player_id,
                "team": row.team,
                **row.counts,
                "source": KICKING_WEEK_SOURCE,
            }
            for row in rows[start : start + _INSERT_CHUNK_ROWS]
        ]
        statement = insert(table).values(chunk)
        upsert = statement.on_conflict_do_update(
            index_elements=[table.c.season, table.c.week, table.c.player_id],
            set_=excluded_set(statement, table, _NATURAL_KEYS),
            where=changed_row_where(statement, table, _NATURAL_KEYS),
        ).returning(table.c.season)
        written += len(conn.execute(upsert).all())
    return written


@dataclass(frozen=True)
class KickingWeekIngestReport:
    season: int
    rows_read: int
    kicker_rows: int
    written: int
    unknown_to_universe: int


def ingest_kicking_weeks(
    conn: Connection, client: NflverseClient, seasons: Sequence[int]
) -> list[KickingWeekIngestReport]:
    known = known_player_ids(conn)
    reports: list[KickingWeekIngestReport] = []
    for season in seasons:
        rows = client.get_csv(Releases.STATS_PLAYER, f"stats_player_week_{season}.csv")
        mapped = map_kicking_week_rows(rows)
        insertable = [row for row in mapped if row.player_id in known]
        written = record_kicking_week_rows(conn, insertable)
        reports.append(KickingWeekIngestReport(season, len(rows), len(mapped), written, len(mapped) - len(insertable)))
    return reports
