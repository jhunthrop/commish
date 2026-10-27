"""CURATION: a person replaces one player's copy from a URL they chose, or marks it to be fetched
again, and reads the season's curation list. A curated row names who and when, and the sync never
overwrites it."""

from typing import Final

from research.errors import ConfigurationError
from research.headshots.config import check_player_id
from research.headshots.images import FetchFailedError, NoImageError, Source
from research.headshots.sync import CURATED, SyncDeps, fetch_copy, store_copies
from research.headshots.table import LedgerRow, Write, is_provider_player, lock_player, mark_refresh, write

_CURATOR_MAX: Final = 80


class CurationError(ConfigurationError):
    """The curator's request cannot be carried out as given."""


def curate(deps: SyncDeps, season: int, player_id: str, url: str, by: str) -> None:
    """His copy replaced from `url` (any https host) and his row marked curated by `by`."""
    check_player_id(player_id)
    curator = by.strip()
    if not curator or len(curator) > _CURATOR_MAX:
        raise CurationError("name the curator with --by (at most 80 characters).")
    with deps.engine.connect() as conn:
        if not is_provider_player(conn, player_id):
            raise CurationError(f"{player_id} is not a provider player.")
    try:
        body = fetch_copy(deps, Source(url, None))
    except (NoImageError, FetchFailedError) as error:
        raise CurationError(f"{url} gave no usable image: {error}") from error
    at = deps.now()
    with deps.engine.begin() as conn:
        lock_player(conn, season, player_id)  # the sync's writes for him run wholly before or after
        store_copies(deps.bucket, season, player_id, body)
        write(conn, season, player_id, Write(CURATED, url, None, at, curator, at), at)


def refresh(deps: SyncDeps, season: int, player_id: str) -> None:
    """His row marked so the next sync fetches his source again (a curated row included)."""
    check_player_id(player_id)
    with deps.engine.begin() as conn:
        if not mark_refresh(conn, season, player_id, deps.now()):
            raise CurationError(f"{player_id} has no row for {season}; the next sync fetches him anyway.")


def curation_lines(rows: list[LedgerRow]) -> list[str]:
    """The curation list as tab-separated lines: id, name, position, status, reason, source."""
    return [
        "\t".join([r.player_id, r.name or "", r.position or "", r.status, r.reason or "", r.source_url or ""])
        for r in rows
    ]
