"""Revision 0001, the market tables: adp_snapshots, preseason_rankings, preseason_rosters."""

import sqlalchemy as sa
from alembic import op


def create() -> None:
    _adp_snapshots()
    _preseason_rankings()
    _preseason_rosters()


def _adp_snapshots() -> None:
    op.create_table(
        "adp_snapshots",
        sa.Column("player_id", sa.Text(), nullable=False),
        sa.Column("source", sa.Text(), nullable=False),
        sa.Column("captured_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("format", sa.Text(), nullable=False),
        sa.Column("adp", sa.REAL(), nullable=False),
        sa.ForeignKeyConstraint(
            ["player_id"], ["research.players.id"], name="adp_snapshots_player_fk", ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("player_id", "source", "captured_at"),
        schema="research",
    )


def _preseason_rankings() -> None:
    op.create_table(
        "preseason_rankings",
        sa.Column("season", sa.Integer(), nullable=False),
        sa.Column("source", sa.Text(), nullable=False),
        sa.Column("player_id", sa.Text(), nullable=False),
        sa.Column("as_of", sa.DateTime(timezone=True), nullable=False),
        sa.Column("rank", sa.Double(precision=53), nullable=False),
        sa.Column("ingested_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(
            ["player_id"], ["research.players.id"], name="preseason_rankings_player_fk", ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("season", "source", "player_id", "as_of"),
        schema="research",
    )
    op.create_index(
        "preseason_rankings_as_of_idx",
        "preseason_rankings",
        ["season", "source", "as_of"],
        unique=False,
        schema="research",
    )


def _preseason_rosters() -> None:
    op.create_table(
        "preseason_rosters",
        sa.Column("season", sa.Integer(), nullable=False),
        sa.Column("player_id", sa.Text(), nullable=False),
        sa.Column("as_of", sa.DateTime(timezone=True), nullable=False),
        sa.Column("team", sa.Text(), nullable=False),
        sa.Column("position", sa.Text(), nullable=False),
        sa.Column("status", sa.Text(), nullable=False),
        sa.Column("birth_date", sa.Text(), nullable=True),
        sa.Column("draft_year", sa.Integer(), nullable=True),
        sa.Column("draft_pick", sa.Integer(), nullable=True),
        sa.Column("draft_club", sa.Text(), nullable=True),
        sa.Column("ingested_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(
            ["player_id"], ["research.players.id"], name="preseason_rosters_player_fk", ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("season", "player_id", "as_of"),
        schema="research",
    )
    op.create_index(
        "preseason_rosters_as_of_idx", "preseason_rosters", ["season", "as_of"], unique=False, schema="research"
    )
