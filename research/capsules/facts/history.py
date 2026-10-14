"""THE FACTS PASS'S HISTORY READS, THROUGH THE READ CACHE (`db.read_cache`).

The board facts pass spends almost all of its transfer on finished seasons: last season's usage,
ranks and trends (two seasons of every player's weekly observations), last season's stories, and
the depth facts' week scores, targets, shares and tallies over the three prior seasons. None of it
moves once those seasons are stored, so the nightly reads it through the cache and moves only the
statements' fingerprints while it is unchanged. Each read here is a pure function of its arguments
and its statements' rows that passes `as_of` to its statements and computes nothing with it, the
condition the cache is sound under.

The single-player read (`collect_one`) and the parity cases read without the cache (`UNCACHED`).
"""

from collections.abc import Mapping, Sequence
from datetime import datetime
from typing import Final

from sqlalchemy import Connection, Engine

from research.capsules.facts import depth_reads as reads
from research.capsules.facts.color import (
    StoryWithoutTouches,
    UsageTouchesAndTrend,
    last_season_stories_for,
    usage_touches_and_trend_for,
)
from research.capsules.facts.depth_context import TeamMetricRow
from research.capsules.facts.depth_role import PlayerWeekShare, ScoringTally, TeamPlayerTargets
from research.capsules.facts.model import RankedStat, Trend, TrendMetric, Usage, WeekPoints
from research.db.read_cache import ReadCache, ReadThrough
from research.db.value_codec import ValueCodec
from research.model.domain import Position
from research.model.reads.observations import WeekRange

HISTORY_CODEC: Final = ValueCodec(
    (
        UsageTouchesAndTrend,
        Usage,
        RankedStat,
        Trend,
        TrendMetric,
        StoryWithoutTouches,
        WeekPoints,
        TeamPlayerTargets,
        ScoringTally,
        PlayerWeekShare,
        TeamMetricRow,
    )
)


def history_cache(engine: Engine, code_version: str) -> ReadCache:
    return ReadCache(engine, HISTORY_CODEC, code_version)


def _pairs(positions: Mapping[str, Position]) -> list[list[str]]:
    return [[player_id, position] for player_id, position in positions.items()]


def usage_and_trend(
    history: ReadThrough, conn: Connection, season: int, positions: Mapping[str, Position], as_of: datetime
) -> UsageTouchesAndTrend:
    return history.through(
        conn,
        f"facts/usage-and-trend/{season}",
        [season, _pairs(positions)],
        as_of,
        lambda: usage_touches_and_trend_for(conn, season, positions, as_of),
    )


def stories(
    history: ReadThrough, conn: Connection, season: int, positions: Mapping[str, Position], as_of: datetime
) -> dict[str, StoryWithoutTouches]:
    return history.through(
        conn,
        f"facts/stories/{season}",
        [season, _pairs(positions)],
        as_of,
        lambda: last_season_stories_for(conn, season, positions, as_of),
    )


def week_scores(
    history: ReadThrough, conn: Connection, season: int, positions: Mapping[str, Position], as_of: datetime
) -> dict[str, list[WeekPoints]]:
    return history.through(
        conn,
        f"facts/week-scores/{season}",
        [season, _pairs(positions)],
        as_of,
        lambda: reads.week_scores_for(conn, season, positions, as_of),
    )


def season_targets(
    history: ReadThrough, conn: Connection, season: int, ids: Sequence[str], as_of: datetime
) -> tuple[dict[str, TeamPlayerTargets], dict[str, str]]:
    return history.through(
        conn,
        f"facts/season-targets/{season}",
        [season, list(ids)],
        as_of,
        lambda: reads.season_targets_for(conn, season, ids, as_of),
    )


def weekly_shares(
    history: ReadThrough, conn: Connection, season: int, ids: Sequence[str], as_of: datetime
) -> dict[str, list[PlayerWeekShare]]:
    return history.through(
        conn,
        f"facts/weekly-shares/{season}",
        [season, list(ids)],
        as_of,
        lambda: reads.weekly_shares_for(conn, season, ids, as_of),
    )


def scoring_tallies(
    history: ReadThrough, conn: Connection, season: int, ids: Sequence[str], as_of: datetime
) -> dict[str, ScoringTally]:
    return history.through(
        conn,
        f"facts/scoring-tallies/{season}",
        [season, list(ids)],
        as_of,
        lambda: reads.scoring_tallies_for(conn, season, ids, as_of),
    )


def team_rows(
    history: ReadThrough, conn: Connection, season: int, window: WeekRange, as_of: datetime
) -> dict[str, list[TeamMetricRow]]:
    return history.through(
        conn,
        f"facts/team-rows/{season}",
        [season, window.first, window.last],
        as_of,
        lambda: reads.team_metric_rows_for(conn, season, window, as_of),
    )
