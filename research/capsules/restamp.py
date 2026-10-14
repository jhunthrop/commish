"""THE ONE-TIME RESTAMP when an injury status changed how it is dated (phase D fix rounds 3 and 4).

A stored capsule's facts hash was taken over a sheet whose injury status carried its capture's
instant (before fix round 3) or its capture's Eastern day (fix round 3, field `asOf`). The sheet now
dates the status by the day it began (field `since`), so those stored hashes read as stale and the next
plain night would rewrite the board for no new fact. This restamps every capsule written on the very
sheet the board has now: its stored hash equals the current sheet's content hashed with the injury in
either older form, dated by one of the stored injury captures' instants or days. Hash equality proves
the content was the same; a capsule whose facts truly moved keeps its stale hash and is rewritten as
before. Running it again restamps nothing.
"""

import hashlib
from datetime import datetime

from sqlalchemy import Connection, text

from research.capsules.facts.build import PlayerFacts, content_json
from research.capsules.facts.reference import INJURY_SOURCE, capture_day
from research.capsules.store import stored_capsules_for
from research.capsules.sweep import subjects_of
from research.model.instants import js_iso, ms_instant
from research.pipeline.jscompat import js_json_stringify

_STAMP = "@@restamp-stamp@@"


def _older_hashes(facts: PlayerFacts, stamps: list[str]) -> set[str]:
    """The sheet's hash with its injury dated the older ways, `asOf` set to each stamp (serialised once,
    the stamp substituted into the text, so hundreds of stamps cost one serialisation)."""
    content = content_json(facts)
    injury = content["injury"]
    if "since" not in injury:
        return set()
    dated = {key: value for key, value in injury.items() if key != "since"}
    template = js_json_stringify({**content, "injury": {**dated, "asOf": _STAMP}})
    return {hashlib.sha256(template.replace(_STAMP, stamp).encode("utf-8")).hexdigest() for stamp in stamps}


def restamp_injury_day(conn: Connection, as_of: datetime) -> tuple[int, int]:
    """(restamped, left stale): each capsule whose stored hash is its sheet's in an older injury dating."""
    captured = [
        ms_instant(row.captured_at)
        for row in conn.execute(
            text("select captured_at from research.capture_snapshots where source = :s"), {"s": INJURY_SOURCE}
        )
    ]
    stamps = sorted({js_iso(at) for at in captured} | {capture_day(at) for at in captured})
    subjects = subjects_of(conn, as_of)
    stored = stored_capsules_for(conn, [s.universe_id for s in subjects])
    restamped = stale = 0
    for subject in subjects:
        row = stored.get(subject.universe_id)
        if row is None or row.facts_hash == subject.facts.facts_hash:
            continue
        if row.facts_hash in _older_hashes(subject.facts, stamps):
            conn.execute(
                text(
                    "update research.player_capsules set facts_hash = :new where player_id = :id and facts_hash = :old"
                ),
                {"new": subject.facts.facts_hash, "id": subject.universe_id, "old": row.facts_hash},
            )
            restamped += 1
        else:
            stale += 1
    return restamped, stale
