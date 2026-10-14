"""THE ONE-TIME RESTAMP when an injury status became dated by its day (phase D fix round 3).

A stored capsule's facts hash was taken over a sheet whose injury status carried its capture's
instant. The sheet now carries the capture's Eastern day, so every stored hash reads as stale and
the next plain night would rewrite the whole board for no new fact. This restamps, once, every
capsule written on the very sheet the board has now: its stored hash equals the current sheet's
hash with the injury dated by one of the stored injury captures' instants instead of its day. Hash
equality proves the content was the same; a capsule whose facts truly moved keeps its stale hash and
is rewritten as before.
"""

from dataclasses import replace
from datetime import datetime

from sqlalchemy import Connection, text

from research.capsules.facts.build import PlayerFacts, facts_hash
from research.capsules.facts.model import InjuryClean, InjuryDesignated
from research.capsules.facts.reference import INJURY_SOURCE
from research.capsules.store import stored_capsules_for
from research.capsules.sweep import subjects_of
from research.model.instants import js_iso, ms_instant


def _instant_dated_hashes(facts: PlayerFacts, instants: list[str]) -> set[str]:
    injury = facts.injury
    if not isinstance(injury, InjuryClean | InjuryDesignated):
        return set()
    return {facts_hash(replace(facts, injury=replace(injury, as_of=instant))) for instant in instants}


def restamp_injury_day(conn: Connection, as_of: datetime) -> tuple[int, int]:
    """(restamped, left stale): each capsule whose stored hash is its sheet's instant-dated hash."""
    instants = [
        js_iso(ms_instant(row.captured_at))
        for row in conn.execute(
            text("select captured_at from research.capture_snapshots where source = :s"), {"s": INJURY_SOURCE}
        )
    ]
    subjects = subjects_of(conn, as_of)
    stored = stored_capsules_for(conn, [s.universe_id for s in subjects])
    restamped = stale = 0
    for subject in subjects:
        row = stored.get(subject.universe_id)
        if row is None or row.facts_hash == subject.facts.facts_hash:
            continue
        if row.facts_hash in _instant_dated_hashes(subject.facts, instants):
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
