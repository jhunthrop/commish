"""WHAT THE MODEL SAID: the fitted artifacts, the boards and their reasons, the register, the capsules."""

from typing import Final

from sqlalchemy import CheckConstraint, Column, DateTime, Double, ForeignKeyConstraint, Index, Integer, Table, Text
from sqlalchemy.dialects.postgresql import JSONB

from research.db.schema._base import METADATA, RESEARCH_SCHEMA, one_of, recorded_at

MOMENT_KINDS: Final = ("replay", "live")
IMPLEMENTATIONS: Final = ("typescript", "python")
CAPSULE_SOURCES: Final = ("llm", "template")


def _player_fk(table: str, ondelete: str = "CASCADE") -> ForeignKeyConstraint:
    return ForeignKeyConstraint(
        ["player_id"], [f"{RESEARCH_SCHEMA}.players.id"], ondelete=ondelete, name=f"{table}_player_fk"
    )


MODEL_ARTIFACTS: Final = Table(
    "model_artifacts",
    METADATA,
    Column("name", Text, primary_key=True),
    Column("version", Integer, primary_key=True),
    Column("fit_stamp", DateTime(True), nullable=False),
    Column("fitted_on", Text, nullable=False),
    Column("payload", JSONB, nullable=False),
    recorded_at("published_at"),
    CheckConstraint("version >= 1", name="model_artifacts_version_ck"),
)

PRESEASON_PROJECTIONS: Final = Table(
    "preseason_projections",
    METADATA,
    Column("season", Integer, primary_key=True),
    Column("source", Text, primary_key=True),
    Column("player_id", Text, primary_key=True),
    Column("as_of", DateTime(True), primary_key=True),
    Column("moment_kind", Text, nullable=False),
    Column("rank", Integer, nullable=False),
    Column("position_rank", Integer, nullable=False),
    Column("value_rank", Integer, nullable=False),
    Column("tier", Integer, nullable=False),
    Column("projected_points", Double(53), nullable=False),
    Column("value_over_replacement", Double(53), nullable=False),
    Column("expected_games", Double(53), nullable=False),
    Column("floor_points", Double(53), nullable=False),
    Column("median_points", Double(53), nullable=False),
    Column("ceiling_points", Double(53), nullable=False),
    recorded_at("computed_at"),
    one_of("moment_kind", MOMENT_KINDS, "preseason_projections_moment_kind_ck"),
    _player_fk("preseason_projections"),
    Index("preseason_projections_as_of_idx", "season", "source", "as_of"),
)

# A board's reasons belong to the board generation they explain (`as_of`, the generation's stamp in
# `preseason_projections`), so a frozen board's reasons stay recoverable after a later generation
# is written. Not a foreign key onto a projection row: a reason can explain why a player is NOT on
# the board (`roster_status`, the roster gate's exclusions), and such a player has no projection
# row at that stamp. A reason code can apply to one player more than once with different
# particulars, so the `detail` that tells them apart is part of the key.
PRESEASON_BOARD_REASONS: Final = Table(
    "preseason_board_reasons",
    METADATA,
    Column("season", Integer, primary_key=True),
    Column("source", Text, primary_key=True),
    Column("as_of", DateTime(True), primary_key=True),
    Column("player_id", Text, primary_key=True),
    Column("code", Text, primary_key=True),
    Column("detail", Text, primary_key=True),
    Column("payload", JSONB, nullable=False),
    _player_fk("preseason_board_reasons"),
    Index("preseason_board_reasons_board_idx", "season", "source", "as_of"),
)

REGISTER_FREEZE_ROWS: Final = Table(
    "register_freeze_rows",
    METADATA,
    Column("season", Integer, primary_key=True),
    Column("week", Integer, primary_key=True),
    Column("frozen_at", DateTime(True), primary_key=True),
    Column("board_source", Text, primary_key=True),
    Column("player_id", Text, primary_key=True),
    # Which implementation froze the row: weeks 1 and 2 of 2026 were frozen by the TypeScript
    # before the port, and the record page says so.
    Column("implementation", Text, nullable=False),
    Column("board_as_of", DateTime(True), nullable=False),
    Column("board_points", Double(53), nullable=False),
    Column("board_rank", Integer, nullable=False),
    Column("board_value_rank", Integer, nullable=False),
    # What the market and the panel published for the player at the freeze: ADP is fractional as
    # published (12.5), and so is a consensus rank. The grade rows' `adp_rank` and `ecr_rank` are
    # different numbers, the player's ordinal place among the graded, so they are integers there.
    Column("adp", Double(53)),
    Column("ecr", Double(53)),
    Column("props_points", Double(53)),
    Column("props_markets", JSONB),
    one_of("implementation", IMPLEMENTATIONS, "register_freeze_rows_implementation_ck"),
    _player_fk("register_freeze_rows", "RESTRICT"),
)

REGISTER_GRADE_ROWS: Final = Table(
    "register_grade_rows",
    METADATA,
    Column("season", Integer, primary_key=True),
    Column("week", Integer, primary_key=True),
    Column("frozen_at", DateTime(True), primary_key=True),
    Column("graded_at", DateTime(True), primary_key=True),
    Column("board_source", Text, primary_key=True),
    Column("player_id", Text, primary_key=True),
    Column("actual_points", Double(53), nullable=False),
    Column("actual_rank", Integer, nullable=False),
    Column("board_rank", Integer, nullable=False),
    Column("adp_rank", Integer),
    Column("ecr_rank", Integer),
    Column("props_rank", Integer),
    _player_fk("register_grade_rows", "RESTRICT"),
    Index("register_grade_rows_graded_idx", "season", "week", "graded_at"),
)

PLAYER_CAPSULES: Final = Table(
    "player_capsules",
    METADATA,
    Column("player_id", Text, primary_key=True),
    Column("facts_hash", Text, nullable=False),
    Column("source", Text, nullable=False),
    Column("model", Text),
    Column("body_compact", Text, nullable=False),
    Column("body_full", Text, nullable=False),
    Column("narrative", JSONB),
    recorded_at("generated_at"),
    one_of("source", CAPSULE_SOURCES, "player_capsules_source_ck"),
    _player_fk("player_capsules"),
)
