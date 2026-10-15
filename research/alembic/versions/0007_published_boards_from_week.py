"""The week a published rest-of-season order starts at, so a week's figure divides by its own weeks.

Revision ID: 0007
Revises: 0006
Create Date: 2026-10-15

Lane 39: `publish` writes each row's `from_week`, the run's `rosFromWeek` for a format in season and
NULL for a preseason board. The API divides a rest-of-season figure by the weeks from it through week
17, and falls back to the league's week only while the column is NULL, so a run that rolls to the next
week before the host does (or after it) never divides by the wrong count.
"""

from collections.abc import Sequence
from typing import Final

import sqlalchemy as sa
from alembic import op

revision: str = "0007"
down_revision: str | None = "0006"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_SCHEMA: Final = "research"


def upgrade() -> None:
    op.add_column("published_boards", sa.Column("from_week", sa.Integer(), nullable=True), schema=_SCHEMA)
    op.create_check_constraint(
        "published_boards_from_week_ck", "published_boards", "from_week BETWEEN 1 AND 18", schema=_SCHEMA
    )


def downgrade() -> None:
    op.drop_constraint("published_boards_from_week_ck", "published_boards", schema=_SCHEMA)
    op.drop_column("published_boards", "from_week", schema=_SCHEMA)
