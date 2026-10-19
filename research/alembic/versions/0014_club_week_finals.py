"""The one "final held" rule as a view: `club_week_finals`.

Revision ID: 0014
Revises: 0013
Create Date: 2026-10-19

Lane 80: a club-week is final once the store holds its weekly result, the hourly capture's game status
saying final, or a line with his club that week, from the first instant any was held. The hourly
status pass, the run's game states and the API's week facts all read this view, so the rule is
written once (`research/db/schema/club_week_finals.sql`, which the declaration and the API's test
build from too).
"""

from collections.abc import Sequence
from typing import Final

from alembic import op

from research.db.schema.views import club_week_finals_ddl

revision: str = "0014"
down_revision: str | None = "0013"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_SCHEMA: Final = "research"


def upgrade() -> None:
    op.execute(club_week_finals_ddl(_SCHEMA))


def downgrade() -> None:
    op.execute(f"drop view {_SCHEMA}.club_week_finals")
