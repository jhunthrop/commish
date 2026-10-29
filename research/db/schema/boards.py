"""WHAT THE MODEL SAID: the fitted artifacts, the boards and their reasons, the register, the capsules."""

from typing import Final

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Column,
    Date,
    DateTime,
    Double,
    ForeignKeyConstraint,
    Index,
    Integer,
    Table,
    Text,
)
from sqlalchemy.dialects.postgresql import JSONB

from research.db.schema._base import METADATA, RESEARCH_SCHEMA, one_of, recorded_at

MOMENT_KINDS: Final = ("replay", "live")
IMPLEMENTATIONS: Final = ("typescript", "python")
# `template` is the oracle's prose floor, carried by the loader and never written here (revision 0004).
CAPSULE_SOURCES: Final = ("llm", "facts", "template")


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
    # Which model made the board (`research@<sha>`, `research-ts@<sha>`) and in which floating point
    # (`research.model.arithmetic`). NULL only on a legacy board whose writer recorded neither and
    # which nothing has rebuilt (`research.db.provenance`).
    Column("model_version", Text),
    Column("arithmetic", Text),
    one_of("moment_kind", MOMENT_KINDS, "preseason_projections_moment_kind_ck"),
    _player_fk("preseason_projections"),
    Index("preseason_projections_as_of_idx", "season", "source", "as_of"),
)

# A board's reasons belong to the board generation they explain (`as_of`, the generation's stamp in
# `preseason_projections`), so a frozen board's reasons stay recoverable after a later generation
# is written. Not a foreign key onto a projection row: a reason can explain why a player is NOT on
# the board (`roster_status`, the roster gate's exclusions), and such a player has no projection
# row at that stamp. A reason code can apply to one player more than once with different
# particulars, so the `detail` that tells them apart is part of the key. `ordinal` is the reason's
# place among its player's reasons as the board emitted them (revision 0003): the readers group and
# sum in that order, so it is stored rather than left to the heap.
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
    Column("ordinal", Integer, nullable=False),
    _player_fk("preseason_board_reasons"),
    CheckConstraint("ordinal >= 0", name="preseason_board_reasons_ordinal_ck"),
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
    # The model that made the board the freeze quotes, which is not the process that froze it: a
    # Python freeze of a board the TypeScript persisted is implementation python, model research-ts.
    Column("model_version", Text, nullable=False),
    # The week's published projection for him in PPR, the newest snapshot at the freeze (revision
    # 0013): a benchmark the record grades beside ours from week 7, NULL where it lists no row for him.
    Column("published_points", Double(53)),
    # ESPN's own weekly projection for him in PPR, the newest public read at or before the freeze
    # (revision 0017, Lane 114): a yardstick the weekly record grades beside ours from week 7, NULL
    # where that read lists no row for him, where he has no ESPN id, and on every earlier freeze.
    Column("espn_points", Double(53)),
    # The instant of the ESPN read `espn_points` came from (revision 0019, Lane 146, Amendment 6): the
    # freeze's own read, or the first read after it and before the week's first kickoff when the freeze
    # kept none (`espn-fill`). The grader keeps it beside `frozen_at`. NULL where `espn_points` is.
    Column("espn_read_at", DateTime(True)),
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
    # Which implementation graded, and the model of the board graded (copied from its freeze rows).
    Column("implementation", Text, nullable=False),
    Column("model_version", Text, nullable=False),
    one_of("implementation", IMPLEMENTATIONS, "register_grade_rows_implementation_ck"),
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


