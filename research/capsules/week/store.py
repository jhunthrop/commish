"""THE WEEK READS' ROWS (revision 0012, `research.player_week_reads`): one per player and week.

Keyed on the universe id, the season and the week the read is for. A rewrite in the same week replaces
the row (the cadence says when, `cadence`); a new week is a new row, so last week's read stays on file.
Each row keeps the write's instant, the facts' newest stamp and every fact's own (`sheet.stamps`), the
status the cadence compares against, the published projection it was written with (the card's "Proj at the
read"), the call
the writer classified it as, and its attempts on its Central day. The page serves the row of the board
week only (`served_week_reads`). Each pass's spend is a row of `player_week_read_runs`, which the hourly
passes' daily cap reads (`hourly_spend_since`).
"""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import date, datetime
from typing import Any, Final

from sqlalchemy import Connection, and_, insert, text
from sqlalchemy.dialects.postgresql import insert as upsert

from research.db.schema import PLAYER_WEEK_READ_RUNS, PLAYER_WEEK_READS


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
    call: str | None
    attempt_day: date
    attempts: int


@dataclass(frozen=True, slots=True)
class WeekReadRun:
    """One pass's spend, as `player_week_read_runs` keeps it."""

    ran_at: datetime
    mode: str
    calls: int
    cost_usd: float
    written: int
    facts_blocks: int
    demoted: int


_COLUMNS = (
    "player_id, season, week, source, body, model, written_at, facts_at, stamps, projection_points, status, reason, "
    "call, attempt_day, attempts"
)


def _row(r: Any) -> StoredWeekRead:
    return StoredWeekRead(
        r.player_id, r.season, r.week, r.source, r.body, r.model, r.written_at, r.facts_at, dict(r.stamps),
        r.projection_points, r.status, r.reason, r.call, r.attempt_day, r.attempts,
    )  # fmt: skip


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
    conn: Connection, season: int, board_week: int, player_ids: Sequence[str]
) -> dict[str, StoredWeekRead]:
    """Each player's read for the board week (the site's `board_week`), and no other week's."""
    if not player_ids:
        return {}
    rows = conn.execute(
        text(
            f"select {_COLUMNS} from research.player_week_reads "
            "where season = :s and week = :w and player_id = any(:ids)"
        ),
        {"s": season, "w": board_week, "ids": list(player_ids)},
    )
    return {r.player_id: _row(r) for r in rows}


_KEYS: Final = ("player_id", "season", "week")


def _values(row: StoredWeekRead) -> dict[str, object]:
    return {
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
        "call": row.call,
        "attempt_day": row.attempt_day,
        "attempts": row.attempts,
    }


def upsert_week_read(conn: Connection, row: StoredWeekRead) -> None:
    """One row per player and week: a rewrite replaces it whole."""
    values = _values(row)
    statement = upsert(PLAYER_WEEK_READS).values(values)
    conn.execute(
        statement.on_conflict_do_update(
            index_elements=list(_KEYS), set_={k: statement.excluded[k] for k in values if k not in _KEYS}
        )
    )


def replace_week_read(conn: Connection, row: StoredWeekRead, before: StoredWeekRead | None) -> bool:
    """`row` over the row a pass read (`before`, None for no row), only while that row still stands: its source
    and written instant unchanged (Lane 276 re-review N1, an hourly pass overlapping the nightly). False when
    another pass replaced it meanwhile, and nothing is written."""
    values = _values(row)
    statement = upsert(PLAYER_WEEK_READS).values(values)
    table = PLAYER_WEEK_READS.c
    if before is None:
        guarded = statement.on_conflict_do_nothing(index_elements=list(_KEYS))
    else:
        guarded = statement.on_conflict_do_update(
            index_elements=list(_KEYS),
            set_={k: statement.excluded[k] for k in values if k not in _KEYS},
            where=and_(table.source == before.source, table.written_at == before.written_at),
        )
    # The row back when it was written (the driver states no row count for an upsert).
    return conn.execute(guarded.returning(table.player_id)).first() is not None


def record_run(conn: Connection, run: WeekReadRun) -> None:
    conn.execute(
        insert(PLAYER_WEEK_READ_RUNS).values(
            ran_at=run.ran_at, mode=run.mode, calls=run.calls, cost_usd=run.cost_usd, written=run.written,
            facts_blocks=run.facts_blocks, demoted=run.demoted,
        )
    )  # fmt: skip


def hourly_spend_since(conn: Connection, since: datetime) -> float:
    """What the hourly passes have spent since `since` (the Central day's start), in dollars."""
    spent = conn.execute(
        text(
            "select coalesce(sum(cost_usd), 0) from research.player_week_read_runs where mode = 'hourly' and ran_at >= :t"
        ),
        {"t": since},
    ).scalar_one()
    return float(spent)
