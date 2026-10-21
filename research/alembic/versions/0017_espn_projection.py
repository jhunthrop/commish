"""ESPN's weekly projection, read before the order is set, and kept beside each frozen row.

Revision ID: 0017
Revises: 0016
Create Date: 2026-10-20

Lane 114 (the weekly record's yardsticks, Amendment 5 of the round 4 preregistration):
- `espn_projection_rows`: ESPN's own weekly projection in PPR for every player its public player pool
  projects (ESPN's PPR league defaults, read with no sign-in), one row per player per read, append-only.
  The in-season pass reads the coming week before it sets the order.
- `register_freeze_rows.espn_points`: his PPR points on the newest such read at or before the freeze,
  through `players.espn_id`, NULL where that read lists no row for him and on every freeze taken before
  this revision. Declared last and nullable, so a reader that predates it is unchanged.
"""

from collections.abc import Sequence
from typing import Final

import sqlalchemy as sa
from alembic import op

revision: str = "0017"
down_revision: str | None = "0016"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_SCHEMA: Final = "research"


def upgrade() -> None:
    op.create_table(
        "espn_projection_rows",
        sa.Column("season", sa.Integer(), nullable=False),
        sa.Column("week", sa.Integer(), nullable=False),
        sa.Column("read_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("espn_id", sa.Text(), nullable=False),
        sa.Column("ppr_points", sa.Double(precision=53), nullable=False),
        sa.Column("ingested_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("season", "week", "read_at", "espn_id"),
        schema=_SCHEMA,
    )
    op.create_index(
        "espn_projection_rows_week_idx", "espn_projection_rows", ["season", "week", "read_at"], schema=_SCHEMA
    )
    op.add_column(
        "register_freeze_rows", sa.Column("espn_points", sa.Double(precision=53), nullable=True), schema=_SCHEMA
    )


def downgrade() -> None:
    op.drop_column("register_freeze_rows", "espn_points", schema=_SCHEMA)
    op.drop_index("espn_projection_rows_week_idx", table_name="espn_projection_rows", schema=_SCHEMA)
    op.drop_table("espn_projection_rows", schema=_SCHEMA)
