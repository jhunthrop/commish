"""THE POINT-IN-TIME STORE'S ROW SHAPES AND WRITERS (`src/projections/store.ts`, `team-store.ts`).

Three tables carry a fact with the moment it became knowable: `player_week_observations`,
`team_week_observations` and `player_week_teams`. Each writer is idempotent (ON CONFLICT DO
NOTHING on the fact's unique index) and returns how many rows were ACTUALLY new, so a re-run of a
landed ingest reports 0. A batch stating two different values for one fact at one instant is a
mapper bug and raises before anything is written, exactly as the TypeScript `assertCoherent` does.
"""

import math
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import Connection, Table, and_, delete
from sqlalchemy.dialects.postgresql import insert

from research.db.schema import PLAYER_WEEK_OBSERVATIONS, PLAYER_WEEK_TEAMS, TEAM_WEEK_OBSERVATIONS
from research.errors import CoherenceError
from research.pipeline.jscompat import js_epoch_ms, js_iso, js_string

# Postgres caps a statement at 65,535 bound parameters; the TypeScript writers chunk at 2,000 rows.
INSERT_CHUNK_ROWS = 2_000

# Eighteen regular-season weeks plus four rounds of playoffs: above every real week.
LAST_POSSIBLE_WEEK = 22


@dataclass(frozen=True)
class PlayerWeekObservation:
    season: int
    week: int
    player_id: str
    source: str
    metric: str
    value: float
    as_of: datetime


@dataclass(frozen=True)
class TeamWeekObservation:
    season: int
    week: int
    team: str
    source: str
    metric: str
    value: float
    as_of: datetime


@dataclass(frozen=True)
class PlayerWeekTeam:
    season: int
    week: int
    player_id: str
    team: str
    as_of: datetime


def _assert_player_coherent(rows: Sequence[PlayerWeekObservation]) -> None:
    seen: dict[tuple[int, int, str, str, str, int], float] = {}
    for row in rows:
        if not math.isfinite(row.value):
            raise CoherenceError(
                f"Observation {row.source}/{row.metric} for player {row.player_id} "
                f"({row.season} week {row.week}) is not a finite number."
            )
        key = (row.season, row.week, row.player_id, row.source, row.metric, js_epoch_ms(row.as_of))
        previous = seen.get(key)
        if previous is not None and previous != row.value:
            raise CoherenceError(
                f"Observations contradict: {row.source}/{row.metric} for player {row.player_id} "
                f"({row.season} week {row.week}) is both {js_string(previous)} and {js_string(row.value)} "
                f"as of {js_iso(row.as_of)}."
            )
        seen[key] = row.value


def _assert_team_coherent(rows: Sequence[TeamWeekObservation]) -> None:
    seen: dict[tuple[int, int, str, str, str, int], float] = {}
    for row in rows:
        if not math.isfinite(row.value):
            raise CoherenceError(
                f"Team observation {row.source}/{row.metric} for {row.team} ({row.season} week {row.week}) "
                "is not a finite number."
            )
        key = (row.season, row.week, row.team, row.source, row.metric, js_epoch_ms(row.as_of))
        previous = seen.get(key)
        if previous is not None and previous != row.value:
            raise CoherenceError(
                f"Team observations contradict: {row.source}/{row.metric} for {row.team} "
                f"({row.season} week {row.week}) is both {js_string(previous)} and {js_string(row.value)} "
                f"as of {js_iso(row.as_of)}."
            )
        seen[key] = row.value


def insert_ignoring_conflicts(conn: Connection, table: Table, rows: Sequence[dict[str, object]]) -> int:
    """Chunked `INSERT ... ON CONFLICT DO NOTHING RETURNING`, counting the rows actually written."""
    written = 0
    for start in range(0, len(rows), INSERT_CHUNK_ROWS):
        chunk = rows[start : start + INSERT_CHUNK_ROWS]
        statement = insert(table).values(list(chunk)).on_conflict_do_nothing().returning(table.c[_first_key(table)])
        written += len(conn.execute(statement).all())
    return written


def _first_key(table: Table) -> str:
    return next(iter(table.primary_key.columns)).name


def record_observations(conn: Connection, rows: Sequence[PlayerWeekObservation]) -> int:
    _assert_player_coherent(rows)
    return insert_ignoring_conflicts(
        conn,
        PLAYER_WEEK_OBSERVATIONS,
        [
            {
                "season": row.season,
                "week": row.week,
                "player_id": row.player_id,
                "source": row.source,
                "metric": row.metric,
                "value": row.value,
                "as_of": row.as_of,
            }
            for row in rows
        ],
    )


def record_team_observations(conn: Connection, rows: Sequence[TeamWeekObservation]) -> int:
    _assert_team_coherent(rows)
    return insert_ignoring_conflicts(
        conn,
        TEAM_WEEK_OBSERVATIONS,
        [
            {
                "season": row.season,
                "week": row.week,
                "team": row.team,
                "source": row.source,
                "metric": row.metric,
                "value": row.value,
                "as_of": row.as_of,
            }
            for row in rows
        ],
    )


def record_player_teams(conn: Connection, rows: Sequence[PlayerWeekTeam]) -> int:
    return insert_ignoring_conflicts(
        conn,
        PLAYER_WEEK_TEAMS,
        [
            {"season": row.season, "week": row.week, "player_id": row.player_id, "team": row.team, "as_of": row.as_of}
            for row in rows
        ],
    )


def delete_observations_by_source(
    conn: Connection, season: int, source: str, metrics: Sequence[str] | None = None
) -> int:
    """`deleteObservationsBySource`: one source's season, optionally narrowed to named metrics."""
    table = PLAYER_WEEK_OBSERVATIONS
    condition = and_(table.c.season == season, table.c.source == source)
    if metrics is not None:
        condition = and_(condition, table.c.metric.in_(list(metrics)))
    return len(conn.execute(delete(table).where(condition).returning(table.c.season)).all())
