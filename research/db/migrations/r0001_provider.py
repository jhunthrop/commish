"""Revision 0001, the provider tables: capture_snapshots, player_prop_observations, provider_games, provider_weeks, provider_stat_lines."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


def create() -> None:
    _capture_snapshots()
    _player_prop_observations()
    _provider_games()
    _provider_weeks()
    _provider_stat_lines()


def _capture_snapshots() -> None:
    op.create_table(
        "capture_snapshots",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=False), nullable=False),
        sa.Column("source", sa.Text(), nullable=False),
        sa.Column("captured_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("digest", sa.Text(), nullable=False),
        sa.Column("payload", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        schema="research",
    )
    op.create_index(
        "capture_snapshots_source_captured_idx",
        "capture_snapshots",
        ["source", "captured_at"],
        unique=False,
        schema="research",
    )


def _player_prop_observations() -> None:
    op.create_table(
        "player_prop_observations",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=False), nullable=False),
        sa.Column("event_id", sa.Text(), nullable=False),
        sa.Column("commence_time", sa.DateTime(timezone=True), nullable=False),
        sa.Column("bookmaker", sa.Text(), nullable=False),
        sa.Column("market", sa.Text(), nullable=False),
        sa.Column("player_name", sa.Text(), nullable=False),
        sa.Column("point", sa.Double(precision=53), nullable=False),
        sa.Column("over_price", sa.Integer(), nullable=False),
        sa.Column("under_price", sa.Integer(), nullable=False),
        sa.Column("fetched_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        schema="research",
    )
    op.create_index(
        "player_prop_observations_event_market_idx",
        "player_prop_observations",
        ["event_id", "market"],
        unique=False,
        schema="research",
    )
    op.create_index(
        "player_prop_observations_fetched_at_idx",
        "player_prop_observations",
        ["fetched_at"],
        unique=False,
        schema="research",
    )


def _provider_games() -> None:
    op.create_table(
        "provider_games",
        sa.Column("game_id", sa.Text(), nullable=False),
        sa.Column("week", sa.Integer(), nullable=False),
        sa.Column("home_team", sa.Text(), nullable=False),
        sa.Column("away_team", sa.Text(), nullable=False),
        sa.Column("game_date", sa.Text(), nullable=False),
        sa.Column("kickoff_et", sa.Text(), nullable=False),
        sa.Column("status", sa.Text(), nullable=False),
        sa.Column("ingested_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("game_id"),
        schema="research",
    )
    op.create_index("provider_games_week_idx", "provider_games", ["week"], unique=False, schema="research")


def _provider_weeks() -> None:
    op.create_table(
        "provider_weeks",
        sa.Column("week", sa.Integer(), autoincrement=False, nullable=False),
        sa.Column("status", sa.Text(), server_default=sa.text("'scheduled'"), nullable=False),
        sa.Column("version", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("games_total", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("games_final", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint("status IN ('scheduled', 'in_progress', 'final')", name="provider_weeks_status_ck"),
        sa.PrimaryKeyConstraint("week"),
        schema="research",
    )


def _provider_stat_lines() -> None:
    op.create_table(
        "provider_stat_lines",
        sa.Column("provider_player_id", sa.Text(), nullable=False),
        sa.Column("week", sa.Integer(), nullable=False),
        sa.Column("passing_yards", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("passing_touchdowns", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("interceptions", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("rushing_yards", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("rushing_touchdowns", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("receiving_yards", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("receiving_touchdowns", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("receptions", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("fumbles_lost", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("field_goals_made", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("extra_points_made", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("sacks", sa.REAL(), server_default=sa.text("0"), nullable=False),
        sa.Column("defensive_interceptions", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("defensive_touchdowns", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("targets", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("carries", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("pass_attempts", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("pass_completions", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("field_goals_attempted", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("points_allowed", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("offensive_snaps", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("offensive_snap_share", sa.REAL(), server_default=sa.text("0"), nullable=False),
        sa.Column("two_point_conversions", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("field_goals_missed", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("extra_points_missed", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("kick_return_touchdowns", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("punt_return_touchdowns", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("yards_allowed", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("defensive_fumbles_recovered", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("safeties", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.ForeignKeyConstraint(
            ["provider_player_id"],
            ["research.provider_players.id"],
            name="provider_stat_lines_provider_player_fk",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("provider_player_id", "week"),
        schema="research",
    )
    op.create_index("provider_stat_lines_week_idx", "provider_stat_lines", ["week"], unique=False, schema="research")
