"""WHAT THE DRAFT MARKET SAID BEFORE THE SEASON: week-one rosters, published boards and ADP over time."""

from typing import Final

from sqlalchemy import REAL, Column, DateTime, Double, ForeignKeyConstraint, Index, Integer, Table, Text

from research.db.schema._base import METADATA, RESEARCH_SCHEMA, recorded_at


def _player_fk(table: str) -> ForeignKeyConstraint:
    return ForeignKeyConstraint(
        ["player_id"], [f"{RESEARCH_SCHEMA}.players.id"], ondelete="CASCADE", name=f"{table}_player_fk"
    )


PRESEASON_ROSTERS: Final = Table(
    "preseason_rosters",
    METADATA,
    Column("season", Integer, primary_key=True),
    Column("player_id", Text, primary_key=True),
    Column("as_of", DateTime(True), primary_key=True),
    Column("team", Text, nullable=False),
    Column("position", Text, nullable=False),
    Column("status", Text, nullable=False),
    Column("birth_date", Text),
    Column("draft_year", Integer),
    Column("draft_pick", Integer),
    Column("draft_club", Text),
    recorded_at(),
    _player_fk("preseason_rosters"),
    Index("preseason_rosters_as_of_idx", "season", "as_of"),
)

PRESEASON_RANKINGS: Final = Table(
    "preseason_rankings",
    METADATA,
    Column("season", Integer, primary_key=True),
    Column("source", Text, primary_key=True),
    Column("player_id", Text, primary_key=True),
    Column("as_of", DateTime(True), primary_key=True),
    Column("rank", Double(53), nullable=False),
    recorded_at(),
    _player_fk("preseason_rankings"),
    Index("preseason_rankings_as_of_idx", "season", "source", "as_of"),
)

ADP_SNAPSHOTS: Final = Table(
    "adp_snapshots",
    METADATA,
    Column("player_id", Text, primary_key=True),
    Column("source", Text, primary_key=True),
    Column("captured_at", DateTime(True), primary_key=True),
    Column("format", Text, nullable=False),
    Column("adp", REAL, nullable=False),
    _player_fk("adp_snapshots"),
)
