"""WHAT A LEAGUE'S OWN SCORING IS BUILT FROM: each stored board's candidate set, and the custom boards.

A stored board is `preseason_board(candidates, rules, shape, game_variance)` over one candidate set.
`preseason_candidates` keeps that set exactly as the board was given it (revision 0005), so a board
for any league's exact rules is the same function over the same candidates with the league's rules
and shape, and the three stored formats rebuild from it bit for bit (`research.parity`, the custom
board case). `custom_boards` caches each answer by the generation it was built from, the rules and
the shape; a new generation is a new key, so nothing in it is ever stale.
"""

from typing import Final

from sqlalchemy import CheckConstraint, Column, DateTime, Double, ForeignKeyConstraint, Index, Integer, Table, Text
from sqlalchemy.dialects.postgresql import JSONB

from research.db.schema._base import METADATA, POSITIONS, RESEARCH_SCHEMA, one_of, recorded_at

PRESEASON_CANDIDATES: Final = Table(
    "preseason_candidates",
    METADATA,
    Column("season", Integer, primary_key=True),
    Column("source", Text, primary_key=True),
    Column("as_of", DateTime(True), primary_key=True),
    Column("player_id", Text, primary_key=True),
    # The candidate's place in the set as the board was handed it: ties resolve in that order.
    Column("ordinal", Integer, nullable=False),
    Column("model_version", Text, nullable=False),
    Column("position", Text, nullable=False),
    Column("team", Text, nullable=False),
    # The per-game StatLine, every field by its snake_case name, an absent optional field omitted.
    Column("per_game", JSONB, nullable=False),
    # GamesPlayedOutlook: expected, rate, the distribution and the per-count probabilities.
    Column("games", JSONB, nullable=False),
    # The candidate's reasons as the board was handed them, in order.
    Column("reasons", JSONB, nullable=False),
    Column("per_game_tier_points", Double(53)),
    Column("season_projection_error_variance", Double(53)),
    recorded_at("computed_at"),
    one_of("position", POSITIONS, "preseason_candidates_position_ck"),
    CheckConstraint("ordinal >= 0", name="preseason_candidates_ordinal_ck"),
    ForeignKeyConstraint(
        ["player_id"], [f"{RESEARCH_SCHEMA}.players.id"], ondelete="CASCADE", name="preseason_candidates_player_fk"
    ),
    Index("preseason_candidates_board_idx", "season", "source", "as_of"),
)

CUSTOM_BOARDS: Final = Table(
    "custom_boards",
    METADATA,
    Column("season", Integer, primary_key=True),
    Column("as_of", DateTime(True), primary_key=True),
    Column("rules_hash", Text, primary_key=True),
    Column("shape_hash", Text, primary_key=True),
    # The stored board whose candidates it was built from.
    Column("source", Text, nullable=False),
    Column("rules", JSONB, nullable=False),
    Column("shape", JSONB, nullable=False),
    Column("rows", JSONB, nullable=False),
    Column("model_version", Text, nullable=False),
    recorded_at("computed_at"),
    CheckConstraint("jsonb_typeof(rows) = 'array'", name="custom_boards_rows_ck"),
)
