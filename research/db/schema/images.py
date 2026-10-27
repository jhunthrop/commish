"""OUR HEADSHOT COPIES (revision 0022, Lane 241): one row per player per season, the ledger of the
copies `research.headshots sync` keeps in the images bucket (`headshots/<season>/<player_id>/<width>.webp`).

`player_id` is the provider id the product names players by (`provider_players.id`); not a foreign key,
so the provider's rollover never waits on this table. `status`:

    copied    the sync wrote the copy from `source_url`; skipped by the next sync unless the source moves
    curated   a person replaced the copy from `source_url` (`curated_by`, `curated_at`); the sync never
              touches the row again
    refresh   marked by hand: the next sync fetches the source again
    missing   the source has no image (no URL, the provider's no-photo placeholder, a 404)
    failed    the fetch or the conversion failed; the next sync tries again

`missing` and `failed` are the curation list (`research.headshots curate --missing`). The API and the
nightly answer a face for `copied` and `curated` rows.
"""

from typing import Final

from sqlalchemy import Column, DateTime, Integer, Table, Text

from research.db.schema._base import METADATA, one_of

HEADSHOT_STATUSES: Final = ("copied", "curated", "refresh", "missing", "failed")

HEADSHOT_COPIES: Final = Table(
    "headshot_copies",
    METADATA,
    Column("season", Integer, primary_key=True),
    Column("player_id", Text, primary_key=True),
    # The image the copy was made from; NULL when the provider gave none.
    Column("source_url", Text),
    Column("status", Text, nullable=False),
    # Why a row is missing or failed, in a few words; NULL on a copy.
    Column("reason", Text),
    # The last fetch's instant, a failed one included; NULL when no fetch was made (no source).
    Column("fetched_at", DateTime(True)),
    Column("curated_by", Text),
    Column("curated_at", DateTime(True)),
    # When a sync or a curator last wrote the row (the writer's clock).
    Column("updated_at", DateTime(True), nullable=False),
    one_of("status", HEADSHOT_STATUSES, "headshot_copies_status_ck"),
)
