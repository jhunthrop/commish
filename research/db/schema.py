"""THE RESEARCH SCHEMA, as SQLAlchemy core tables.

Generated once from the drizzle-migrated schema (journal head `0089_draft_room_facts`) with
sqlacodegen and then held by hand. It is the single source of every table name and column the
pipeline writes, and the metadata the alembic baseline (`alembic/versions/0001_baseline.py`) is
checked against. A table here is a research table: written or read by the ingests, the fit, the
capsules or the nightly run. Everything else in the database belongs to the app lanes.

The tables live in `public` today, exactly where drizzle put them. Moving them into a `research`
schema is a later revision, not part of the baseline, because the baseline must equal what exists.
"""

from sqlalchemy import (
    REAL,
    BigInteger,
    CheckConstraint,
    Column,
    DateTime,
    Double,
    ForeignKeyConstraint,
    Index,
    Integer,
    MetaData,
    PrimaryKeyConstraint,
    Table,
    Text,
    text,
)
from sqlalchemy.dialects.postgresql import ARRAY, ENUM, JSONB

METADATA = MetaData()

# The four enum types research tables use. `create_type=False` because the baseline creates them
# explicitly, once, before any table that names them.
PLAYER_POSITION = ENUM("QB", "RB", "WR", "TE", "K", "DEF", name="player_position", create_type=False)
WEEK_STATUS = ENUM("scheduled", "in_progress", "final", name="week_status", create_type=False)
CAPSULE_SOURCE = ENUM("llm", "template", name="capsule_source", create_type=False)
BOARD_MOMENT_KIND = ENUM("replay", "live", name="board_moment_kind", create_type=False)

CAPTURE_SNAPSHOTS = Table(
    "capture_snapshots",
    METADATA,
    Column("id", BigInteger, primary_key=True, autoincrement=True),
    Column("source", Text, nullable=False),
    Column("captured_at", DateTime(True), nullable=False),
    Column("digest", Text, nullable=False),
    Column("payload", JSONB, nullable=False),
    PrimaryKeyConstraint("id", name="capture_snapshots_pkey"),
    Index("capture_snapshots_source_captured_idx", "source", "captured_at"),
)

COACHES = Table(
    "coaches",
    METADATA,
    Column("id", BigInteger, primary_key=True, autoincrement=True),
    Column("season", Integer, nullable=False),
    Column("team", Text, nullable=False),
    Column("role", Text, nullable=False),
    Column("name", Text, nullable=False),
    Column("start_week", Integer, nullable=False),
    Column("end_week", Integer, nullable=False),
    Column("source", Text, nullable=False),
    Column("note", Text, nullable=False),
    Column("head_coach", Text),
    Column("head_coach_first_season", Integer),
    Column("ingested_at", DateTime(True), nullable=False, server_default=text("now()")),
    CheckConstraint("(head_coach IS NULL) = (head_coach_first_season IS NULL)", name="coaches_head_coach_pair_ck"),
    CheckConstraint("role = ANY (ARRAY['HC'::text, 'OC'::text])", name="coaches_role_ck"),
    CheckConstraint("source = ANY (ARRAY['wikipedia'::text, 'pfr'::text, 'both'::text])", name="coaches_source_ck"),
    CheckConstraint("start_week >= 1 AND start_week <= end_week", name="coaches_weeks_ck"),
    PrimaryKeyConstraint("id", name="coaches_pkey"),
    Index("coaches_tenure_idx", "season", "team", "role", "start_week", unique=True),
)

MODEL_ARTIFACTS = Table(
    "model_artifacts",
    METADATA,
    Column("id", BigInteger, primary_key=True, autoincrement=True),
    Column("name", Text, nullable=False),
    Column("version", Integer, nullable=False),
    Column("fit_stamp", DateTime(True), nullable=False),
    Column("fitted_on", Text, nullable=False),
    Column("payload", JSONB, nullable=False),
    Column("published_at", DateTime(True), nullable=False, server_default=text("now()")),
    CheckConstraint("version >= 1", name="model_artifacts_version_ck"),
    PrimaryKeyConstraint("id", name="model_artifacts_pkey"),
    Index("model_artifacts_name_version_idx", "name", "version", unique=True),
)

