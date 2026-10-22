"""ESPN's archived weekly kicker and D/ST projections, a benchmark.

Revision ID: 0021
Revises: 0020
Create Date: 2026-10-23

Lane 156 (Amendment 7 item 9 of the round 4 preregistration): `espn_kdef_archive_rows`, one row per
kicker or D/ST per week of an archived season ESPN's public pool still projects (2023 and 2024), with
ESPN's own total and its projected components by ESPN's stat id. Ingested once, never an input. ESPN
publishes no stamp for an archived split, so `stamp` is 'archive_unstamped' on every row: taken as its
last pre-game version, which can only favour ESPN.
"""

from collections.abc import Sequence
from typing import Final

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0021"
down_revision: str | None = "0020"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_SCHEMA: Final = "research"


def upgrade() -> None:
    op.create_table(
        "espn_kdef_archive_rows",
        sa.Column("season", sa.Integer(), nullable=False),
        sa.Column("week", sa.Integer(), nullable=False),
        sa.Column("espn_id", sa.Text(), nullable=False),
        sa.Column("read_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("position", sa.Text(), nullable=False),
        sa.Column("applied_total", sa.Double(precision=53), nullable=False),
        sa.Column("stats", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("stamp", sa.Text(), nullable=False),
        sa.Column("ingested_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint("position IN ('K', 'DEF')", name="espn_kdef_archive_rows_position_ck"),
        sa.CheckConstraint("stamp IN ('archive_unstamped')", name="espn_kdef_archive_rows_stamp_ck"),
        sa.PrimaryKeyConstraint("season", "week", "espn_id", "read_at"),
        schema=_SCHEMA,
    )


def downgrade() -> None:
    op.drop_table("espn_kdef_archive_rows", schema=_SCHEMA)
