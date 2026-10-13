"""THE WEEKLY ROSTER RELEASE, ARCHIVED VERBATIM (`src/projections/nflverse/roster-weeks.ts`).

One row per (season, week, gsis id) in `nflverse_roster_weeks`: the club, the published status
(ACT, RES, ...) and its detail. It stays explicit about a reserve-list placement for the weeks a
player has vanished from the injury report, which is the season-ending case it was built for.
A later duplicate of a key in one file wins; an unchanged re-run writes nothing.
"""

import functools
import json
from collections.abc import Sequence
from dataclasses import dataclass

from sqlalchemy import Connection
from sqlalchemy.dialects.postgresql import insert

from research.db.schema import NFLVERSE_ROSTER_WEEKS
from research.db.upsert import changed_row_where, excluded_set
from research.errors import SchemaDriftError
from research.pipeline.jscompat import js_is_integer, js_locale_compare, js_number, js_trim
from research.pipeline.nflverse.client import NflverseClient
from research.pipeline.nflverse.config import SEASON_TYPE, Releases
from research.pipeline.nflverse.csv import CsvRow
from research.pipeline.nflverse.universe_reads import known_player_ids
from research.pipeline.observations import INSERT_CHUNK_ROWS

_REQUIRED_COLUMNS = ("season", "week", "game_type", "team", "gsis_id", "position", "status", "status_description_abbr")
_NATURAL_KEYS = ("season", "week", "player_id", "ingested_at")


@dataclass(frozen=True)
class RosterWeekRow:
    season: int
    week: int
    player_id: str
    team: str
    status: str
    status_detail: str
    position: str


def _trimmed(raw: str | None) -> str:
    return js_trim(raw or "")


def _assert_shape(rows: Sequence[CsvRow]) -> None:
    if not rows:
        return
    missing = [column for column in _REQUIRED_COLUMNS if column not in rows[0]]
    if missing:
        raise SchemaDriftError(
            f"nflverse weekly_rosters file is missing column(s) {', '.join(missing)}. The published schema changed; "
            "mapping this file anyway would silently coarsen every row on the missing column rather than refusing."
        )


def _order(a: RosterWeekRow, b: RosterWeekRow) -> int:
    return (a.season - b.season) or (a.week - b.week) or js_locale_compare(a.player_id, b.player_id)


def map_roster_week_rows(rows: Sequence[CsvRow]) -> list[RosterWeekRow]:
    """`mapRosterWeekRows`: regular season, a row with no club, position or status skipped."""
    _assert_shape(rows)
    by_key: dict[str, RosterWeekRow] = {}
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
                "nflverse weekly_rosters row has no readable season/week "
                f"(got {json.dumps(row.get('season'))}/{json.dumps(row.get('week'))})."
            )
        team = _trimmed(row.get("team"))
        position = _trimmed(row.get("position"))
        status = _trimmed(row.get("status"))
        if team == "" or position == "" or status == "":
            continue
        by_key[f"{int(season)}|{int(week)}|{player_id}"] = RosterWeekRow(
            season=int(season),
            week=int(week),
            player_id=player_id,
            team=team,
            status=status,
            status_detail=_trimmed(row.get("status_description_abbr")),
            position=position,
        )
    return sorted(by_key.values(), key=functools.cmp_to_key(_order))


def record_roster_week_rows(conn: Connection, rows: Sequence[RosterWeekRow]) -> int:
    table = NFLVERSE_ROSTER_WEEKS
    written = 0
    for start in range(0, len(rows), INSERT_CHUNK_ROWS):
        chunk = [
            {
                "season": row.season,
                "week": row.week,
                "player_id": row.player_id,
                "team": row.team,
                "status": row.status,
                "status_detail": row.status_detail,
                "position": row.position,
            }
            for row in rows[start : start + INSERT_CHUNK_ROWS]
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
class RosterWeekIngestReport:
    season: int
    rows_read: int
    written: int
    unknown_to_universe: int


def ingest_roster_weeks(
    conn: Connection, client: NflverseClient, seasons: Sequence[int]
) -> list[RosterWeekIngestReport]:
    known = known_player_ids(conn)
    reports: list[RosterWeekIngestReport] = []
    for season in seasons:
        rows = client.get_csv(Releases.WEEKLY_ROSTERS, f"roster_weekly_{season}.csv")
        mapped = map_roster_week_rows(rows)
        insertable = [row for row in mapped if row.player_id in known]
        written = record_roster_week_rows(conn, insertable)
        reports.append(RosterWeekIngestReport(season, len(rows), written, len(mapped) - len(insertable)))
    return reports
