"""THE CAPSULE ROWS: one per player, keyed on the universe id (`research.players.id`).

Ported from `research-ts/src/capsules/store.ts`. The legacy table keyed on the provider's id; the
research schema keys on the universe, so the sweep writes each player under the id the crosswalk
gives his board row. The regeneration queue is the cache key: a player stamped `stale:repetition`
or `stale:demoted` can never match a real hash, so the next sweep writes him again, a demoted one
first.
"""

import json
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Final

from sqlalchemy import Connection, text

REGENERATE_FACTS_HASH: Final = "stale:repetition"
# A capsule the writer wrote (the others are a facts block, or the oracle's template).
WRITTEN_SOURCE: Final = "llm"
RETRY_FIRST_FACTS_HASH: Final = "stale:demoted"


@dataclass(frozen=True, slots=True)
class StoredCapsule:
    player_id: str
    facts_hash: str
    body_compact: str
    body_full: str
    source: str
    narrative: Mapping[str, str] | None
    model: str | None
    generated_at: datetime


def stored_capsules_for(conn: Connection, player_ids: Sequence[str]) -> dict[str, StoredCapsule]:
    """`getStoredCapsulesFor`: every existing row for these players, one query."""
    if not player_ids:
        return {}
    rows = conn.execute(
        text(
            "select player_id, facts_hash, body_compact, body_full, source, narrative, model, generated_at "
            "from research.player_capsules where player_id = any(:ids)"
        ),
        {"ids": list(player_ids)},
    )
    return {
        r.player_id: StoredCapsule(
            r.player_id, r.facts_hash, r.body_compact, r.body_full, r.source, r.narrative, r.model, r.generated_at
        )
        for r in rows
    }


@dataclass(frozen=True, slots=True)
class CapsuleWrite:
    """One freshly generated capsule, as the row holds it."""

    player_id: str
    facts_hash: str
    body_compact: str
    body_full: str
    source: str
    narrative: Mapping[str, str]
    model: str | None


def upsert_capsule(conn: Connection, row: CapsuleWrite, generated_at: datetime) -> None:
    """`upsertCapsule`: one row per player, always. No slots is stored as NULL, never `{}`."""
    conn.execute(
        text(
            "insert into research.player_capsules (player_id, facts_hash, body_compact, body_full, source, narrative, model, "
            "generated_at) values (:player_id, :facts_hash, :body_compact, :body_full, :source, cast(:narrative as jsonb), "
            ":model, :generated_at) on conflict (player_id) do update set facts_hash = excluded.facts_hash, "
            "body_compact = excluded.body_compact, body_full = excluded.body_full, source = excluded.source, "
            "narrative = excluded.narrative, model = excluded.model, generated_at = excluded.generated_at"
        ),
        {
            "player_id": row.player_id,
            "facts_hash": row.facts_hash,
            "body_compact": row.body_compact,
            "body_full": row.body_full,
            "source": row.source,
            "narrative": None if not row.narrative else json.dumps(dict(row.narrative)),
            "model": row.model,
            "generated_at": generated_at,
        },
    )


def queue_regeneration(conn: Connection, player_ids: Sequence[str]) -> int:
    """`queueCapsuleRegeneration`: stamp these players stale, so the next sweep writes them again."""
    if not player_ids:
        return 0
    result = conn.execute(
        text("update research.player_capsules set facts_hash = :stale where player_id = any(:ids)"),
        {"stale": REGENERATE_FACTS_HASH, "ids": list(player_ids)},
    )
    return int(result.rowcount)
