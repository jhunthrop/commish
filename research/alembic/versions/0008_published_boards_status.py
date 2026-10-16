"""Each published row's injury status on the newest hourly capture, so the table says who is out.

Revision ID: 0008
Revises: 0007
Create Date: 2026-10-16

Lane 63: every hour `publish` writes `status` (the contract's designation words, `injured_reserve` and
the like, NULL when the capture does not list him), `status_since` (the first capture of his unbroken
run under a season-long status, NULL for a week's designation and for a run older than the captures
read) and `status_source` (the capture's feed). All three are NULL on a row no capture has marked.
"""

from collections.abc import Sequence
from typing import Final

import sqlalchemy as sa
from alembic import op

revision: str = "0008"
down_revision: str | None = "0007"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_SCHEMA: Final = "research"
_STATUSES: Final = ("questionable", "doubtful", "out", "injured_reserve", "suspended", "pup", "nfi")


def upgrade() -> None:
    op.add_column("published_boards", sa.Column("status", sa.Text(), nullable=True), schema=_SCHEMA)
    op.add_column(
        "published_boards", sa.Column("status_since", sa.DateTime(timezone=True), nullable=True), schema=_SCHEMA
    )
    op.add_column("published_boards", sa.Column("status_source", sa.Text(), nullable=True), schema=_SCHEMA)
    listed = ", ".join(f"'{status}'" for status in _STATUSES)
    op.create_check_constraint(
        "published_boards_status_ck", "published_boards", f"status IN ({listed})", schema=_SCHEMA
    )


def downgrade() -> None:
    op.drop_constraint("published_boards_status_ck", "published_boards", schema=_SCHEMA)
    for column in ("status_source", "status_since", "status"):
        op.drop_column("published_boards", column, schema=_SCHEMA)
