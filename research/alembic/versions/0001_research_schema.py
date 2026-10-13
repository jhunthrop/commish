"""The research schema, designed for the prep site (2026-10-12).

Revision ID: 0001
Revises:
Create Date: 2026-10-12

Revision 1 is the whole schema `research.db.schema` declares, created from nothing; there is no
history before it (the founder's ruling of 2026-10-12: rip and replace, no migration debt). The
DDL is split by table group under `research.db.migrations`, and the groups run in foreign-key
order: identity first, because every other group references `players` or `provider_players`.
Downgrade drops the schema whole.
"""

from collections.abc import Sequence

from alembic import op

from research.db.migrations import (
    r0001_boards,
    r0001_identity,
    r0001_market,
    r0001_nflverse,
    r0001_observations,
    r0001_provider,
)
from research.db.schema import RESEARCH_SCHEMA

revision: str = "0001"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    for group in (r0001_identity, r0001_nflverse, r0001_observations, r0001_provider, r0001_market, r0001_boards):
        group.create()


def downgrade() -> None:
    # The version table lives in the schema too; alembic recreates it on the next upgrade.
    op.execute(f'DROP SCHEMA "{RESEARCH_SCHEMA}" CASCADE')