NFL_GAMES = Table(
    "nfl_games",
    METADATA,
    Column("game_id", Text, primary_key=True),
    Column("week", Integer, nullable=False),
    Column("home_nfl_team", Text, nullable=False),
    Column("away_nfl_team", Text, nullable=False),
    Column("game_date", Text, nullable=False, server_default=text("''::text")),
    Column("kickoff_et", Text, nullable=False, server_default=text("''::text")),
    Column("status", Text, nullable=False),
    Column("ingested_at", DateTime(True), nullable=False, server_default=text("now()")),
    PrimaryKeyConstraint("game_id", name="nfl_games_pkey"),
    Index("nfl_games_week_idx", "week"),
)

NFL_PLAYERS = Table(
    "nfl_players",
    METADATA,
    Column("id", Text, primary_key=True),
    Column("pfr_id", Text),
    Column("name", Text, nullable=False),
    Column("position", Text, nullable=False),
    Column("latest_team", Text),
    Column("rookie_season", Integer),
    Column("last_season", Integer),
    Column("espn_id", Text),
    PrimaryKeyConstraint("id", name="nfl_players_pkey"),
    Index("nfl_players_espn_id_idx", "espn_id", unique=True),
    Index("nfl_players_pfr_id_idx", "pfr_id", unique=True),
)

NFLVERSE_TEAM_DEFENSE_WEEKS = Table(
    "nflverse_team_defense_weeks",
    METADATA,
    Column("season", Integer, primary_key=True),
    Column("week", Integer, primary_key=True),
    Column("team", Text, primary_key=True),
    Column("opponent_team", Text, nullable=False),
    Column("def_sacks", REAL, nullable=False),
    Column("def_interceptions", Integer, nullable=False),
    Column("fumble_recovery_opp", Integer, nullable=False),
    Column("def_tds", Integer, nullable=False),
    Column("def_safeties", Integer, nullable=False),
    Column("def_punt_blocks", Integer, nullable=False),
    Column("def_pat_blocks", Integer, nullable=False),
    Column("def_fg_blocks", Integer, nullable=False),
    Column("special_teams_tds", Integer, nullable=False),
    Column("passing_yards_allowed", Integer, nullable=False),
    Column("rushing_yards_allowed", Integer, nullable=False),
    Column("source", Text, nullable=False, server_default=text("'nflverse_team_defense_weeks'::text")),
    Column("ingested_at", DateTime(True), nullable=False, server_default=text("now()")),
    Column("points_allowed", Integer),
    Column("sack_yards_lost_allowed", Integer),
    PrimaryKeyConstraint("season", "week", "team", name="nflverse_team_defense_weeks_season_week_team_pk"),
    Index("nflverse_team_defense_weeks_team_season_idx", "team", "season", "week"),
)

PLAYER_PROP_OBSERVATIONS = Table(
    "player_prop_observations",
    METADATA,
    Column("id", BigInteger, primary_key=True, autoincrement=True),
    Column("event_id", Text, nullable=False),
    Column("commence_time", DateTime(True), nullable=False),
    Column("bookmaker", Text, nullable=False),
    Column("market", Text, nullable=False),
    Column("player_name", Text, nullable=False),
    Column("point", Double(53), nullable=False),
    Column("over_price", Integer, nullable=False),
    Column("under_price", Integer, nullable=False),
    Column("fetched_at", DateTime(True), nullable=False),
    PrimaryKeyConstraint("id", name="player_prop_observations_pkey"),
    Index("player_prop_observations_event_market_idx", "event_id", "market"),
    Index("player_prop_observations_fetched_at_idx", "fetched_at"),
)

