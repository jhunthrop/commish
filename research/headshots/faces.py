"""The run's faces: every player's `headshot` is our copy's address (`face_url`), never the provider's.

A player the season has a copy of, or whose provider row names an image, gets the address: the run's
contract wants a URL for every ranked player (`web/src/lib/run/schema.ts`), so a player whose copy is
not made yet (a failed fetch, the provider's no-photo placeholder) still carries it, the bucket answers
404, and the web and the apps draw his initials, as they do today for an image that fails. A player
with neither keeps no face (a defense, whose face is its club's mark).
"""

from collections.abc import Iterable
from dataclasses import replace

from research.headshots.config import face_url, is_player_id
from research.nightly.build.pages import Identity


def our_face(season: int, player_id: str, source_url: str | None, faced: frozenset[str]) -> str | None:
    """His `headshot` in the run."""
    if not is_player_id(player_id) or (player_id not in faced and not source_url):
        return None
    return face_url(season, player_id)


def our_faces(people: Iterable[Identity], season: int, faced: frozenset[str]) -> tuple[Identity, ...]:
    """Each identity with its face moved to our copy's address."""
    return tuple(replace(p, headshot=our_face(season, p.id, p.headshot, faced)) for p in people)
