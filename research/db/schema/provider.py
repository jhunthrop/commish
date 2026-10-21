"""WHAT THE PAID PROVIDERS SENT: Tank01's current-season store and archive, and the odds archive.

THE ROLLOVER RULE. The Tank01 store holds ONE season (founder ruling 2026-09-04: the stat store
holds only the current season; prior years are read from the observations). Every row still
carries its `season` and is keyed by `(season, week)`, so a read names the season it means and a
row can never be mistaken for another season's week. The writers enforce the rule: before
`ingest_roster_and_lines` or `ingest_schedule` writes season S, `retire_other_seasons` deletes every
`provider_stat_lines`, `provider_games` and `provider_weeks` row of any other season in the same
transaction, so a new season starts clean (the 2026-09-01 stale-roster lesson: a live table retires
the previous claim when it writes the next). `provider_players` is the provider's roster of
people, not a season's store, and is upserted across seasons.

NO DEFAULT HIDES A MISSING VALUE. A box-score stat the provider omits is a stat the player did not
record (Tank01 leaves zero categories out of a box score); the writer states that zero explicitly,
as the TypeScript's stat line does, so every column is written and none has a default. A game's
date and its kickoff time are nullable because the provider can omit them.

The two archives are append-only raw payloads.
"""

from typing import Final

from sqlalchemy import (
    BigInteger,
    Column,
    Date,
    DateTime,
    Double,
    ForeignKeyConstraint,
    Identity,
    Index,
    Integer,
    Table,
    Text,
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
    return Column(name, Integer, nullable=False)


def _share(name: str) -> "Column[float]":
    return Column(name, Double(53), nullable=False)


PROVIDER_STAT_LINES: Final = Table(
    "provider_stat_lines",
    METADATA,
    Column("season", Integer, primary_key=True),
    Column("week", Integer, primary_key=True),
    Column("provider_player_id", Text, primary_key=True),
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
    Index("provider_stat_lines_player_idx", "provider_player_id", "season", "week"),
)

PROVIDER_GAMES: Final = Table(
    "provider_games",
    METADATA,
    # The provider's own game id (`20260910_DAL@PHI`), unique across seasons on its own.
    Column("game_id", Text, primary_key=True),
    Column("season", Integer, nullable=False),
    Column("week", Integer, nullable=False),
    Column("home_team", Text, nullable=False),
    Column("away_team", Text, nullable=False),
    Column("game_date", Date),
    # The provider's display string (`8:20p`, Eastern), kept verbatim: research reads kickoff
    # instants from the nflverse schedule's observations, never from this.
    Column("kickoff_et", Text),
    Column("status", Text, nullable=False),
    recorded_at(),
    # The provider's new id for this game when its week no longer lists this one but lists the same two
    # clubs under another (a date change, B77b, revision 0016); NULL for a game to play. Every reader of
    # the schedule leaves a superseded row out (GAME_TO_PLAY).
    Column("superseded_by", Text),
    Index("provider_games_week_idx", "season", "week"),
)

# The schedule's readers keep only the games to play: a row the ingest marked superseded is not one.
GAME_TO_PLAY: Final = "superseded_by is null"

PROVIDER_WEEKS: Final = Table(
    "provider_weeks",
    METADATA,
    Column("season", Integer, primary_key=True, autoincrement=False),
    Column("week", Integer, primary_key=True, autoincrement=False),
    Column("status", Text, nullable=False),
    Column("version", Integer, nullable=False),
    Column("games_total", Integer, nullable=False),
    Column("games_final", Integer, nullable=False),
    Column("updated_at", DateTime(True), nullable=False),
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
    # The game a per-game box score was asked about (B86, revision 0016), whatever its answer names; NULL
    # for every other feed and for the box scores kept before the column.
    Column("asked_game_id", Text),
    Index("capture_snapshots_source_captured_idx", "source", "captured_at"),
)

# The capture job's last successful check of each feed (revision 0008, Lane 63): a feed whose list
# has not changed writes no snapshot, so this says when the list was last read, whatever it held.
CAPTURE_CHECKS: Final = Table(
    "capture_checks",
    METADATA,
    Column("source", Text, primary_key=True),
    Column("checked_at", DateTime(True), nullable=False),
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

# Tank01's weekly projection, one row per player of one `tank01_projections` snapshot (revision 0009):
# the prospective benchmark of the weekly round 4, never an input and never a word on the site. The
# snapshot's own id and instant key it, so the latest capture before a kickoff is the benchmark's read.
TANK01_PROJECTION_ROWS: Final = Table(
    "tank01_projection_rows",
    METADATA,
    Column("snapshot_id", BigInteger, primary_key=True),
    Column("provider_player_id", Text, primary_key=True),
    Column("captured_at", DateTime(True), nullable=False),
    Column("season", Integer, nullable=False),
    Column("week", Integer, nullable=False),
    Column("position", Text, nullable=False),
    Column("team", Text, nullable=False),
    Column("ppr_points", Double(53), nullable=False),
    Column("half_points", Double(53), nullable=False),
    Column("standard_points", Double(53), nullable=False),
    Column("pass_yards", Double(53)),
    Column("pass_touchdowns", Double(53)),
    Column("interceptions", Double(53)),
    Column("carries", Double(53)),
    Column("rush_yards", Double(53)),
    Column("rush_touchdowns", Double(53)),
    Column("targets", Double(53)),
    Column("receptions", Double(53)),
    Column("receiving_yards", Double(53)),
    Column("receiving_touchdowns", Double(53)),
    Column("fumbles_lost", Double(53)),
    recorded_at(),
    ForeignKeyConstraint(
        ["snapshot_id"],
        [f"{RESEARCH_SCHEMA}.capture_snapshots.id"],
        ondelete="CASCADE",
        name="tank01_projection_rows_snapshot_fk",
    ),
    Index("tank01_projection_rows_week_idx", "season", "week", "captured_at"),
)

# The anytime-touchdown market (revision 0009): a Yes price, and a No price where the book quotes one,
# which `player_prop_observations` (point and under price NOT NULL) cannot hold. Append-only like it:
# one event fetched twice keeps both. The market benchmark only, never an input, never on the site.
PLAYER_TD_PROP_OBSERVATIONS: Final = Table(
    "player_td_prop_observations",
    METADATA,
    Column("id", BigInteger, Identity(always=False), primary_key=True),
    Column("event_id", Text, nullable=False),
    Column("commence_time", DateTime(True), nullable=False),
    Column("bookmaker", Text, nullable=False),
    Column("player_name", Text, nullable=False),
    Column("yes_price", Integer, nullable=False),
    Column("no_price", Integer),
    Column("fetched_at", DateTime(True), nullable=False),
    Index("player_td_prop_observations_event_idx", "event_id", "fetched_at"),
    Index("player_td_prop_observations_fetched_at_idx", "fetched_at"),
)
