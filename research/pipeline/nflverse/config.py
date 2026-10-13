"""Every tunable the nflverse adapter has (`src/projections/nflverse/config.ts`).

nflverse is a community project with no SLA, which is why its output is ingested into our own
point-in-time store and never read at request time by a product surface.
"""

from typing import Final

NFLVERSE_BASE_URL: Final = "https://github.com/nflverse/nflverse-data/releases/download/"


class Releases:
    """Release tags, `.../releases/download/<release>/<file>`."""

    SNAP_COUNTS: Final = "snap_counts"
    PLAYER_WEEK: Final = "player_stats"
    PLAYERS: Final = "players"
    INJURIES: Final = "injuries"
    WEEKLY_ROSTERS: Final = "weekly_rosters"
    DEPTH_CHARTS: Final = "depth_charts"
    DRAFT_PICKS: Final = "draft_picks"
    STATS_PLAYER: Final = "stats_player"
    STATS_TEAM: Final = "stats_team"
    PBP: Final = "pbp"


class Files:
    """Asset names covering the whole history; per-season assets carry the season in the name."""

    PLAYERS: Final = "players.csv"
    DRAFT_PICKS: Final = "draft_picks.csv"


# How long after a game its numbers become knowable, for the `as_of` stamp. A deliberate
# over-estimate: a late stamp costs a replay accuracy, an early one leaks the future.
PUBLICATION_LAG_HOURS: Final = 24

# Only the regular season is scored.
SEASON_TYPE: Final = "REG"
