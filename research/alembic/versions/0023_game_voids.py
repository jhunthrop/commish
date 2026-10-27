"""An operator's void of one game, append-only.

Revision ID: 0023
Revises: 0022
Create Date: 2026-10-27

Lane 249 (B255): `game_voids`, one row per void or lift of a game of `nflverse_games`, written by
`research.inseason void-game` and never updated or deleted. The week's completeness check skips a game
whose latest row at or before the pass is a void. Declared in `research.db.schema.nflverse`.
"""

from collections.abc import Sequence
from typing import Final

import sqlalchemy as sa
from alembic import op

revision: str = "0023"
down_revision: str | None = "0022"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_SCHEMA: Final = "research"


def upgrade() -> None:
    op.create_table(
        "game_voids",
        sa.Column("game_id", sa.Text(), nullable=False),
        sa.Column("voided_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("season", sa.Integer(), nullable=False),
        sa.Column("week", sa.Integer(), nullable=False),
        sa.Column("voided_by", sa.Text(), nullable=False),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("lifted", sa.Boolean(), nullable=False),
        sa.Column("ingested_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint("length(btrim(voided_by)) > 0", name="game_voids_voided_by_ck"),
        sa.CheckConstraint("length(btrim(reason)) > 0", name="game_voids_reason_ck"),
        sa.PrimaryKeyConstraint("game_id", "voided_at"),
        schema=_SCHEMA,
    )
    op.create_index("game_voids_week_idx", "game_voids", ["season", "week"], schema=_SCHEMA)


def downgrade() -> None:
    op.drop_index("game_voids_week_idx", table_name="game_voids", schema=_SCHEMA)
    op.drop_table("game_voids", schema=_SCHEMA)
