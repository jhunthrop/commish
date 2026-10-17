"""The weekly number's register: each game's frozen numbers, before its own kickoff.

Revision ID: 0011
Revises: 0010
Create Date: 2026-10-17

Lane 69 (the round 4 preregistration, sections 3.3 and 4): `register_weekly_rows` holds the weekly
system's number for each player of each game, frozen before that game's kickoff, with its range, the
why (the attributions over the seven factor groups and the lines they speak), and the benchmarks'
values beside it. A row is `counted` only when frozen by the pinned served version (3.3: "Only numbers
frozen by the pinned served version of section 4 count toward 'leads'"); every other row is a shadow,
shown on the internal record and counted on the page. Append-only: a second freeze at an instant is a
new `frozen_at`, never an update.

The chain is Lane 66a's 0010, this.
"""

from collections.abc import Sequence
from typing import Final

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "0011"
down_revision: str | None = "0010"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_SCHEMA: Final = "research"
_FORMATS: Final = ("ppr", "half", "std")


def upgrade() -> None:
    op.create_table(
        "register_weekly_rows",
        sa.Column("season", sa.Integer(), nullable=False),
        sa.Column("week", sa.Integer(), nullable=False),
        sa.Column("game_id", sa.Text(), nullable=False),
        sa.Column("frozen_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("model_version", sa.Text(), nullable=False),
        sa.Column("player_id", sa.Text(), nullable=False),
        sa.Column("implementation", sa.Text(), nullable=False),
        sa.Column("kickoff_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("club", sa.Text(), nullable=False),
        sa.Column("counted", sa.Boolean(), nullable=False),
        sa.Column("questionable", sa.Boolean(), nullable=False),
        *(
            sa.Column(f"{part}_{name}", sa.Double(precision=53), nullable=False)
            for name in _FORMATS
            for part in ("point", "floor", "median", "ceiling")
        ),
        sa.Column("why", JSONB(), nullable=False),
        sa.Column("benchmarks", JSONB(), nullable=False),
        sa.Column("recorded_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("season", "week", "game_id", "frozen_at", "model_version", "player_id"),
        sa.CheckConstraint("implementation IN ('typescript', 'python')", name="register_weekly_rows_implementation_ck"),
        sa.CheckConstraint("frozen_at < kickoff_at", name="register_weekly_rows_before_kickoff_ck"),
        sa.ForeignKeyConstraint(
            ["player_id"], [f"{_SCHEMA}.players.id"], ondelete="RESTRICT", name="register_weekly_rows_player_fk"
        ),
        schema=_SCHEMA,
    )
    op.create_index("register_weekly_rows_week_idx", "register_weekly_rows", ["season", "week"], schema=_SCHEMA)


def downgrade() -> None:
    op.drop_table("register_weekly_rows", schema=_SCHEMA)
