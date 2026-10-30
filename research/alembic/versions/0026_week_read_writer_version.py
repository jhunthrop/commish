"""Each week read records the writer version that wrote it, and may be rewritten because the writer changed.

Revision ID: 0026
Revises: 0025
Create Date: 2026-10-30

Lane 306 (the founder, 2026-10-30: "why can we not update all player reads at the same time?"):
- `player_week_reads.writer_version`: the `write.WEEK_WRITER_VERSION` that wrote the read. Declared last and
  nullable, so a reader that predates it is unchanged; NULL reads as 0.
- `player_week_reads.reason` takes `writer`, the cadence's `WRITER`, for a written read an older writer wrote.
  The constraint is replaced whole; every value it held stays allowed.

The stamp: a row written at or after 2026-10-30T05:00Z (`STAMP_FROM`) is version 1, every other row 0. A row's
`written_at` is its pass's facts instant (`nightly.week_reads.stored_row`), and a written read kept over a rewrite
that fell keeps its own (`cadence.kept_read`), so a row's instant names the pass that wrote its body. Lane 300's
writer was merged at 02:57Z and deployed at 03:37Z; the first pass known to run it is the 05:30Z nightly, whose
facts instant is after 05:00Z. An hourly pass between the deploy and 05:00Z may have run either image, so its rows
are stamped 0 and rewritten once more: a few cents, against a checklist read left standing. Lane 303 (merged
10:01Z) changes only which reads fall, never what a written read says, so the nightly's rows need no stamp of their
own. Declared in `research.db.schema.boards`.
"""

from collections.abc import Sequence
from datetime import UTC, datetime
from typing import Final

import sqlalchemy as sa
from alembic import op

revision: str = "0026"
down_revision: str | None = "0025"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_SCHEMA: Final = "research"
_TABLE: Final = "player_week_reads"
_COLUMN: Final = "writer_version"
_NAME: Final = "player_week_reads_reason_ck"
_BEFORE: Final = "reason IN ('first', 'unwritten', 'status', 'projection', 'demoted', 'rule', 'fact')"
_AFTER: Final = "reason IN ('first', 'unwritten', 'status', 'projection', 'demoted', 'rule', 'fact', 'writer')"
STAMP_FROM: Final = datetime(2026, 10, 30, 5, tzinfo=UTC)
STAMP_SQL: Final = f"UPDATE {_SCHEMA}.{_TABLE} SET {_COLUMN} = CASE WHEN written_at >= :stamp_from THEN 1 ELSE 0 END"


def upgrade() -> None:
    op.add_column(_TABLE, sa.Column(_COLUMN, sa.Integer(), nullable=True), schema=_SCHEMA)
    op.execute(sa.text(STAMP_SQL).bindparams(stamp_from=STAMP_FROM))
    op.drop_constraint(_NAME, _TABLE, schema=_SCHEMA)
    op.create_check_constraint(_NAME, _TABLE, _AFTER, schema=_SCHEMA)


def downgrade() -> None:
    op.execute(f"UPDATE {_SCHEMA}.{_TABLE} SET reason = 'rule' WHERE reason = 'writer'")
    op.drop_constraint(_NAME, _TABLE, schema=_SCHEMA)
    op.create_check_constraint(_NAME, _TABLE, _BEFORE, schema=_SCHEMA)
    op.drop_column(_TABLE, _COLUMN, schema=_SCHEMA)
