"""THE ONE-SHOT REWRITE OF NAMED PAGES: their capsules stamped stale by the public slug, so the next
capsule step writes them again under the current rules (Lane 29: the pages the live review of
2026-10-15 named, and the pages its new rules fail).

A slug is the page's own (`nightly.build.pages.identities`, the PPR board the player page reads), so
the operator names a page the way the site does. Every slug must resolve before any row is stamped;
the stamp is the regeneration queue's (`store.queue_regeneration`), which the sweep always rewrites.
"""

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import Connection

from research.capsules.facts.collect import universe_ids_for
from research.capsules.store import queue_regeneration, stored_capsules_for
from research.errors import ConfigurationError
from research.nightly.build.pages import Identity, identities
from research.nightly.config import PAGE_FORMAT
from research.nightly.reads.board import format_board
from research.season import PRODUCT_SEASON


def served_identities(conn: Connection, as_of: datetime) -> tuple[Identity, ...]:
    """The pages the player-page board serves at `as_of`, with their slugs."""
    board = format_board(conn, PRODUCT_SEASON, PAGE_FORMAT, as_of)
    return () if board is None else tuple(identities([board]))


def provider_ids_for(served: Sequence[Identity], slugs: Sequence[str]) -> list[str]:
    """Each slug's provider id, in the order given; an unknown slug fails, naming every one."""
    by_slug = {identity.slug: identity.id for identity in served}
    unknown = [slug for slug in slugs if slug not in by_slug]
    if unknown:
        raise ConfigurationError(f"no served page has the slug {', '.join(unknown)}: nothing was stamped")
    return [by_slug[slug] for slug in dict.fromkeys(slugs)]


@dataclass(frozen=True, slots=True)
class QueueResult:
    """What a queue stamped: the rows, the slugs named, and the named pages with no capsule row to stamp."""

    stamped: int
    named: int
    unstamped: tuple[str, ...]


def queue_slugs(conn: Connection, slugs: Sequence[str], as_of: datetime) -> QueueResult:
    """Stamp the named pages' capsules for regeneration. A slug with no capsule row is named, not hidden."""
    named = list(dict.fromkeys(slugs))
    if not named:
        raise ConfigurationError("no slug was named: nothing was stamped")
    provider_ids = provider_ids_for(served_identities(conn, as_of), named)
    universe = universe_ids_for(conn, provider_ids)
    missing = [pid for pid in provider_ids if pid not in universe]
    if missing:
        raise ConfigurationError(f"no universe id for provider ids {', '.join(missing)}: nothing was stamped")
    ids = [universe[pid] for pid in provider_ids]
    rows = set(stored_capsules_for(conn, ids))
    unstamped = tuple(slug for slug, uid in zip(named, ids, strict=True) if uid not in rows)
    return QueueResult(queue_regeneration(conn, ids), len(named), unstamped)
