"""The copies' ledger, `research.headshot_copies`: what the sync reads to decide, and every write."""

from dataclasses import dataclass
from datetime import datetime
from typing import Final

from sqlalchemy import Connection, select, text
from sqlalchemy.dialects.postgresql import insert

from research.db.schema import HEADSHOT_COPIES
from research.headshots.config import FACE_STATUSES

# A defense's face is its club's mark, never a copy.
_NO_COPY_POSITIONS: Final = ("DEF",)
CURATED_STATUS: Final = "curated"


@dataclass(frozen=True, slots=True)
class Candidate:
    """A provider player the sync looks at, with his row for the season when he has one."""

    player_id: str
    source_url: str | None
    status: str | None
    copied_from: str | None


@dataclass(frozen=True, slots=True)
class LedgerRow:
    player_id: str
    name: str | None
    position: str | None
    status: str
    reason: str | None
    source_url: str | None
    fetched_at: datetime | None


@dataclass(frozen=True, slots=True)
class Write:
    """One row as a sync or a curator leaves it."""

    status: str
    source_url: str | None
    reason: str | None
    fetched_at: datetime | None
    curated_by: str | None = None
    curated_at: datetime | None = None


def candidates(conn: Connection, season: int) -> list[Candidate]:
    """Every provider player but the defenses, in ADP order, each with his season's row."""
    rows = conn.execute(
        text(
            "select pp.id, pp.headshot_url, h.status, h.source_url as copied_from "
            "from research.provider_players pp "
            "left join research.headshot_copies h on h.season = :s and h.player_id = pp.id "
            "where pp.position <> all(:skip) order by pp.adp asc nulls last, pp.id"
        ),
        {"s": season, "skip": list(_NO_COPY_POSITIONS)},
    )
    return [Candidate(r.id, r.headshot_url or None, r.status, r.copied_from) for r in rows]


def is_provider_player(conn: Connection, player_id: str) -> bool:
    found = conn.execute(text("select 1 from research.provider_players where id = :id"), {"id": player_id})
    return found.first() is not None


def _values(row: Write, now: datetime) -> dict[str, object]:
    return {
        "status": row.status,
        "source_url": row.source_url,
        "reason": row.reason,
        "fetched_at": row.fetched_at,
        "curated_by": row.curated_by,
        "curated_at": row.curated_at,
        "updated_at": now,
    }


def write(conn: Connection, season: int, player_id: str, row: Write, now: datetime) -> None:
    """The row for (season, player), inserted or replaced whole."""
    values = _values(row, now)
    statement = insert(HEADSHOT_COPIES).values(season=season, player_id=player_id, **values)
    conn.execute(statement.on_conflict_do_update(index_elements=["season", "player_id"], set_=values))


def write_unless_curated(conn: Connection, season: int, player_id: str, row: Write, now: datetime) -> bool:
    """The sync's write: `write`, as one statement that leaves a curated row alone, so a curation that
    lands while the sync is working wins. False when it did."""
    values = _values(row, now)
    statement = insert(HEADSHOT_COPIES).values(season=season, player_id=player_id, **values)
    upsert = statement.on_conflict_do_update(
        index_elements=["season", "player_id"], set_=values, where=HEADSHOT_COPIES.c.status != CURATED_STATUS
    )
    return conn.execute(upsert.returning(HEADSHOT_COPIES.c.player_id)).first() is not None


def lock_player(conn: Connection, season: int, player_id: str) -> None:
    """Holds the player's season lock until the transaction ends. The sync and a curation each take
    it around their bucket write and row write, so one runs wholly before the other."""
    conn.execute(
        text("select pg_advisory_xact_lock(hashtextextended(:key, 0))"),
        {"key": f"headshots:{season}:{player_id}"},
    )


def row_status(conn: Connection, season: int, player_id: str) -> str | None:
    """His row's status for the season, None when he has no row."""
    return conn.execute(
        select(HEADSHOT_COPIES.c.status).where(
            HEADSHOT_COPIES.c.season == season, HEADSHOT_COPIES.c.player_id == player_id
        )
    ).scalar()


def mark_refresh(conn: Connection, season: int, player_id: str, now: datetime) -> bool:
    """Mark his row so the next sync fetches his source again; False when he has no row."""
    result = conn.execute(
        HEADSHOT_COPIES.update()
        .where(HEADSHOT_COPIES.c.season == season, HEADSHOT_COPIES.c.player_id == player_id)
        .values(status="refresh", updated_at=now)
    )
    return result.rowcount > 0


def faced_ids(conn: Connection, season: int) -> frozenset[str]:
    """The players the season has a copy of."""
    rows = conn.execute(
        select(HEADSHOT_COPIES.c.player_id).where(
            HEADSHOT_COPIES.c.season == season, HEADSHOT_COPIES.c.status.in_(FACE_STATUSES)
        )
    )
    return frozenset(r.player_id for r in rows)


def curation_list(conn: Connection, season: int) -> list[LedgerRow]:
    """The season's missing and failed rows, the most drafted first."""
    rows = conn.execute(
        text(
            "select h.player_id, pp.name, pp.position, h.status, h.reason, h.source_url, h.fetched_at "
            "from research.headshot_copies h "
            "left join research.provider_players pp on pp.id = h.player_id "
            "where h.season = :s and h.status in ('missing', 'failed') "
            "order by pp.adp asc nulls last, h.player_id"
        ),
        {"s": season},
    )
    return [LedgerRow(r.player_id, r.name, r.position, r.status, r.reason, r.source_url, r.fetched_at) for r in rows]
