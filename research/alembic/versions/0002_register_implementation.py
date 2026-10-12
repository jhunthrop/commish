"""The register names which implementation froze each row.

Spec §2.3: the held-out claim is only honest if the switch from the TypeScript fit to the Python
fit is visible. `register_freeze_rows` is the projections register (one row per player, week and
freeze, every stored projection the record page is graded on), so it carries the tag.

THE DEFAULT IS THE TYPESCRIPT WRITER'S, ON PURPOSE. Every row frozen before this revision was
frozen by the TypeScript core, and Postgres fills a constant default into existing rows without a
rewrite. The TypeScript core also keeps freezing on its own schedule until cutover, and its insert
never names this column, so its rows keep landing as `typescript` with no change to it. The
Python fit names the column and writes `python` from the switch date. Nullable because the brief
asks for it: a null is a row whose implementation nobody stated, which the record page must show
as unknown rather than guess.

Revision ID: 0002_register_implementation
Revises: 0001_baseline
Create Date: 2026-10-12
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0002_register_implementation"
down_revision: str | None = "0001_baseline"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "register_freeze_rows",
        sa.Column("implementation", sa.Text(), nullable=True, server_default=sa.text("'typescript'::text")),
    )


def downgrade() -> None:
    op.drop_column("register_freeze_rows", "implementation")