PLAYERS = Table(
    "players",
    METADATA,
    Column("id", Text, primary_key=True),
    Column("name", Text, nullable=False),
    Column("position", PLAYER_POSITION, nullable=False),
    Column("nfl_team", Text, nullable=False),
    Column("adp", REAL),
    Column("headshot_url", Text),
    Column("pos_adp", Text),
    PrimaryKeyConstraint("id", name="players_pkey"),
    Index("players_position_idx", "position"),
)

STAT_WEEKS = Table(
    "stat_weeks",
    METADATA,
    Column("week", Integer, primary_key=True, autoincrement=False),
    Column("status", WEEK_STATUS, nullable=False, server_default=text("'scheduled'::week_status")),
    Column("version", Integer, nullable=False, server_default=text("0")),
    Column("games_total", Integer, nullable=False, server_default=text("0")),
    Column("games_final", Integer, nullable=False, server_default=text("0")),
    Column("updated_at", DateTime(True), nullable=False, server_default=text("now()")),
    PrimaryKeyConstraint("week", name="stat_weeks_pkey"),
)

TEAM_WEEK_OBSERVATIONS = Table(
    "team_week_observations",
    METADATA,
    Column("id", BigInteger, primary_key=True, autoincrement=True),
    Column("season", Integer, nullable=False),
    Column("week", Integer, nullable=False),
    Column("team", Text, nullable=False),
    Column("source", Text, nullable=False),
    Column("metric", Text, nullable=False),
    Column("value", Double(53), nullable=False),
    Column("as_of", DateTime(True), nullable=False),
    Column("ingested_at", DateTime(True), nullable=False, server_default=text("now()")),
    PrimaryKeyConstraint("id", name="team_week_observations_pkey"),
    Index("team_week_observations_as_of_idx", "season", "week", "as_of"),
    Index("team_week_observations_fact_idx", "season", "week", "team", "source", "metric", "as_of", unique=True),
)

ADP_SNAPSHOTS = Table(
    "adp_snapshots",
    METADATA,
    Column("id", BigInteger, primary_key=True, autoincrement=True),
    Column("player_id", Text, nullable=False),
    Column("source", Text, nullable=False),
    Column("format", Text, nullable=False),
    Column("adp", REAL, nullable=False),
    Column("captured_at", DateTime(True), nullable=False, server_default=text("now()")),
    ForeignKeyConstraint(
        ["player_id"], ["nfl_players.id"], ondelete="CASCADE", name="adp_snapshots_player_id_nfl_players_id_fk"
    ),
    PrimaryKeyConstraint("id", name="adp_snapshots_pkey"),
    Index("adp_snapshots_player_idx", "player_id", "captured_at"),
    Index("adp_snapshots_player_source_captured_idx", "player_id", "source", "captured_at", unique=True),
)

NFL_DRAFT_PICKS = Table(
    "nfl_draft_picks",
    METADATA,
    Column("id", BigInteger, primary_key=True, autoincrement=True),
    Column("season", Integer, nullable=False),
    Column("round", Integer, nullable=False),
    Column("pick", Integer, nullable=False),
    Column("player_id", Text, nullable=False),
    Column("position", Text, nullable=False),
    Column("team", Text, nullable=False),
    Column("as_of", DateTime(True), nullable=False),
    Column("ingested_at", DateTime(True), nullable=False, server_default=text("now()")),
    ForeignKeyConstraint(
        ["player_id"], ["nfl_players.id"], ondelete="CASCADE", name="nfl_draft_picks_player_id_nfl_players_id_fk"
    ),
    PrimaryKeyConstraint("id", name="nfl_draft_picks_pkey"),
    Index("nfl_draft_picks_fact_idx", "season", "pick", unique=True),
    Index("nfl_draft_picks_player_idx", "player_id"),
)

