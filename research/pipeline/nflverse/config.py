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
    FTN_CHARTING: Final = "ftn_charting"
    NEXTGEN_STATS: Final = "nextgen_stats"
    PFR_ADVSTATS: Final = "pfr_advstats"


class Files:
    """Asset names covering the whole history; per-season assets carry the season in the name."""

    PLAYERS: Final = "players.csv"
    DRAFT_PICKS: Final = "draft_picks.csv"


# How long after a game its numbers become knowable, for the `as_of` stamp. A deliberate
# over-estimate: a late stamp costs a replay accuracy, an early one leaks the future.
PUBLICATION_LAG_HOURS: Final = 24

# FTN Data charts each game "within 48 hours following" it (nflreadr's `load_ftn_charting`), so its
# rows are stamped with that window rather than the box score's day.
FTN_PUBLICATION_LAG_HOURS: Final = 48


# The most a single release asset may send before the read is refused (`NflverseClient.max_bytes`):
# several times each asset's full-season size on 2026-10-14, so a bloated or wrong asset fails loudly
# instead of filling memory or disk. Play-by-play is about 100 MB a season as CSV, 20 MB gzipped.
class ByteCaps:
    PLAY_BY_PLAY: Final = 400_000_000
    FTN_CHARTING: Final = 60_000_000
    NEXTGEN_STATS: Final = 30_000_000
    PFR_ADVSTATS: Final = 20_000_000


# Only the regular season is scored.
SEASON_TYPE: Final = "REG"
