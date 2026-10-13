"""A capsule the writer could not serve is a facts block, `source = 'facts'`.

Revision ID: 0004
Revises: 0003
Create Date: 2026-10-13

The founder's rule: every non-stat sentence on a page comes from the writer, and a stock sentence
across players is a defect, a frame with the name and numbers swapped included. So the fallback for
a player the writer cannot serve within its ceiling is no prose at all: his numbers with their
basis as labelled facts, which the page renders as a facts list. `'template'` stays legal for the
oracle's rows the loader carried; this lane never writes it, and the sweep rewrites those first.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0004"
down_revision: str | None = "0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_SCHEMA = "research"
_CONSTRAINT = "player_capsules_source_ck"


def upgrade() -> None:
    op.drop_constraint(_CONSTRAINT, "player_capsules", schema=_SCHEMA)
    op.create_check_constraint(_CONSTRAINT, "player_capsules", "source IN ('llm', 'facts', 'template')", schema=_SCHEMA)


def downgrade() -> None:
    op.execute(f"DELETE FROM {_SCHEMA}.player_capsules WHERE source = 'facts'")
    op.drop_constraint(_CONSTRAINT, "player_capsules", schema=_SCHEMA)
    op.create_check_constraint(_CONSTRAINT, "player_capsules", "source IN ('llm', 'template')", schema=_SCHEMA)
