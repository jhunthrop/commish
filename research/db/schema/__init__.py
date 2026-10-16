"""THE RESEARCH SCHEMA, designed for the prep site (2026-10-12), as SQLAlchemy core tables.

Every table lives in the `research` Postgres schema and is defined once here, by group:

    identity      players (the one universe), provider_players, player_crosswalk, props_player_map
    nflverse      the weekly archives, nfl_draft_picks, coaches
    observations  player_week_observations, team_week_observations, player_week_teams
    provider      the Tank01 current-season store, the capture and odds archives
    market        preseason_rosters, preseason_rankings, adp_snapshots
    boards        model_artifacts, the boards and reasons, the register, player_capsules
    custom        preseason_candidates (each board's candidate set), custom_boards (revision 0005)
    published     published_boards, the published run's board rows (revision 0006)
    game_history  nflverse_pbp_plays, nflverse_depth_chart_weeks, game_weather (revision 0008)

`alembic/versions/0001_research_schema.py` creates exactly this, and the schema gate checks the
two agree. What changed from the legacy `public` tables, and why, is in the README; the column
by column correspondence the parity harness and the legacy loader both read is `research.db.legacy`.
"""

from research.db.schema._base import METADATA, RESEARCH_SCHEMA
from research.db.schema.boards import (
    MODEL_ARTIFACTS,
    PLAYER_CAPSULES,
    PRESEASON_BOARD_REASONS,
    PRESEASON_PROJECTIONS,
    REGISTER_FREEZE_ROWS,
    REGISTER_GRADE_ROWS,
)
from research.db.schema.custom import CUSTOM_BOARDS, PRESEASON_CANDIDATES
from research.db.schema.game_history import GAME_WEATHER, NFLVERSE_DEPTH_CHART_WEEKS, NFLVERSE_PBP_PLAYS
from research.db.schema.identity import PLAYER_CROSSWALK, PLAYERS, PROPS_PLAYER_MAP, PROVIDER_PLAYERS
from research.db.schema.market import ADP_SNAPSHOTS, PRESEASON_RANKINGS, PRESEASON_ROSTERS
from research.db.schema.nflverse import (
    COACHES,
    NFL_DRAFT_PICKS,
    NFLVERSE_INJURIES,
    NFLVERSE_KICKING_WEEKS,
    NFLVERSE_ROSTER_WEEKS,
    NFLVERSE_TEAM_DEFENSE_WEEKS,
)
from research.db.schema.observations import PLAYER_WEEK_OBSERVATIONS, PLAYER_WEEK_TEAMS, TEAM_WEEK_OBSERVATIONS
from research.db.schema.provider import (
    CAPTURE_SNAPSHOTS,
    PLAYER_PROP_OBSERVATIONS,
    PLAYER_TD_PROP_OBSERVATIONS,
    PROVIDER_GAMES,
    PROVIDER_STAT_LINES,
    PROVIDER_WEEKS,
    TANK01_PROJECTION_ROWS,
)
from research.db.schema.published import PUBLISHED_BOARDS

__all__ = [
    "ADP_SNAPSHOTS",
    "CAPTURE_SNAPSHOTS",
    "COACHES",
    "CUSTOM_BOARDS",
    "GAME_WEATHER",
    "METADATA",
    "MODEL_ARTIFACTS",
    "NFLVERSE_DEPTH_CHART_WEEKS",
    "NFLVERSE_INJURIES",
    "NFLVERSE_KICKING_WEEKS",
    "NFLVERSE_PBP_PLAYS",
    "NFLVERSE_ROSTER_WEEKS",
    "NFLVERSE_TEAM_DEFENSE_WEEKS",
    "NFL_DRAFT_PICKS",
    "PLAYERS",
    "PLAYER_CAPSULES",
    "PLAYER_CROSSWALK",
    "PLAYER_PROP_OBSERVATIONS",
    "PLAYER_TD_PROP_OBSERVATIONS",
    "PLAYER_WEEK_OBSERVATIONS",
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
    "RESEARCH_SCHEMA",
    "TANK01_PROJECTION_ROWS",
    "TEAM_WEEK_OBSERVATIONS",
]