# The weekly number's register (revision 0011, Lane 69; round 4, sections 3.3 and 4): each game's frozen
# numbers before its own kickoff, with the range, the why and the benchmarks beside them. `counted` only
# for the pinned served version; every other row is a shadow. Append-only.
_WEEKLY_FORMATS: Final = ("ppr", "half", "std")
REGISTER_WEEKLY_ROWS: Final = Table(
    "register_weekly_rows",
    METADATA,
    Column("season", Integer, primary_key=True),
    Column("week", Integer, primary_key=True),
    Column("game_id", Text, primary_key=True),
    Column("frozen_at", DateTime(True), primary_key=True),
    Column("model_version", Text, primary_key=True),
    Column("player_id", Text, primary_key=True),
    Column("implementation", Text, nullable=False),
    Column("kickoff_at", DateTime(True), nullable=False),
    Column("club", Text, nullable=False),
    Column("counted", Boolean, nullable=False),
    Column("questionable", Boolean, nullable=False),
    *(
        Column(f"{part}_{name}", Double(53), nullable=False)
        for name in _WEEKLY_FORMATS
        for part in ("point", "floor", "median", "ceiling")
    ),
    Column("why", JSONB, nullable=False),
    Column("benchmarks", JSONB, nullable=False),
    recorded_at("recorded_at"),
    one_of("implementation", IMPLEMENTATIONS, "register_weekly_rows_implementation_ck"),
    CheckConstraint("frozen_at < kickoff_at", name="register_weekly_rows_before_kickoff_ck"),
    _player_fk("register_weekly_rows", "RESTRICT"),
    Index("register_weekly_rows_week_idx", "season", "week"),
)


# The week-ahead reads (revision 0012, Lane 72; reason "rule" since 0024, Lane 275; "fact" since 0025, Lane 299): one per player and week, the writer's three to five
# sentences about his next game or its facts block, stamped with the write and every fact's own stamp.
WEEK_READ_SOURCES: Final = ("llm", "facts")
WEEK_READ_REASONS: Final = ("first", "unwritten", "status", "projection", "demoted", "rule", "fact")
WEEK_READ_CALLS: Final = ("start", "sit", "hold", "none")
PLAYER_WEEK_READS: Final = Table(
    "player_week_reads",
    METADATA,
    Column("player_id", Text, primary_key=True),
    Column("season", Integer, primary_key=True),
    Column("week", Integer, primary_key=True),
    Column("source", Text, nullable=False),
    Column("body", Text, nullable=False),
    Column("model", Text),
    Column("written_at", DateTime(True), nullable=False),
    Column("facts_at", DateTime(True)),
    Column("stamps", JSONB, nullable=False),
    Column("projection_points", Double(53)),
    Column("status", Text),
    Column("reason", Text, nullable=False),
    Column("call", Text),
    Column("attempt_day", Date, nullable=False),
    Column("attempts", Integer, nullable=False),
    recorded_at("recorded_at"),
    one_of("source", WEEK_READ_SOURCES, "player_week_reads_source_ck"),
    one_of("reason", WEEK_READ_REASONS, "player_week_reads_reason_ck"),
    CheckConstraint("week BETWEEN 1 AND 18", name="player_week_reads_week_ck"),
    one_of("call", WEEK_READ_CALLS, "player_week_reads_call_ck"),
    CheckConstraint("attempts >= 1", name="player_week_reads_attempts_ck"),
    CheckConstraint("facts_at IS NULL OR facts_at <= written_at", name="player_week_reads_facts_before_write_ck"),
    _player_fk("player_week_reads"),
    Index("player_week_reads_week_idx", "season", "week"),
)

# Each week-read pass's spend (revision 0012): the hourly passes hold to a daily dollar cap from it.
WEEK_READ_MODES: Final = ("nightly", "hourly")
PLAYER_WEEK_READ_RUNS: Final = Table(
    "player_week_read_runs",
    METADATA,
    Column("ran_at", DateTime(True), primary_key=True),
    Column("mode", Text, primary_key=True),
    Column("calls", Integer, nullable=False),
    Column("cost_usd", Double(53), nullable=False),
    Column("written", Integer, nullable=False),
    Column("facts_blocks", Integer, nullable=False),
    Column("demoted", Integer, nullable=False),
    recorded_at("recorded_at"),
    one_of("mode", WEEK_READ_MODES, "player_week_read_runs_mode_ck"),
)
