"""Our headshot copies, one row per player per season.

Revision ID: 0022
Revises: 0021
Create Date: 2026-10-26

Lane 241 (B245): `headshot_copies`, the ledger of the copies `research.headshots sync` keeps in the
images bucket, with the curation list (`missing`, `failed`) and the rows a person curated, which the
sync never overwrites. Declared in `research.db.schema.images`.
"""

from collections.abc import Sequence
from typing import Final

import sqlalchemy as sa
from alembic import op

revision: str = "0022"
down_revision: str | None = "0021"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_SCHEMA: Final = "research"


def upgrade() -> None:
    op.create_table(
        "headshot_copies",
        sa.Column("season", sa.Integer(), nullable=False),
        sa.Column("player_id", sa.Text(), nullable=False),
        sa.Column("source_url", sa.Text(), nullable=True),
        sa.Column("status", sa.Text(), nullable=False),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column("fetched_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("curated_by", sa.Text(), nullable=True),
        sa.Column("curated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "status IN ('copied', 'curated', 'refresh', 'missing', 'failed')", name="headshot_copies_status_ck"
        ),
        sa.PrimaryKeyConstraint("season", "player_id"),
        schema=_SCHEMA,
    )


def downgrade() -> None:
    op.drop_table("headshot_copies", schema=_SCHEMA)
