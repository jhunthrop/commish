"""THE NFLVERSE WEEKLY ARCHIVES, the draft and the play callers: one row per fact, keyed by the fact.
Also the game table, its reads, and an operator's voids of its games (`game_voids`, revision 0023).

Each archive table holds one release's weekly rows; the table name says where they came from, so
no row repeats it in a `source` column.
"""

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

from research.db.schema._base import METADATA, RESEARCH_SCHEMA, one_of, recorded_at

KICKING_COLUMNS: Final = (
    "fg_made",
    "fg_att",
    "fg_missed",
    "fg_blocked",
    "fg_made_0_19",
    "fg_made_20_29",
    "fg_made_30_39",
    "fg_made_40_49",
    "fg_made_50_59",
    "fg_made_60",
    "fg_missed_0_19",
    "fg_missed_20_29",
    "fg_missed_30_39",
    "fg_missed_40_49",
    "fg_missed_50_59",
    "fg_missed_60",
    "pat_made",
    "pat_att",
    "pat_missed",
    "pat_blocked",
)

DEFENSE_COUNT_COLUMNS: Final = (
    "def_interceptions",
    "fumble_recovery_opp",
    "def_tds",
    "def_safeties",
    "def_punt_blocks",
    "def_pat_blocks",
    "def_fg_blocks",
    "special_teams_tds",
    "passing_yards_allowed",
    "rushing_yards_allowed",
)

COACH_ROLES: Final = ("HC", "OC")
COACH_SOURCES: Final = ("wikipedia", "pfr", "both")


def _player_fk(table: str) -> ForeignKeyConstraint:
    return ForeignKeyConstraint(
        ["player_id"], [f"{RESEARCH_SCHEMA}.players.id"], ondelete="CASCADE", name=f"{table}_player_fk"
    )


NFLVERSE_INJURIES: Final = Table(
    "nflverse_injuries",
    METADATA,
    Column("season", Integer, primary_key=True),
    Column("week", Integer, primary_key=True),
    Column("player_id", Text, primary_key=True),
    Column("report_status", Text, nullable=False),
    Column("primary_injury", Text, nullable=False),
    Column("practice_status", Text, nullable=False),
    Column("date_modified", DateTime(True)),
    recorded_at(),
    _player_fk("nflverse_injuries"),
    Index("nflverse_injuries_player_idx", "player_id", "season", "week"),
)

NFLVERSE_KICKING_WEEKS: Final = Table(
    "nflverse_kicking_weeks",
    METADATA,
    Column("season", Integer, primary_key=True),
    Column("week", Integer, primary_key=True),
    Column("player_id", Text, primary_key=True),
    Column("team", Text, nullable=False),
    *(Column(name, Integer, nullable=False) for name in KICKING_COLUMNS),
    recorded_at(),
    _player_fk("nflverse_kicking_weeks"),
    Index("nflverse_kicking_weeks_player_idx", "player_id", "season", "week"),
    Index("nflverse_kicking_weeks_team_idx", "team", "season", "week"),
)

NFLVERSE_ROSTER_WEEKS: Final = Table(
    "nflverse_roster_weeks",
    METADATA,
    Column("season", Integer, primary_key=True),
    Column("week", Integer, primary_key=True),
    Column("player_id", Text, primary_key=True),
    Column("team", Text, nullable=False),
    Column("status", Text, nullable=False),
    Column("status_detail", Text, nullable=False),
    Column("position", Text, nullable=False),
    recorded_at(),
    _player_fk("nflverse_roster_weeks"),
    Index("nflverse_roster_weeks_player_idx", "player_id", "season", "week"),
)

NFLVERSE_TEAM_DEFENSE_WEEKS: Final = Table(
    "nflverse_team_defense_weeks",
    METADATA,
    Column("season", Integer, primary_key=True),
    Column("week", Integer, primary_key=True),
    Column("team", Text, primary_key=True),
    Column("opponent_team", Text, nullable=False),
    Column("def_sacks", Double(53), nullable=False),
    *(Column(name, Integer, nullable=False) for name in DEFENSE_COUNT_COLUMNS),
    Column("points_allowed", Integer),
    Column("sack_yards_lost_allowed", Integer),
    recorded_at(),
    Index("nflverse_team_defense_weeks_team_idx", "team", "season", "week"),
)

NFL_DRAFT_PICKS: Final = Table(
    "nfl_draft_picks",
    METADATA,
    Column("season", Integer, primary_key=True),
    Column("pick", Integer, primary_key=True),
    Column("round", Integer, nullable=False),
    Column("player_id", Text, nullable=False),
    Column("position", Text, nullable=False),
    Column("team", Text, nullable=False),
    Column("as_of", DateTime(True), nullable=False),
    recorded_at(),
    _player_fk("nfl_draft_picks"),
    Index("nfl_draft_picks_player_idx", "player_id"),
)

