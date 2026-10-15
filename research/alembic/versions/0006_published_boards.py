"""The published run's board rows, the table the API reads the site's order from.

Revision ID: 0006
Revises: 0005
Create Date: 2026-10-14

Lane 28: `publish` keeps `published_boards` equal to the board rows of the run `runs/latest.json`
names (`research.nightly.published_board`), so the API reads the order the site shows, the
rest-of-season order from week 7, without reading R2.
"""

from collections.abc import Sequence
from typing import Final

import sqlalchemy as sa
from alembic import op

revision: str = "0006"
down_revision: str | None = "0005"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_SCHEMA: Final = "research"


def upgrade() -> None:
    op.create_table(
        "published_boards",
        sa.Column("season", sa.Integer(), nullable=False),
        sa.Column("format", sa.Text(), nullable=False),
        sa.Column("player_id", sa.Text(), nullable=False),
        sa.Column("run_id", sa.Text(), nullable=False),
        sa.Column("rank", sa.Integer(), nullable=False),
        sa.Column("position_rank", sa.Integer(), nullable=False),
        sa.Column("points", sa.Double(precision=53), nullable=True),
        sa.Column("points_over_replacement", sa.Double(precision=53), nullable=True),
        sa.Column("floor_points", sa.Double(precision=53), nullable=True),
        sa.Column("median_points", sa.Double(precision=53), nullable=True),
        sa.Column("ceiling_points", sa.Double(precision=53), nullable=True),
        sa.Column("order_basis", sa.Text(), nullable=False),
        sa.Column("refreshed", sa.DateTime(timezone=True), nullable=False),
        sa.Column("published_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("format IN ('ppr', 'half', 'std', 'superflex')", name="published_boards_format_ck"),
        sa.CheckConstraint("order_basis IN ('preseason', 'rest_of_season')", name="published_boards_order_basis_ck"),
        sa.CheckConstraint("rank >= 1 AND position_rank >= 1", name="published_boards_rank_ck"),
        sa.PrimaryKeyConstraint("season", "format", "player_id"),
        schema=_SCHEMA,
    )
    op.create_index("published_boards_run_idx", "published_boards", ["run_id"], schema=_SCHEMA)


def downgrade() -> None:
    op.drop_index("published_boards_run_idx", "published_boards", schema=_SCHEMA)
    op.drop_table("published_boards", schema=_SCHEMA)
