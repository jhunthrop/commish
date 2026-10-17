"""The week's published projection beside each frozen row of the register.

Revision ID: 0013
Revises: 0012
Create Date: 2026-10-17

Lane 66j: the record grades the week's published projection beside our order and ADP, from the first
freeze that keeps it (week 7). `published_points` is his PPR points on the newest snapshot of the week's
published projection read at or before the freeze (`tank01_projection_rows`, through the crosswalk),
NULL where that snapshot lists no row for him and on every freeze taken before this revision.
"""

from collections.abc import Sequence
from typing import Final

import sqlalchemy as sa
from alembic import op

revision: str = "0013"
down_revision: str | None = "0012"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_SCHEMA: Final = "research"


def upgrade() -> None:
    op.add_column(
        "register_freeze_rows", sa.Column("published_points", sa.Double(precision=53), nullable=True), schema=_SCHEMA
    )


def downgrade() -> None:
    op.drop_column("register_freeze_rows", "published_points", schema=_SCHEMA)
