"""WHAT THE PAID PROVIDERS SENT: Tank01's current-season store and archive, and the odds archive.

The Tank01 tables are the current season's live store by design (founder ruling 2026-09-04: the
stat store holds only the current season; prior years are read from the observations), so they
key by week alone and carry no season column. The two archives are append-only raw payloads.
"""

from typing import Final

from sqlalchemy import (
    REAL,
    BigInteger,
    Column,
    DateTime,
    Double,
    ForeignKeyConstraint,
    Identity,
    Index,
    Integer,
    Table,
    Text,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB

from research.db.schema._base import METADATA, RESEARCH_SCHEMA, one_of, recorded_at

WEEK_STATUSES: Final = ("scheduled", "in_progress", "final")

_COUNTING_COLUMNS: Final = (
    "passing_yards",
    "passing_touchdowns",
    "interceptions",
    "rushing_yards",
    "rushing_touchdowns",
    "receiving_yards",
    "receiving_touchdowns",
    "receptions",
    "fumbles_lost",
    "field_goals_made",
    "extra_points_made",
)
_DEFENSE_AND_USAGE_COLUMNS: Final = (
    "defensive_interceptions",
    "defensive_touchdowns",
    "targets",
    "carries",
    "pass_attempts",
    "pass_completions",
    "field_goals_attempted",
    "points_allowed",
    "offensive_snaps",
)
_LATER_COLUMNS: Final = (
    "two_point_conversions",
    "field_goals_missed",
    "extra_points_missed",
    "kick_return_touchdowns",
    "punt_return_touchdowns",
    "yards_allowed",
    "defensive_fumbles_recovered",
    "safeties",
)


def _count(name: str) -> "Column[int]":
    return Column(name, Integer, nullable=False, server_default=text("0"))


def _share(name: str) -> "Column[float]":
    return Column(name, REAL, nullable=False, server_default=text("0"))


PROVIDER_STAT_LINES: Final = Table(
    "provider_stat_lines",
    METADATA,
    Column("provider_player_id", Text, primary_key=True),
    Column("week", Integer, primary_key=True),
    *(_count(name) for name in _COUNTING_COLUMNS),
    _share("sacks"),
    *(_count(name) for name in _DEFENSE_AND_USAGE_COLUMNS),
    _share("offensive_snap_share"),
    *(_count(name) for name in _LATER_COLUMNS),
    ForeignKeyConstraint(
        ["provider_player_id"],
        [f"{RESEARCH_SCHEMA}.provider_players.id"],
        ondelete="CASCADE",
        name="provider_stat_lines_provider_player_fk",
    ),
    Index("provider_stat_lines_week_idx", "week"),
)

PROVIDER_GAMES: Final = Table(
    "provider_games",
    METADATA,
    Column("game_id", Text, primary_key=True),
    Column("week", Integer, nullable=False),
    Column("home_team", Text, nullable=False),
    Column("away_team", Text, nullable=False),
    Column("game_date", Text, nullable=False),
    Column("kickoff_et", Text, nullable=False),
    Column("status", Text, nullable=False),
    recorded_at(),
    Index("provider_games_week_idx", "week"),
)

PROVIDER_WEEKS: Final = Table(
    "provider_weeks",
    METADATA,
    Column("week", Integer, primary_key=True, autoincrement=False),
    Column("status", Text, nullable=False, server_default=text("'scheduled'")),
    Column("version", Integer, nullable=False, server_default=text("0")),
    Column("games_total", Integer, nullable=False, server_default=text("0")),
    Column("games_final", Integer, nullable=False, server_default=text("0")),
    Column("updated_at", DateTime(True), nullable=False, server_default=text("now()")),
    one_of("status", WEEK_STATUSES, "provider_weeks_status_ck"),
)

# Append-only: the same feed can be captured twice at one instant (a re-run on a pinned clock),
# and both captures are kept, so a surrogate id is the only key.
CAPTURE_SNAPSHOTS: Final = Table(
    "capture_snapshots",
    METADATA,
    Column("id", BigInteger, Identity(always=False), primary_key=True),
    Column("source", Text, nullable=False),
    Column("captured_at", DateTime(True), nullable=False),
    Column("digest", Text, nullable=False),
    Column("payload", JSONB, nullable=False),
    Index("capture_snapshots_source_captured_idx", "source", "captured_at"),
)

# A plain insert: one event's props fetched twice hold identical rows, and both are kept.
PLAYER_PROP_OBSERVATIONS: Final = Table(
    "player_prop_observations",
    METADATA,
    Column("id", BigInteger, Identity(always=False), primary_key=True),
    Column("event_id", Text, nullable=False),
    Column("commence_time", DateTime(True), nullable=False),
    Column("bookmaker", Text, nullable=False),
    Column("market", Text, nullable=False),
    Column("player_name", Text, nullable=False),
    Column("point", Double(53), nullable=False),
    Column("over_price", Integer, nullable=False),
    Column("under_price", Integer, nullable=False),
    Column("fetched_at", DateTime(True), nullable=False),
    Index("player_prop_observations_event_market_idx", "event_id", "market"),
    Index("player_prop_observations_fetched_at_idx", "fetched_at"),
)
