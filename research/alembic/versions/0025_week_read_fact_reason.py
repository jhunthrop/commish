"""A week read may be rewritten because tonight's sheet no longer bears out a fact it states.

Revision ID: 0025
Revises: 0024
Create Date: 2026-10-29

Lane 299: `player_week_reads.reason` takes `fact`, the cadence's `FACT_STALE`, for a written read whose place on
this week's depth chart (or a game's figure tied to its week) tonight's sheet does not bear out. The constraint
is replaced whole; every value it held stays allowed. Declared in `research.db.schema.boards`.
"""

from collections.abc import Sequence
from typing import Final

from alembic import op

revision: str = "0025"
down_revision: str | None = "0024"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_SCHEMA: Final = "research"
_TABLE: Final = "player_week_reads"
_NAME: Final = "player_week_reads_reason_ck"
_BEFORE: Final = "reason IN ('first', 'unwritten', 'status', 'projection', 'demoted', 'rule')"
_AFTER: Final = "reason IN ('first', 'unwritten', 'status', 'projection', 'demoted', 'rule', 'fact')"


def upgrade() -> None:
    op.drop_constraint(_NAME, _TABLE, schema=_SCHEMA)
    op.create_check_constraint(_NAME, _TABLE, _AFTER, schema=_SCHEMA)


def downgrade() -> None:
    op.execute(f"UPDATE {_SCHEMA}.{_TABLE} SET reason = 'rule' WHERE reason = 'fact'")
    op.drop_constraint(_NAME, _TABLE, schema=_SCHEMA)
    op.create_check_constraint(_NAME, _TABLE, _BEFORE, schema=_SCHEMA)
