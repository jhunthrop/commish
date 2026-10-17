"""THE WEEK READS' ROWS (revision 0012, `research.player_week_reads`): one per player and week.

Keyed on the universe id, the season and the week the read is for. A rewrite in the same week replaces
the row (the cadence says when, `cadence`); a new week is a new row, so last week's read stays on file.
Each row keeps the write's instant, the facts' newest stamp and every fact's own (`sheet.stamps`), and
what the cadence compares against: the published projection and the status it was written with.
"""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from sqlalchemy import Connection, text
from sqlalchemy.dialects.postgresql import insert

from research.db.schema import PLAYER_WEEK_READS


@dataclass(frozen=True, slots=True)
class StoredWeekRead:
    player_id: str
    season: int
    week: int
    source: str
    body: str
    model: str | None
    written_at: datetime
    facts_at: datetime | None
    stamps: Mapping[str, str]
    projection_points: float | None
    status: str | None
    reason: str


def _row(r: Any) -> StoredWeekRead:
    return StoredWeekRead(
        r.player_id,
        r.season,
        r.week,
        r.source,
        r.body,
        r.model,
        r.written_at,
        r.facts_at,
        dict(r.stamps),
        r.projection_points,
        r.status,
        r.reason,
    )


_COLUMNS = (
    "player_id, season, week, source, body, model, written_at, facts_at, stamps, projection_points, status, reason"
)


def stored_week_reads(conn: Connection, season: int, weeks: Sequence[int]) -> dict[tuple[str, int], StoredWeekRead]:
    """Every row of these weeks, by (player, week)."""
    if not weeks:
        return {}
    rows = conn.execute(
        text(f"select {_COLUMNS} from research.player_week_reads where season = :s and week = any(:weeks)"),
        {"s": season, "weeks": list(weeks)},
    )
    return {(r.player_id, r.week): _row(r) for r in rows}


def served_week_reads(
    conn: Connection, season: int, from_week: int, player_ids: Sequence[str]
) -> dict[str, StoredWeekRead]:
    """Each player's newest read for a week not yet behind the run (`from_week` on), for his page."""
    if not player_ids:
        return {}
    rows = conn.execute(
        text(
            f"select distinct on (player_id) {_COLUMNS} from research.player_week_reads "
            "where season = :s and week >= :w and player_id = any(:ids) order by player_id, week"
        ),
        {"s": season, "w": from_week, "ids": list(player_ids)},
    )
    return {r.player_id: _row(r) for r in rows}


def upsert_week_read(conn: Connection, row: StoredWeekRead) -> None:
    """One row per player and week: a rewrite replaces it whole."""
    values = {
        "player_id": row.player_id,
        "season": row.season,
        "week": row.week,
        "source": row.source,
        "body": row.body,
        "model": row.model,
        "written_at": row.written_at,
        "facts_at": row.facts_at,
        "stamps": dict(row.stamps),
        "projection_points": row.projection_points,
        "status": row.status,
        "reason": row.reason,
    }
    statement = insert(PLAYER_WEEK_READS).values(values)
    keys = ("player_id", "season", "week")
    conn.execute(
        statement.on_conflict_do_update(
            index_elements=list(keys), set_={k: statement.excluded[k] for k in values if k not in keys}
        )
    )