NFLVERSE_INJURIES = Table(
    "nflverse_injuries",
    METADATA,
    Column("season", Integer, primary_key=True),
    Column("week", Integer, primary_key=True),
    Column("player_id", Text, primary_key=True),
    Column("report_status", Text, nullable=False),
    Column("primary_injury", Text, nullable=False),
    Column("practice_status", Text, nullable=False),
    Column("date_modified", DateTime(True)),
    Column("source", Text, nullable=False, server_default=text("'nflverse_injuries'::text")),
    Column("ingested_at", DateTime(True), nullable=False, server_default=text("now()")),
    ForeignKeyConstraint(
        ["player_id"], ["nfl_players.id"], ondelete="CASCADE", name="nflverse_injuries_player_id_nfl_players_id_fk"
    ),
    PrimaryKeyConstraint("season", "week", "player_id", name="nflverse_injuries_season_week_player_id_pk"),
    Index("nflverse_injuries_player_season_idx", "player_id", "season", "week"),
)

NFLVERSE_KICKING_WEEKS = Table(
    "nflverse_kicking_weeks",
    METADATA,
    Column("season", Integer, primary_key=True),
    Column("week", Integer, primary_key=True),
    Column("player_id", Text, primary_key=True),
    Column("team", Text, nullable=False),
    Column("fg_made", Integer, nullable=False),
    Column("fg_att", Integer, nullable=False),
    Column("fg_missed", Integer, nullable=False),
    Column("fg_blocked", Integer, nullable=False),
    Column("fg_made_0_19", Integer, nullable=False),
    Column("fg_made_20_29", Integer, nullable=False),
    Column("fg_made_30_39", Integer, nullable=False),
    Column("fg_made_40_49", Integer, nullable=False),
    Column("fg_made_50_59", Integer, nullable=False),
    Column("fg_made_60", Integer, nullable=False),
    Column("fg_missed_0_19", Integer, nullable=False),
    Column("fg_missed_20_29", Integer, nullable=False),
    Column("fg_missed_30_39", Integer, nullable=False),
    Column("fg_missed_40_49", Integer, nullable=False),
    Column("fg_missed_50_59", Integer, nullable=False),
    Column("fg_missed_60", Integer, nullable=False),
    Column("pat_made", Integer, nullable=False),
    Column("pat_att", Integer, nullable=False),
    Column("pat_missed", Integer, nullable=False),
    Column("pat_blocked", Integer, nullable=False),
    Column("source", Text, nullable=False, server_default=text("'nflverse_kicking_weeks'::text")),
    Column("ingested_at", DateTime(True), nullable=False, server_default=text("now()")),
    ForeignKeyConstraint(
        ["player_id"], ["nfl_players.id"], ondelete="CASCADE", name="nflverse_kicking_weeks_player_id_nfl_players_id_fk"
    ),
    PrimaryKeyConstraint("season", "week", "player_id", name="nflverse_kicking_weeks_season_week_player_id_pk"),
    Index("nflverse_kicking_weeks_player_season_idx", "player_id", "season", "week"),
    Index("nflverse_kicking_weeks_team_season_idx", "team", "season", "week"),
)

NFLVERSE_ROSTER_WEEKS = Table(
    "nflverse_roster_weeks",
    METADATA,
    Column("season", Integer, primary_key=True),
    Column("week", Integer, primary_key=True),
    Column("player_id", Text, primary_key=True),
    Column("team", Text, nullable=False),
    Column("status", Text, nullable=False),
    Column("position", Text, nullable=False),
    Column("source", Text, nullable=False, server_default=text("'nflverse_roster_weeks'::text")),
    Column("ingested_at", DateTime(True), nullable=False, server_default=text("now()")),
    Column("status_detail", Text, nullable=False, server_default=text("''::text")),
    ForeignKeyConstraint(
        ["player_id"], ["nfl_players.id"], ondelete="CASCADE", name="nflverse_roster_weeks_player_id_nfl_players_id_fk"
    ),
    PrimaryKeyConstraint("season", "week", "player_id", name="nflverse_roster_weeks_season_week_player_id_pk"),
    Index("nflverse_roster_weeks_player_season_idx", "player_id", "season", "week"),
)

