"""THE FACTS PASS'S HISTORY READS, THROUGH THE READ CACHE (`db.read_cache`).

The board facts pass spends almost all of its transfer on finished seasons: last season's usage,
ranks and trends (two seasons of every player's weekly observations), last season's stories, and
the depth facts' week scores, targets, shares and tallies over the three prior seasons. None of it
moves once those seasons are stored, so the nightly reads it through the cache and moves only the
statements' fingerprints while it is unchanged. Each read here is a pure function of its arguments
and its statements' rows that passes `as_of` to its statements and computes nothing with it, the
condition the cache is sound under.

The single-player read (`collect_one`) and the parity cases read without the cache (`UNCACHED`).

THE POPULATION EACH READ IS KEYED ON. A cached read's key is its arguments, and the pass's population
(the board and every active peer) moves whenever a player debuts this season, which would miss every
history read about weekly (review MEDIUM-2). Each read here is given only the players who have a row
in the finished seasons it reads (`players_with_history`): its result is about those players alone
(a player with no row in those seasons adds no row, no rank and no pool entry to any of them), so
the narrower population gives the same result and moves only when a player with a finished-season
row joins or leaves. The parity cases hold the sheets to their recording with this in place.
"""

from collections.abc import Mapping, Sequence
from datetime import datetime
from typing import Final

from sqlalchemy import Connection, Engine, text

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


def players_with_history(conn: Connection, seasons: Sequence[int]) -> frozenset[str]:
    """Every player with an observation in any of `seasons`."""
    rows = conn.execute(
        text("select distinct player_id from research.player_week_observations where season = any(:seasons)"),
        {"seasons": list(seasons)},
    )
    return frozenset(str(row.player_id) for row in rows)


def _with_rows(positions: Mapping[str, Position], played: frozenset[str]) -> dict[str, Position]:
    return {player_id: position for player_id, position in positions.items() if player_id in played}


def _pairs(positions: Mapping[str, Position]) -> list[list[str]]:
    return [[player_id, position] for player_id, position in positions.items()]


def usage_and_trend(  # noqa: PLR0913, PLR0917 - the read's arguments and its population
    history: ReadThrough,
    conn: Connection,
    season: int,
    positions: Mapping[str, Position],
    played: frozenset[str],
    as_of: datetime,
) -> UsageTouchesAndTrend:
    positions = _with_rows(positions, played)
    return history.through(
        conn,
        f"facts/usage-and-trend/{season}",
        [season, _pairs(positions)],
        as_of,
        lambda: usage_touches_and_trend_for(conn, season, positions, as_of),
    )


def stories(  # noqa: PLR0913, PLR0917 - the read's arguments and its population
    history: ReadThrough,
    conn: Connection,
    season: int,
    positions: Mapping[str, Position],
    played: frozenset[str],
    as_of: datetime,
) -> dict[str, StoryWithoutTouches]:
    positions = _with_rows(positions, played)
    return history.through(
        conn,
        f"facts/stories/{season}",
        [season, _pairs(positions)],
        as_of,
        lambda: last_season_stories_for(conn, season, positions, as_of),
    )


def week_scores(  # noqa: PLR0913, PLR0917 - the read's arguments and its population
    history: ReadThrough,
    conn: Connection,
    season: int,
    positions: Mapping[str, Position],
    played: frozenset[str],
    as_of: datetime,
) -> dict[str, list[WeekPoints]]:
    positions = _with_rows(positions, played)
    return history.through(
        conn,
        f"facts/week-scores/{season}",
        [season, _pairs(positions)],
        as_of,
        lambda: reads.week_scores_for(conn, season, positions, as_of),
    )


def season_targets(  # noqa: PLR0913, PLR0917 - the read's arguments and its population
    history: ReadThrough,
    conn: Connection,
    season: int,
    ids: Sequence[str],
    played: frozenset[str],
    as_of: datetime,
) -> tuple[dict[str, TeamPlayerTargets], dict[str, str]]:
    ids = [player_id for player_id in ids if player_id in played]
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


def scoring_tallies(  # noqa: PLR0913, PLR0917 - the read's arguments and its population
    history: ReadThrough,
    conn: Connection,
    season: int,
    ids: Sequence[str],
    played: frozenset[str],
    as_of: datetime,
) -> dict[str, ScoringTally]:
    ids = [player_id for player_id in ids if player_id in played]
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
