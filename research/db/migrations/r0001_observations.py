"""Revision 0001, the observations tables: team_week_observations, player_week_observations, player_week_teams."""

import sqlalchemy as sa
from alembic import op


def create() -> None:
    _team_week_observations()
    _player_week_observations()
    _player_week_teams()


def _team_week_observations() -> None:
    op.create_table(
        "team_week_observations",
        sa.Column("season", sa.Integer(), nullable=False),
        sa.Column("week", sa.Integer(), nullable=False),
        sa.Column("team", sa.Text(), nullable=False),
        sa.Column("source", sa.Text(), nullable=False),
        sa.Column("metric", sa.Text(), nullable=False),
        sa.Column("as_of", sa.DateTime(timezone=True), nullable=False),
        sa.Column("value", sa.Double(precision=53), nullable=False),
        sa.Column("ingested_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("season", "week", "team", "source", "metric", "as_of"),
        schema="research",
    )
    op.create_index(
        "team_week_observations_as_of_idx",
        "team_week_observations",
        ["season", "week", "as_of"],
        unique=False,
        schema="research",
    )


def _player_week_observations() -> None:
    op.create_table(
        "player_week_observations",
        sa.Column("season", sa.Integer(), nullable=False),
        sa.Column("week", sa.Integer(), nullable=False),
        sa.Column("player_id", sa.Text(), nullable=False),
        sa.Column("source", sa.Text(), nullable=False),
        sa.Column("metric", sa.Text(), nullable=False),
        sa.Column("as_of", sa.DateTime(timezone=True), nullable=False),
        sa.Column("value", sa.Double(precision=53), nullable=False),
        sa.Column("ingested_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(
            ["player_id"], ["research.players.id"], name="player_week_observations_player_fk", ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("season", "week", "player_id", "source", "metric", "as_of"),
        schema="research",
    )
    op.create_index(
        "player_week_observations_as_of_idx",
        "player_week_observations",
        ["season", "week", "as_of"],
        unique=False,
        schema="research",
    )


def _player_week_teams() -> None:
    op.create_table(
        "player_week_teams",
        sa.Column("season", sa.Integer(), nullable=False),
        sa.Column("week", sa.Integer(), nullable=False),
        sa.Column("player_id", sa.Text(), nullable=False),
        sa.Column("team", sa.Text(), nullable=False),
        sa.Column("as_of", sa.DateTime(timezone=True), nullable=False),
        sa.Column("ingested_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(
            ["player_id"], ["research.players.id"], name="player_week_teams_player_fk", ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("season", "week", "player_id", "team", "as_of"),
        schema="research",
    )
    op.create_index(
        "player_week_teams_as_of_idx", "player_week_teams", ["season", "week", "as_of"], unique=False, schema="research"
    )
