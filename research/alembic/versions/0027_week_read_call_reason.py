"""A week read may be rewritten because its decided call moved.

Revision ID: 0027
Revises: 0026
Create Date: 2026-10-31

Lane 302: `player_week_reads.reason` takes `call`, the cadence's `CALL_CHANGED`, for a written read whose call is
no longer the one decided for tonight's sheet (`capsules.week.call.week_call`, `call.call_flipped`: his place this
week crossed his position's starter line by the margin, or a status moved it). The constraint is replaced whole;
every value it held stays allowed, Lane 306's `writer` (0026) among them. Declared in `research.db.schema.boards`.
"""

from collections.abc import Sequence
from typing import Final

from alembic import op

revision: str = "0027"
down_revision: str | None = "0026"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_SCHEMA: Final = "research"
_TABLE: Final = "player_week_reads"
_NAME: Final = "player_week_reads_reason_ck"
_BEFORE: Final = "reason IN ('first', 'unwritten', 'status', 'projection', 'demoted', 'rule', 'fact', 'writer')"
_AFTER: Final = "reason IN ('first', 'unwritten', 'status', 'projection', 'demoted', 'rule', 'fact', 'writer', 'call')"


def upgrade() -> None:
    op.drop_constraint(_NAME, _TABLE, schema=_SCHEMA)
    op.create_check_constraint(_NAME, _TABLE, _AFTER, schema=_SCHEMA)


def downgrade() -> None:
    op.execute(f"UPDATE {_SCHEMA}.{_TABLE} SET reason = 'status' WHERE reason = 'call'")
    op.drop_constraint(_NAME, _TABLE, schema=_SCHEMA)
    op.create_check_constraint(_NAME, _TABLE, _BEFORE, schema=_SCHEMA)
