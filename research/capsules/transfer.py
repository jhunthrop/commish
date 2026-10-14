"""THE CAPSULES CARRIED FROM ONE STORE TO ANOTHER: the dev copy's written board into production at cutover.

Phase D fix round 3 (the review's R2). The paid regeneration wrote the dev copy's
`research.player_capsules`; production's comes from the loader (the oracle-era prose), so its first
night would repair most of the board at about a regeneration's cost. `export` writes every written
capsule of the dev board, with the facts hash it was written on, to one JSON file; `import` writes
each into the target store only when that store's own sheet for the player hashes the same, so a
capsule never lands on facts it was not written from. Everything else is refused and counted, and
the target's next night writes those pages as usual.
"""

import json
from collections.abc import Sequence
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any

from sqlalchemy import Connection

from research.capsules.store import WRITTEN_SOURCE, CapsuleWrite, stored_capsules_for, upsert_capsule
from research.capsules.sweep import subjects_of
from research.model.instants import js_iso

FORMAT = "commish-capsules/1"


def export_capsules(conn: Connection, as_of: datetime, out: Path) -> int:
    """Every written capsule of the board at `as_of` whose hash is its current sheet's, to `out`."""
    subjects = subjects_of(conn, as_of)
    stored = stored_capsules_for(conn, [s.universe_id for s in subjects])
    rows = [
        {
            "playerId": row.player_id,
            "factsHash": row.facts_hash,
            "bodyCompact": row.body_compact,
            "bodyFull": row.body_full,
            "narrative": dict(row.narrative) if row.narrative else None,
            "model": row.model,
            "generatedAt": js_iso(row.generated_at),
        }
        for subject in subjects
        if (row := stored.get(subject.universe_id)) is not None
        and row.source == WRITTEN_SOURCE
        and row.facts_hash == subject.facts.facts_hash
    ]
    out.write_text(json.dumps({"format": FORMAT, "exportedAt": js_iso(as_of), "capsules": rows}) + "\n")
    return len(rows)


@dataclass(slots=True)
class ImportReport:
    imported: int = 0
    refused: list[str] = field(default_factory=list)


def _refusal(entry: dict[str, Any], current: str | None) -> str | None:
    if current is None:
        return f"{entry['playerId']}: not on this store's board"
    if current != entry["factsHash"]:
        return f"{entry['playerId']}: this store's sheet hashes {current[:12]}, the capsule was written on {entry['factsHash'][:12]}"
    return None


def import_capsules(conn: Connection, as_of: datetime, source: Path) -> ImportReport:
    """Each exported capsule whose facts hash is this store's current sheet's, upserted; the rest refused."""
    document = json.loads(source.read_text())
    if document.get("format") != FORMAT:
        raise ValueError(f"{source} is not a {FORMAT} export")
    hashes = {s.universe_id: s.facts.facts_hash for s in subjects_of(conn, as_of)}
    report = ImportReport()
    entries: Sequence[dict[str, Any]] = document["capsules"]
    for entry in entries:
        refusal = _refusal(entry, hashes.get(entry["playerId"]))
        if refusal is not None:
            report.refused.append(refusal)
            continue
        write = CapsuleWrite(
            entry["playerId"], entry["factsHash"], entry["bodyCompact"], entry["bodyFull"], WRITTEN_SOURCE,
            entry["narrative"] or {}, entry["model"],
        )  # fmt: skip
        upsert_capsule(conn, write, datetime.fromisoformat(entry["generatedAt"]))
        report.imported += 1
    return report
