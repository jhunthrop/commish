"""The fantasy hosts' player ids, each board's candidate set, and the custom-scoring board cache.

Revision ID: 0005
Revises: 0004
Create Date: 2026-10-14

Custom scoring from a league's exact rules (Lane 8, part A):

- `players.sleeper_id`, `yahoo_id`, `mfl_id`: how Sleeper, Yahoo and MyFantasyLeague name a player,
  unique like `espn_id`, so a host's draft or league joins our players on an id, never a name.
- `preseason_candidates`: the exact candidate set each stored board was built from, so a board for
  any rules is the same function over the same candidates.
- `custom_boards`: one built custom board per (season, generation, rules, shape).
"""

from collections.abc import Sequence
from typing import Final

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0005"
down_revision: str | None = "0004"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_SCHEMA: Final = "research"
_HOST_IDS: Final = ("sleeper_id", "yahoo_id", "mfl_id")


def upgrade() -> None:
    for column in _HOST_IDS:
        op.add_column("players", sa.Column(column, sa.Text(), nullable=True), schema=_SCHEMA)
        op.create_index(f"players_{column}_idx", "players", [column], unique=True, schema=_SCHEMA)
    _candidates()
    _custom_boards()


def _candidates() -> None:
    op.create_table(
        "preseason_candidates",
        sa.Column("season", sa.Integer(), nullable=False),
        sa.Column("source", sa.Text(), nullable=False),
        sa.Column("as_of", sa.DateTime(timezone=True), nullable=False),
        sa.Column("player_id", sa.Text(), nullable=False),
        sa.Column("ordinal", sa.Integer(), nullable=False),
        sa.Column("model_version", sa.Text(), nullable=False),
        sa.Column("position", sa.Text(), nullable=False),
        sa.Column("team", sa.Text(), nullable=False),
        sa.Column("per_game", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("games", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("reasons", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("per_game_tier_points", sa.Double(precision=53), nullable=True),
        sa.Column("season_projection_error_variance", sa.Double(precision=53), nullable=True),
        sa.Column("computed_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint("position IN ('QB', 'RB', 'WR', 'TE', 'K', 'DEF')", name="preseason_candidates_position_ck"),
        sa.CheckConstraint("ordinal >= 0", name="preseason_candidates_ordinal_ck"),
        sa.ForeignKeyConstraint(
            ["player_id"], [f"{_SCHEMA}.players.id"], ondelete="CASCADE", name="preseason_candidates_player_fk"
        ),
        sa.PrimaryKeyConstraint("season", "source", "as_of", "player_id"),
        schema=_SCHEMA,
    )


def _custom_boards() -> None:
    op.create_table(
        "custom_boards",
        sa.Column("season", sa.Integer(), nullable=False),
        sa.Column("as_of", sa.DateTime(timezone=True), nullable=False),
        sa.Column("rules_hash", sa.Text(), nullable=False),
        sa.Column("shape_hash", sa.Text(), nullable=False),
        sa.Column("source", sa.Text(), nullable=False),
        sa.Column("rules", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("shape", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("rows", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("model_version", sa.Text(), nullable=False),
        sa.Column("computed_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint("jsonb_typeof(rows) = 'array'", name="custom_boards_rows_ck"),
        sa.PrimaryKeyConstraint("season", "as_of", "rules_hash", "shape_hash"),
        schema=_SCHEMA,
    )


def downgrade() -> None:
    op.drop_table("custom_boards", schema=_SCHEMA)
    op.drop_table("preseason_candidates", schema=_SCHEMA)
    for column in reversed(_HOST_IDS):
        op.drop_index(f"players_{column}_idx", "players", schema=_SCHEMA)
        op.drop_column("players", column, schema=_SCHEMA)