# nflverse's game table (`games.csv`), one row per game (revision 0010, Lane 66a): THE CURRENT STATE
# ONLY, NEVER AN AS-OF SOURCE. A future game's figures and venue move until kickoff and its result
# lands after, so the ingest rewrites a row whose values changed and `read_at` is the pass that last
# changed it; an earlier state is gone. What a pass read is kept append-only beside it:
# `nflverse_game_reads` (the venue and kickoff) and the `nflverse_game_figures` team-week source
# (the figures from each club's side). `kickoff_at` is the file's Eastern `gameday` and `gametime`
# as an instant, NULL while the time is unset.
NFLVERSE_GAMES: Final = Table(
    "nflverse_games",
    METADATA,
    Column("game_id", Text, primary_key=True),
    Column("season", Integer, nullable=False),
    Column("game_type", Text, nullable=False),
    Column("week", Integer, nullable=False),
    Column("gameday", Date, nullable=False),
    Column("gametime", Text),
    Column("kickoff_at", DateTime(True)),
    Column("home_team", Text, nullable=False),
    Column("away_team", Text, nullable=False),
    Column("location", Text, nullable=False),
    Column("home_score", Integer),
    Column("away_score", Integer),
    Column("result", Integer),
    Column("spread_line", Double(53)),
    Column("total_line", Double(53)),
    Column("roof", Text),
    Column("surface", Text),
    Column("temp", Double(53)),
    Column("wind", Double(53)),
    Column("stadium_id", Text, nullable=False),
    Column("stadium", Text, nullable=False),
    Column("read_at", DateTime(True), nullable=False),
    recorded_at(),
    Index("nflverse_games_week_idx", "season", "week"),
    Index("nflverse_games_kickoff_idx", "kickoff_at"),
)

# Each pass's read of every game it ingests (revision 0010): the venue and kickoff as the file stood,
# append-only (a re-run at the same instant writes nothing), so a replay reads the newest at or
# before its instant.
NFLVERSE_GAME_READS: Final = Table(
    "nflverse_game_reads",
    METADATA,
    Column("game_id", Text, primary_key=True),
    Column("read_at", DateTime(True), primary_key=True),
    Column("season", Integer, nullable=False),
    Column("week", Integer, nullable=False),
    Column("home_team", Text, nullable=False),
    Column("away_team", Text, nullable=False),
    Column("kickoff_at", DateTime(True)),
    Column("stadium_id", Text, nullable=False),
    Column("stadium", Text, nullable=False),
    Column("roof", Text),
    recorded_at(),
    Index("nflverse_game_reads_week_idx", "season", "week", "read_at"),
)

# An operator's void of one game of the game table (revision 0023, Lane 249, B255): a game cancelled
# but kept in games.csv with no result, or dropped from it and left as a stale row, never blocks its
# week's grade once voided. Append-only: a row is never updated or deleted, a void is lifted by a later
# row with `lifted` true, and the latest row per game at or before the pass is the game's standing.
GAME_VOIDS: Final = Table(
    "game_voids",
    METADATA,
    Column("game_id", Text, primary_key=True),
    Column("voided_at", DateTime(True), primary_key=True),
    Column("season", Integer, nullable=False),
    Column("week", Integer, nullable=False),
    Column("voided_by", Text, nullable=False),
    Column("reason", Text, nullable=False),
    Column("lifted", Boolean, nullable=False),
    recorded_at(),
    CheckConstraint("length(btrim(voided_by)) > 0", name="game_voids_voided_by_ck"),
    CheckConstraint("length(btrim(reason)) > 0", name="game_voids_reason_ck"),
    Index("game_voids_week_idx", "season", "week"),
)

COACHES: Final = Table(
    "coaches",
    METADATA,
    Column("season", Integer, primary_key=True),
    Column("team", Text, primary_key=True),
    Column("role", Text, primary_key=True),
    Column("start_week", Integer, primary_key=True),
    Column("end_week", Integer, nullable=False),
    Column("name", Text, nullable=False),
    Column("source", Text, nullable=False),
    Column("note", Text, nullable=False),
    Column("head_coach", Text),
    Column("head_coach_first_season", Integer),
    recorded_at(),
    one_of("role", COACH_ROLES, "coaches_role_ck"),
    one_of("source", COACH_SOURCES, "coaches_source_ck"),
    CheckConstraint("start_week >= 1 AND start_week <= end_week", name="coaches_weeks_ck"),
    CheckConstraint("(head_coach IS NULL) = (head_coach_first_season IS NULL)", name="coaches_head_coach_pair_ck"),
)
