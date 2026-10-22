"""A frozen row names the ESPN read its yardstick came from.

Revision ID: 0019
Revises: 0018
Create Date: 2026-10-22

Lane 146 (Amendment 6 of the round 4 preregistration): a freeze whose ESPN yardstick is empty takes the
first ESPN read of the week taken after it and before the week's first kickoff, and records which read
filled it.
- `register_freeze_rows.espn_read_at`: the instant of the read `espn_points` came from, the freeze's own
  newest read at or before it, or the `espn-fill` step's first read after it. NULL where `espn_points` is
  NULL and on every row frozen before this revision (week 7's hand fill is set once by the coordinator).
  Declared last and nullable, so a reader that predates it is unchanged.
"""

from collections.abc import Sequence
from typing import Final

import sqlalchemy as sa
from alembic import op

revision: str = "0019"
down_revision: str | None = "0018"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_SCHEMA: Final = "research"


def upgrade() -> None:
    op.add_column(
        "register_freeze_rows", sa.Column("espn_read_at", sa.DateTime(timezone=True), nullable=True), schema=_SCHEMA
    )


def downgrade() -> None:
    op.drop_column("register_freeze_rows", "espn_read_at", schema=_SCHEMA)