PLAYER_CAPSULES = Table(
    "player_capsules",
    METADATA,
    Column("player_id", Text, primary_key=True),
    Column("facts_hash", Text, nullable=False),
    Column("body_compact", Text, nullable=False),
    Column("body_full", Text, nullable=False),
    Column("source", CAPSULE_SOURCE, nullable=False),
    Column("model", Text),
    Column("generated_at", DateTime(True), nullable=False, server_default=text("now()")),
    Column("narrative", JSONB),
    ForeignKeyConstraint(
        ["player_id"], ["players.id"], ondelete="CASCADE", name="player_capsules_player_id_players_id_fk"
    ),
    PrimaryKeyConstraint("player_id", name="player_capsules_pkey"),
)

PLAYER_CROSSWALK = Table(
    "player_crosswalk",
    METADATA,
    Column("player_id", Text, primary_key=True),
    Column("nfl_player_id", Text),
    Column("method", Text),
    Column("unmatched_reason", Text),
    Column("resolved_at", DateTime(True), nullable=False),
    CheckConstraint(
        "nfl_player_id IS NOT NULL AND method IS NOT NULL AND unmatched_reason IS NULL"
        " OR nfl_player_id IS NULL AND method IS NULL AND unmatched_reason IS NOT NULL",
        name="player_crosswalk_matched_ck",
    ),
    ForeignKeyConstraint(
        ["nfl_player_id"],
        ["nfl_players.id"],
        ondelete="RESTRICT",
        name="player_crosswalk_nfl_player_id_nfl_players_id_fk",
    ),
    ForeignKeyConstraint(
        ["player_id"], ["players.id"], ondelete="CASCADE", name="player_crosswalk_player_id_players_id_fk"
    ),
    PrimaryKeyConstraint("player_id", name="player_crosswalk_pkey"),
    Index("player_crosswalk_nfl_player_idx", "nfl_player_id", unique=True),
)

PLAYER_PEEK_DOCUMENTS = Table(
    "player_peek_documents",
    METADATA,
    Column("player_id", Text, nullable=False),
    Column("season", Integer, nullable=False),
    Column("scoring_hash", Text, nullable=False),
    Column("document", JSONB, nullable=False),
    Column("basis", JSONB, nullable=False),
    Column("as_of", DateTime(True), nullable=False),
    Column("computed_at", DateTime(True), nullable=False, server_default=text("now()")),
    Column("source", Text, nullable=False),
    ForeignKeyConstraint(
        ["player_id"], ["players.id"], ondelete="CASCADE", name="player_peek_documents_player_id_players_id_fk"
    ),
    Index("player_peek_documents_document_idx", "season", "scoring_hash", "player_id", "as_of", unique=True),
)

PLAYER_PEEK_FACTS = Table(
    "player_peek_facts",
    METADATA,
    Column("player_id", Text, nullable=False),
    Column("season", Integer, nullable=False),
    Column("dossier", JSONB, nullable=False),
    Column("touches_rank", Integer),
    Column("touches_qualifier_count", Integer),
    Column("prior_seasons_held", ARRAY(Integer()), nullable=False),
    Column("last_season_line", JSONB),
    Column("basis", JSONB, nullable=False),
    Column("as_of", DateTime(True), nullable=False),
    Column("computed_at", DateTime(True), nullable=False, server_default=text("now()")),
    Column("source", Text, nullable=False),
    ForeignKeyConstraint(
        ["player_id"], ["players.id"], ondelete="CASCADE", name="player_peek_facts_player_id_players_id_fk"
    ),
    Index("player_peek_facts_fact_idx", "player_id", "season", "as_of", unique=True),
)

