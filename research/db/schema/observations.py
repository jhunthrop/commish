"""THE POINT-IN-TIME FACT STORES: every fact with the instant it became known (`as_of`).

A fact is never overwritten by a later statement of it; the later statement is another row, and a
read "as of" an instant takes the latest row at or before it. So the whole fact, `as_of`
included, is the primary key.
"""

from typing import Final

from sqlalchemy import Column, DateTime, Double, ForeignKeyConstraint, Index, Integer, Table, Text

from research.db.schema._base import METADATA, RESEARCH_SCHEMA, recorded_at

PLAYER_WEEK_OBSERVATIONS: Final = Table(
    "player_week_observations",
    METADATA,
    Column("season", Integer, primary_key=True),
    Column("week", Integer, primary_key=True),
    Column("player_id", Text, primary_key=True),
    Column("source", Text, primary_key=True),
    Column("metric", Text, primary_key=True),
    Column("as_of", DateTime(True), primary_key=True),
    Column("value", Double(53), nullable=False),
    recorded_at(),
    ForeignKeyConstraint(
        ["player_id"],
        [f"{RESEARCH_SCHEMA}.players.id"],
        ondelete="CASCADE",
        name="player_week_observations_player_fk",
    ),
    Index("player_week_observations_as_of_idx", "season", "week", "as_of"),
)

TEAM_WEEK_OBSERVATIONS: Final = Table(
    "team_week_observations",
    METADATA,
    Column("season", Integer, primary_key=True),
    Column("week", Integer, primary_key=True),
    Column("team", Text, primary_key=True),
    Column("source", Text, primary_key=True),
    Column("metric", Text, primary_key=True),
    Column("as_of", DateTime(True), primary_key=True),
    Column("value", Double(53), nullable=False),
    recorded_at(),
    Index("team_week_observations_as_of_idx", "season", "week", "as_of"),
)

PLAYER_WEEK_TEAMS: Final = Table(
    "player_week_teams",
    METADATA,
    Column("season", Integer, primary_key=True),
    Column("week", Integer, primary_key=True),
    Column("player_id", Text, primary_key=True),
    Column("team", Text, primary_key=True),
    Column("as_of", DateTime(True), primary_key=True),
    recorded_at(),
    ForeignKeyConstraint(
        ["player_id"], [f"{RESEARCH_SCHEMA}.players.id"], ondelete="CASCADE", name="player_week_teams_player_fk"
    ),
    Index("player_week_teams_as_of_idx", "season", "week", "as_of"),
)
