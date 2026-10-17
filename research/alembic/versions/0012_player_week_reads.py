"""The week-ahead read: one per player and week, the writer's read of his next game or its facts block.

Revision ID: 0012
Revises: 0011
Create Date: 2026-10-17

Lane 72: `player_week_reads` holds the grounded writer's second read per player, three to five sentences
about the week in front of him, beside the season read (`player_capsules`). Keyed on the universe id,
the season and the week the read is for: a rewrite in the week (his status changed, the published
projection moved by more than a point, the last one fell to its facts block) replaces the row, a new
week is a new row. Each row keeps the write's instant, the newest stamp of the facts it was written
from and every fact's own stamp, the published projection and the status it was written with, and why
it was written. No fact may be stamped after the write.

The chain is Lane 69's 0011, this.
"""

from collections.abc import Sequence
from typing import Final

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "0012"
down_revision: str | None = "0011"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_SCHEMA: Final = "research"


def upgrade() -> None:
    op.create_table(
        "player_week_reads",
        sa.Column("player_id", sa.Text(), nullable=False),
        sa.Column("season", sa.Integer(), nullable=False),
        sa.Column("week", sa.Integer(), nullable=False),
        sa.Column("source", sa.Text(), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("model", sa.Text(), nullable=True),
        sa.Column("written_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("facts_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("stamps", JSONB(), nullable=False),
        sa.Column("projection_points", sa.Double(precision=53), nullable=True),
        sa.Column("status", sa.Text(), nullable=True),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("call", sa.Text(), nullable=True),
        sa.Column("attempt_day", sa.Date(), nullable=False),
        sa.Column("attempts", sa.Integer(), nullable=False),
        sa.Column("recorded_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("player_id", "season", "week"),
        sa.CheckConstraint("source IN ('llm', 'facts')", name="player_week_reads_source_ck"),
        sa.CheckConstraint(
            "reason IN ('first', 'unwritten', 'status', 'projection', 'demoted')", name="player_week_reads_reason_ck"
        ),
        sa.CheckConstraint("week BETWEEN 1 AND 18", name="player_week_reads_week_ck"),
        sa.CheckConstraint("call IN ('start', 'sit', 'hold', 'none')", name="player_week_reads_call_ck"),
        sa.CheckConstraint("attempts >= 1", name="player_week_reads_attempts_ck"),
        sa.CheckConstraint(
            "facts_at IS NULL OR facts_at <= written_at", name="player_week_reads_facts_before_write_ck"
        ),
        sa.ForeignKeyConstraint(
            ["player_id"], [f"{_SCHEMA}.players.id"], ondelete="CASCADE", name="player_week_reads_player_fk"
        ),
        schema=_SCHEMA,
    )
    op.create_index("player_week_reads_week_idx", "player_week_reads", ["season", "week"], schema=_SCHEMA)
    op.create_table(
        "player_week_read_runs",
        sa.Column("ran_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("mode", sa.Text(), nullable=False),
        sa.Column("calls", sa.Integer(), nullable=False),
        sa.Column("cost_usd", sa.Double(precision=53), nullable=False),
        sa.Column("written", sa.Integer(), nullable=False),
        sa.Column("facts_blocks", sa.Integer(), nullable=False),
        sa.Column("demoted", sa.Integer(), nullable=False),
        sa.Column("recorded_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("ran_at", "mode"),
        sa.CheckConstraint("mode IN ('nightly', 'hourly')", name="player_week_read_runs_mode_ck"),
        schema=_SCHEMA,
    )


def downgrade() -> None:
    op.drop_table("player_week_read_runs", schema=_SCHEMA)
    op.drop_index("player_week_reads_week_idx", "player_week_reads", schema=_SCHEMA)
    op.drop_table("player_week_reads", schema=_SCHEMA)