PLAYER_STAT_LINES = Table(
    "player_stat_lines",
    METADATA,
    Column("player_id", Text, primary_key=True),
    Column("week", Integer, primary_key=True),
    Column("passing_yards", Integer, nullable=False, server_default=text("0")),
    Column("passing_touchdowns", Integer, nullable=False, server_default=text("0")),
    Column("interceptions", Integer, nullable=False, server_default=text("0")),
    Column("rushing_yards", Integer, nullable=False, server_default=text("0")),
    Column("rushing_touchdowns", Integer, nullable=False, server_default=text("0")),
    Column("receiving_yards", Integer, nullable=False, server_default=text("0")),
    Column("receiving_touchdowns", Integer, nullable=False, server_default=text("0")),
    Column("receptions", Integer, nullable=False, server_default=text("0")),
    Column("fumbles_lost", Integer, nullable=False, server_default=text("0")),
    Column("field_goals_made", Integer, nullable=False, server_default=text("0")),
    Column("extra_points_made", Integer, nullable=False, server_default=text("0")),
    Column("sacks", REAL, nullable=False, server_default=text("0")),
    Column("defensive_interceptions", Integer, nullable=False, server_default=text("0")),
    Column("defensive_touchdowns", Integer, nullable=False, server_default=text("0")),
    Column("targets", Integer, nullable=False, server_default=text("0")),
    Column("carries", Integer, nullable=False, server_default=text("0")),
    Column("pass_attempts", Integer, nullable=False, server_default=text("0")),
    Column("pass_completions", Integer, nullable=False, server_default=text("0")),
    Column("field_goals_attempted", Integer, nullable=False, server_default=text("0")),
    Column("points_allowed", Integer, nullable=False, server_default=text("0")),
    Column("offensive_snaps", Integer, nullable=False, server_default=text("0")),
    Column("offensive_snap_share", REAL, nullable=False, server_default=text("0")),
    Column("two_point_conversions", Integer, nullable=False, server_default=text("0")),
    Column("field_goals_missed", Integer, nullable=False, server_default=text("0")),
    Column("extra_points_missed", Integer, nullable=False, server_default=text("0")),
    Column("kick_return_touchdowns", Integer, nullable=False, server_default=text("0")),
    Column("punt_return_touchdowns", Integer, nullable=False, server_default=text("0")),
    Column("yards_allowed", Integer, nullable=False, server_default=text("0")),
    Column("defensive_fumbles_recovered", Integer, nullable=False, server_default=text("0")),
    Column("safeties", Integer, nullable=False, server_default=text("0")),
    ForeignKeyConstraint(
        ["player_id"], ["players.id"], ondelete="CASCADE", name="player_stat_lines_player_id_players_id_fk"
    ),
    PrimaryKeyConstraint("player_id", "week", name="player_stat_lines_player_id_week_pk"),
    Index("player_stat_lines_week_idx", "week"),
)

PLAYER_WEEK_OBSERVATIONS = Table(
    "player_week_observations",
    METADATA,
    Column("id", BigInteger, primary_key=True, autoincrement=True),
    Column("season", Integer, nullable=False),
    Column("week", Integer, nullable=False),
    Column("player_id", Text, nullable=False),
    Column("source", Text, nullable=False),
    Column("metric", Text, nullable=False),
    Column("value", Double(53), nullable=False),
    Column("as_of", DateTime(True), nullable=False),
    Column("ingested_at", DateTime(True), nullable=False, server_default=text("now()")),
    ForeignKeyConstraint(
        ["player_id"],
        ["nfl_players.id"],
        ondelete="CASCADE",
        name="player_week_observations_player_id_nfl_players_id_fk",
    ),
    PrimaryKeyConstraint("id", name="player_week_observations_pkey"),
    Index("player_week_observations_as_of_idx", "season", "week", "as_of"),
    Index("player_week_observations_fact_idx", "season", "week", "player_id", "source", "metric", "as_of", unique=True),
)

PLAYER_WEEK_TEAMS = Table(
    "player_week_teams",
    METADATA,
    Column("id", BigInteger, primary_key=True, autoincrement=True),
    Column("season", Integer, nullable=False),
    Column("week", Integer, nullable=False),
    Column("player_id", Text, nullable=False),
    Column("team", Text, nullable=False),
    Column("as_of", DateTime(True), nullable=False),
    Column("ingested_at", DateTime(True), nullable=False, server_default=text("now()")),
    ForeignKeyConstraint(
        ["player_id"], ["nfl_players.id"], ondelete="CASCADE", name="player_week_teams_player_id_nfl_players_id_fk"
    ),
    PrimaryKeyConstraint("id", name="player_week_teams_pkey"),
    Index("player_week_teams_as_of_idx", "season", "week", "as_of"),
    Index("player_week_teams_fact_idx", "season", "week", "player_id", "team", "as_of", unique=True),
)

