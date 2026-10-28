"""A week read may be rewritten because the current rules refuse it.

Revision ID: 0024
Revises: 0023
Create Date: 2026-10-28

Lane 275 fix round 1: `player_week_reads.reason` takes `rule`, the cadence's `RULE_STALE`, for a written read
the current rules refuse (one written while the rules asked it to name the published projection). The
constraint is replaced whole; every value it held stays allowed. Declared in `research.db.schema.boards`.
"""

from collections.abc import Sequence
from typing import Final

from alembic import op

revision: str = "0024"
down_revision: str | None = "0023"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_SCHEMA: Final = "research"
_TABLE: Final = "player_week_reads"
_NAME: Final = "player_week_reads_reason_ck"
_BEFORE: Final = "reason IN ('first', 'unwritten', 'status', 'projection', 'demoted')"
_AFTER: Final = "reason IN ('first', 'unwritten', 'status', 'projection', 'demoted', 'rule')"


def upgrade() -> None:
    op.drop_constraint(_NAME, _TABLE, schema=_SCHEMA)
    op.create_check_constraint(_NAME, _TABLE, _AFTER, schema=_SCHEMA)


def downgrade() -> None:
    op.execute(f"UPDATE {_SCHEMA}.{_TABLE} SET reason = 'unwritten' WHERE reason = 'rule'")
    op.drop_constraint(_NAME, _TABLE, schema=_SCHEMA)
    op.create_check_constraint(_NAME, _TABLE, _BEFORE, schema=_SCHEMA)
