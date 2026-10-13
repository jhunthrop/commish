"""Revision 0001, the boards tables: model_artifacts, player_capsules, preseason_board_reasons, preseason_projections, register_freeze_rows, register_grade_rows."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


def create() -> None:
    _model_artifacts()
    _player_capsules()
    _preseason_board_reasons()
    _preseason_projections()
    _register_freeze_rows()
    _register_grade_rows()


def _model_artifacts() -> None:
    op.create_table(
        "model_artifacts",
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("fit_stamp", sa.DateTime(timezone=True), nullable=False),
        sa.Column("fitted_on", sa.Text(), nullable=False),
        sa.Column("payload", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("published_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint("version >= 1", name="model_artifacts_version_ck"),
        sa.PrimaryKeyConstraint("name", "version"),
        schema="research",
    )


def _player_capsules() -> None:
    op.create_table(
        "player_capsules",
        sa.Column("player_id", sa.Text(), nullable=False),
        sa.Column("facts_hash", sa.Text(), nullable=False),
        sa.Column("source", sa.Text(), nullable=False),
        sa.Column("model", sa.Text(), nullable=True),
        sa.Column("body_compact", sa.Text(), nullable=False),
        sa.Column("body_full", sa.Text(), nullable=False),
        sa.Column("narrative", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("generated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint("source IN ('llm', 'template')", name="player_capsules_source_ck"),
        sa.ForeignKeyConstraint(
            ["player_id"], ["research.players.id"], name="player_capsules_player_fk", ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("player_id"),
        schema="research",
    )


def _preseason_board_reasons() -> None:
    op.create_table(
        "preseason_board_reasons",
        sa.Column("season", sa.Integer(), nullable=False),
        sa.Column("source", sa.Text(), nullable=False),
        sa.Column("as_of", sa.DateTime(timezone=True), nullable=False),
        sa.Column("player_id", sa.Text(), nullable=False),
        sa.Column("code", sa.Text(), nullable=False),
        sa.Column("detail", sa.Text(), nullable=False),
        sa.Column("payload", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.ForeignKeyConstraint(
            ["player_id"], ["research.players.id"], name="preseason_board_reasons_player_fk", ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("season", "source", "as_of", "player_id", "code", "detail"),
        schema="research",
    )
    op.create_index(
        "preseason_board_reasons_board_idx",
        "preseason_board_reasons",
        ["season", "source", "as_of"],
        unique=False,
        schema="research",
    )


def _preseason_projections() -> None:
    op.create_table(
        "preseason_projections",
        sa.Column("season", sa.Integer(), nullable=False),
        sa.Column("source", sa.Text(), nullable=False),
        sa.Column("player_id", sa.Text(), nullable=False),
        sa.Column("as_of", sa.DateTime(timezone=True), nullable=False),
        sa.Column("moment_kind", sa.Text(), nullable=False),
        sa.Column("rank", sa.Integer(), nullable=False),
        sa.Column("position_rank", sa.Integer(), nullable=False),
        sa.Column("value_rank", sa.Integer(), nullable=False),
        sa.Column("tier", sa.Integer(), nullable=False),
        sa.Column("projected_points", sa.Double(precision=53), nullable=False),
        sa.Column("value_over_replacement", sa.Double(precision=53), nullable=False),
        sa.Column("expected_games", sa.Double(precision=53), nullable=False),
        sa.Column("floor_points", sa.Double(precision=53), nullable=False),
        sa.Column("median_points", sa.Double(precision=53), nullable=False),
        sa.Column("ceiling_points", sa.Double(precision=53), nullable=False),
        sa.Column("computed_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint("moment_kind IN ('replay', 'live')", name="preseason_projections_moment_kind_ck"),
        sa.ForeignKeyConstraint(
            ["player_id"], ["research.players.id"], name="preseason_projections_player_fk", ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("season", "source", "player_id", "as_of"),
        schema="research",
    )
    op.create_index(
        "preseason_projections_as_of_idx",
        "preseason_projections",
        ["season", "source", "as_of"],
        unique=False,
        schema="research",
    )


def _register_freeze_rows() -> None:
    op.create_table(
        "register_freeze_rows",
        sa.Column("season", sa.Integer(), nullable=False),
        sa.Column("week", sa.Integer(), nullable=False),
        sa.Column("frozen_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("board_source", sa.Text(), nullable=False),
        sa.Column("player_id", sa.Text(), nullable=False),
        sa.Column("implementation", sa.Text(), nullable=False),
        sa.Column("board_as_of", sa.DateTime(timezone=True), nullable=False),
        sa.Column("board_points", sa.Double(precision=53), nullable=False),
        sa.Column("board_rank", sa.Integer(), nullable=False),
        sa.Column("board_value_rank", sa.Integer(), nullable=False),
        sa.Column("adp", sa.Double(precision=53), nullable=True),
        sa.Column("ecr", sa.Double(precision=53), nullable=True),
        sa.Column("props_points", sa.Double(precision=53), nullable=True),
        sa.Column("props_markets", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.CheckConstraint("implementation IN ('typescript', 'python')", name="register_freeze_rows_implementation_ck"),
        sa.ForeignKeyConstraint(
            ["player_id"], ["research.players.id"], name="register_freeze_rows_player_fk", ondelete="RESTRICT"
        ),
        sa.PrimaryKeyConstraint("season", "week", "frozen_at", "board_source", "player_id"),
        schema="research",
    )


def _register_grade_rows() -> None:
    op.create_table(
        "register_grade_rows",
        sa.Column("season", sa.Integer(), nullable=False),
        sa.Column("week", sa.Integer(), nullable=False),
        sa.Column("frozen_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("graded_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("board_source", sa.Text(), nullable=False),
        sa.Column("player_id", sa.Text(), nullable=False),
        sa.Column("actual_points", sa.Double(precision=53), nullable=False),
        sa.Column("actual_rank", sa.Integer(), nullable=False),
        sa.Column("board_rank", sa.Integer(), nullable=False),
        sa.Column("adp_rank", sa.Integer(), nullable=True),
        sa.Column("ecr_rank", sa.Integer(), nullable=True),
        sa.Column("props_rank", sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(
            ["player_id"], ["research.players.id"], name="register_grade_rows_player_fk", ondelete="RESTRICT"
        ),
        sa.PrimaryKeyConstraint("season", "week", "frozen_at", "graded_at", "board_source", "player_id"),
        schema="research",
    )
    op.create_index(
        "register_grade_rows_graded_idx",
        "register_grade_rows",
        ["season", "week", "graded_at"],
        unique=False,
        schema="research",
    )