PRESEASON_BOARD_REASONS = Table(
    "preseason_board_reasons",
    METADATA,
    Column("source", Text, primary_key=True),
    Column("season", Integer, primary_key=True),
    Column("player_id", Text, primary_key=True),
    Column("code", Text, primary_key=True),
    Column("payload", JSONB, nullable=False),
    Column("detail", Text, primary_key=True, server_default=text("''::text")),
    ForeignKeyConstraint(
        ["player_id"],
        ["nfl_players.id"],
        ondelete="CASCADE",
        name="preseason_board_reasons_player_id_nfl_players_id_fk",
    ),
    PrimaryKeyConstraint(
        "source",
        "season",
        "player_id",
        "code",
        "detail",
        name="preseason_board_reasons_source_season_player_id_code_detail_pk",
    ),
)

PRESEASON_PROJECTIONS = Table(
    "preseason_projections",
    METADATA,
    Column("id", BigInteger, primary_key=True, autoincrement=True),
    Column("season", Integer, nullable=False),
    Column("source", Text, nullable=False),
    Column("player_id", Text, nullable=False),
    Column("rank", Integer, nullable=False),
    Column("position_rank", Integer, nullable=False),
    Column("projected_points", Double(53), nullable=False),
    Column("value_over_replacement", Double(53), nullable=False),
    Column("value_rank", Integer, nullable=False),
    Column("expected_games", Double(53), nullable=False),
    Column("floor_points", Double(53), nullable=False),
    Column("median_points", Double(53), nullable=False),
    Column("ceiling_points", Double(53), nullable=False),
    Column("tier", Integer, nullable=False),
    Column("as_of", DateTime(True), nullable=False),
    Column("computed_at", DateTime(True), nullable=False, server_default=text("now()")),
    Column("moment_kind", BOARD_MOMENT_KIND, nullable=False, server_default=text("'replay'::board_moment_kind")),
    ForeignKeyConstraint(
        ["player_id"], ["nfl_players.id"], ondelete="CASCADE", name="preseason_projections_player_id_nfl_players_id_fk"
    ),
    PrimaryKeyConstraint("id", name="preseason_projections_pkey"),
    Index("preseason_projections_as_of_idx", "season", "source", "as_of"),
    Index("preseason_projections_fact_idx", "season", "source", "player_id", "as_of", unique=True),
)

PRESEASON_RANKINGS = Table(
    "preseason_rankings",
    METADATA,
    Column("id", BigInteger, primary_key=True, autoincrement=True),
    Column("season", Integer, nullable=False),
    Column("source", Text, nullable=False),
    Column("player_id", Text, nullable=False),
    Column("rank", Double(53), nullable=False),
    Column("as_of", DateTime(True), nullable=False),
    Column("ingested_at", DateTime(True), nullable=False, server_default=text("now()")),
    ForeignKeyConstraint(
        ["player_id"], ["nfl_players.id"], ondelete="CASCADE", name="preseason_rankings_player_id_nfl_players_id_fk"
    ),
    PrimaryKeyConstraint("id", name="preseason_rankings_pkey"),
    Index("preseason_rankings_as_of_idx", "season", "source", "as_of"),
    Index("preseason_rankings_fact_idx", "season", "source", "player_id", "as_of", unique=True),
)

