"""THE RESEARCH SCHEMA, designed for the prep site (2026-10-12), as SQLAlchemy core tables.

Every table lives in the `research` Postgres schema and is defined once here, by group:

    identity      players (the one universe), provider_players, player_crosswalk, props_player_map
    nflverse      the weekly archives, nflverse_games and nflverse_game_reads (revision 0010), game_voids (revision
                  0023), nfl_draft_picks, coaches
    observations  player_week_observations, team_week_observations, player_week_teams
    provider      the Tank01 current-season store, the capture and odds archives, ESPN's weekly projection (revision 0017)
    market        preseason_rosters, preseason_rankings, adp_snapshots
    boards        model_artifacts, the boards and reasons, the register, the weekly register (revision 0011), player_capsules,
                  player_week_reads and player_week_read_runs (revision 0012)
    custom        preseason_candidates (each board's candidate set), custom_boards (revision 0005)
    published     published_boards, the published run's board rows (revision 0006)
    venues        stadiums and nws_grid_points, the game's place and its forecast grid (revision 0010)
    game_history  nflverse_pbp_plays, nflverse_depth_chart_weeks, game_weather (revision 0009)
    images        headshot_copies, our headshot copies per player and season (revision 0022)
    views         club_week_finals, the one "final held" rule (revision 0014, Lane 80)

`alembic/versions/0001_research_schema.py` creates exactly this, and the schema gate checks the
two agree. What changed from the legacy `public` tables, and why, is in the README; the column
by column correspondence the parity harness and the legacy loader both read is `research.db.legacy`.
"""

from research.db.schema._base import METADATA, RESEARCH_SCHEMA
from research.db.schema.boards import (
    MODEL_ARTIFACTS,
    PLAYER_CAPSULES,
    PLAYER_WEEK_READ_RUNS,
    PLAYER_WEEK_READS,
    PRESEASON_BOARD_REASONS,
    PRESEASON_PROJECTIONS,
    REGISTER_FREEZE_ROWS,
    REGISTER_GRADE_ROWS,
    REGISTER_WEEKLY_ROWS,
)
from research.db.schema.custom import CUSTOM_BOARDS, PRESEASON_CANDIDATES
from research.db.schema.game_history import GAME_WEATHER, NFLVERSE_DEPTH_CHART_WEEKS, NFLVERSE_PBP_PLAYS
from research.db.schema.identity import PLAYER_CROSSWALK, PLAYERS, PROPS_PLAYER_MAP, PROVIDER_PLAYERS
from research.db.schema.images import HEADSHOT_COPIES
from research.db.schema.market import ADP_SNAPSHOTS, PRESEASON_RANKINGS, PRESEASON_ROSTERS
from research.db.schema.nflverse import (
    COACHES,
    GAME_VOIDS,
    NFL_DRAFT_PICKS,
    NFLVERSE_GAME_READS,
    NFLVERSE_GAMES,
    NFLVERSE_INJURIES,
    NFLVERSE_KICKING_WEEKS,
    NFLVERSE_ROSTER_WEEKS,
    NFLVERSE_TEAM_DEFENSE_WEEKS,
)
from research.db.schema.observations import PLAYER_WEEK_OBSERVATIONS, PLAYER_WEEK_TEAMS, TEAM_WEEK_OBSERVATIONS
from research.db.schema.provider import (
    CAPTURE_CHECKS,
    CAPTURE_SNAPSHOTS,
    ESPN_KDEF_ARCHIVE_ROWS,
    ESPN_PROJECTION_ROWS,
    PLAYER_PROP_OBSERVATIONS,
    PLAYER_TD_PROP_OBSERVATIONS,
    PROVIDER_GAMES,
    PROVIDER_STAT_LINES,
    PROVIDER_WEEKS,
    TANK01_PROJECTION_ROWS,
)
from research.db.schema.published import PUBLISHED_BOARDS
from research.db.schema.venues import NWS_GRID_POINTS, STADIUMS
from research.db.schema.views import CLUB_WEEK_FINALS

__all__ = [
    "ADP_SNAPSHOTS",
    "CAPTURE_CHECKS",
    "CAPTURE_SNAPSHOTS",
    "CLUB_WEEK_FINALS",
    "COACHES",
    "CUSTOM_BOARDS",
    "ESPN_KDEF_ARCHIVE_ROWS",
    "ESPN_PROJECTION_ROWS",
    "GAME_VOIDS",
    "GAME_WEATHER",
    "HEADSHOT_COPIES",
    "METADATA",
    "MODEL_ARTIFACTS",
    "NFLVERSE_DEPTH_CHART_WEEKS",
    "NFLVERSE_GAMES",
    "NFLVERSE_GAME_READS",
    "NFLVERSE_INJURIES",
    "NFLVERSE_KICKING_WEEKS",
    "NFLVERSE_PBP_PLAYS",
    "NFLVERSE_ROSTER_WEEKS",
    "NFLVERSE_TEAM_DEFENSE_WEEKS",
    "NFL_DRAFT_PICKS",
    "NWS_GRID_POINTS",
    "PLAYERS",
    "PLAYER_CAPSULES",
    "PLAYER_CROSSWALK",
    "PLAYER_PROP_OBSERVATIONS",
    "PLAYER_TD_PROP_OBSERVATIONS",
    "PLAYER_WEEK_OBSERVATIONS",
    "PLAYER_WEEK_READS",
    "PLAYER_WEEK_READ_RUNS",
    "PLAYER_WEEK_TEAMS",
    "PRESEASON_BOARD_REASONS",
    "PRESEASON_CANDIDATES",
    "PRESEASON_PROJECTIONS",
    "PRESEASON_RANKINGS",
    "PRESEASON_ROSTERS",
    "PROPS_PLAYER_MAP",
    "PROVIDER_GAMES",
    "PROVIDER_PLAYERS",
    "PROVIDER_STAT_LINES",
    "PROVIDER_WEEKS",
    "PUBLISHED_BOARDS",
    "REGISTER_FREEZE_ROWS",
    "REGISTER_GRADE_ROWS",
    "REGISTER_WEEKLY_ROWS",
    "RESEARCH_SCHEMA",
    "STADIUMS",
    "TANK01_PROJECTION_ROWS",
    "TEAM_WEEK_OBSERVATIONS",
]