PRESEASON_ROSTERS = Table(
    "preseason_rosters",
    METADATA,
    Column("id", BigInteger, primary_key=True, autoincrement=True),
    Column("season", Integer, nullable=False),
    Column("team", Text, nullable=False),
    Column("player_id", Text, nullable=False),
    Column("position", Text, nullable=False),
    Column("status", Text, nullable=False),
    Column("birth_date", Text),
    Column("draft_year", Integer),
    Column("draft_pick", Integer),
    Column("draft_club", Text),
    Column("as_of", DateTime(True), nullable=False),
    Column("ingested_at", DateTime(True), nullable=False, server_default=text("now()")),
    ForeignKeyConstraint(
        ["player_id"], ["nfl_players.id"], ondelete="CASCADE", name="preseason_rosters_player_id_nfl_players_id_fk"
    ),
    PrimaryKeyConstraint("id", name="preseason_rosters_pkey"),
    Index("preseason_rosters_as_of_idx", "season", "as_of"),
    Index("preseason_rosters_fact_idx", "season", "player_id", "as_of", unique=True),
)

PROPS_PLAYER_MAP = Table(
    "props_player_map",
    METADATA,
    Column("id", BigInteger, primary_key=True, autoincrement=True),
    Column("prop_name", Text, nullable=False),
    Column("season", Integer, nullable=False),
    Column("player_id", Text, nullable=False),
    Column("method", Text, nullable=False),
    Column("created_at", DateTime(True), nullable=False, server_default=text("now()")),
    ForeignKeyConstraint(
        ["player_id"], ["nfl_players.id"], ondelete="RESTRICT", name="props_player_map_player_id_nfl_players_id_fk"
    ),
    PrimaryKeyConstraint("id", name="props_player_map_pkey"),
    Index("props_player_map_name_season_idx", "prop_name", "season", unique=True),
)

REGISTER_FREEZE_ROWS = Table(
    "register_freeze_rows",
    METADATA,
    Column("id", BigInteger, primary_key=True, autoincrement=True),
    Column("season", Integer, nullable=False),
    Column("week", Integer, nullable=False),
    Column("frozen_at", DateTime(True), nullable=False),
    Column("player_id", Text, nullable=False),
    Column("board_source", Text, nullable=False),
    Column("board_as_of", DateTime(True), nullable=False),
    Column("board_points", Double(53), nullable=False),
    Column("board_rank", Integer, nullable=False),
    Column("board_value_rank", Integer, nullable=False),
    Column("adp_rank", Double(53)),
    Column("ecr_rank", Double(53)),
    Column("props_points", Double(53)),
    Column("props_markets", JSONB),
    # Revision 0002: which implementation froze the row. See that revision's docblock.
    Column("implementation", Text, server_default=text("'typescript'::text")),
    ForeignKeyConstraint(
        ["player_id"], ["nfl_players.id"], ondelete="RESTRICT", name="register_freeze_rows_player_id_nfl_players_id_fk"
    ),
    PrimaryKeyConstraint("id", name="register_freeze_rows_pkey"),
    Index("register_freeze_rows_fact_idx", "season", "week", "frozen_at", "board_source", "player_id", unique=True),
    Index("register_freeze_rows_week_idx", "season", "week", "frozen_at"),
)

REGISTER_GRADE_ROWS = Table(
    "register_grade_rows",
    METADATA,
    Column("id", BigInteger, primary_key=True, autoincrement=True),
    Column("season", Integer, nullable=False),
    Column("week", Integer, nullable=False),
    Column("frozen_at", DateTime(True), nullable=False),
    Column("graded_at", DateTime(True), nullable=False),
    Column("player_id", Text, nullable=False),
    Column("actual_points", Double(53), nullable=False),
    Column("actual_rank", Integer, nullable=False),
    Column("board_rank", Integer, nullable=False),
    Column("adp_rank", Integer),
    Column("ecr_rank", Integer),
    Column("props_rank", Integer),
    Column("board_source", Text, nullable=False),
    ForeignKeyConstraint(
        ["player_id"], ["nfl_players.id"], ondelete="RESTRICT", name="register_grade_rows_player_id_nfl_players_id_fk"
    ),
    PrimaryKeyConstraint("id", name="register_grade_rows_pkey"),
    Index(
        "register_grade_rows_fact_idx",
        "season",
        "week",
        "frozen_at",
        "graded_at",
        "board_source",
        "player_id",
        unique=True,
    ),
    Index("register_grade_rows_season_idx", "season", "week", "graded_at"),
)
