"""THE COLOR FACTS: last season's story, his usage and its trend.

Ported from `research-ts/src/capsules/collect.ts` (`lastSeasonStoriesFor`,
`usageTouchesAndTrendFactsFor`), each read once for the whole board. This season so far is the
page's own season block (`facts.season_so_far`), no longer the provider's lines.
Ranks are taken among the position's peers with a real reading of the same quantity; a share the
store has no evidence for is None, never a zero.
"""

from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Final

from sqlalchemy import Connection

from research.capsules.facts.depth_reads import names_for
from research.capsules.facts.model import (
    LastSeasonStory,
    RankedStat,
    Trend,
    TrendMetric,
    Usage,
    WeekPoints,
)
from research.capsules.facts.rank import RankableStat, build_trend_metric, rank_within_groups
from research.model.domain import (
    PPR_SCORING,
    Position,
    compute_fantasy_points,
    round_points,
)
from research.model.jsmath import js_round
from research.model.laws.discovery_facts import DiscoveryFacts, DiscoveryQuantityValues, discovery_facts_for_season
from research.model.laws.tribal import is_skill_position
from research.model.market.props_anchor import median
from research.model.reads.observations import (
    LAST_POSSIBLE_WEEK,
    LIVE_ADMITTED_DERIVED_SEASONS,
    STAT_LINE_SOURCE,
    ObservationQuery,
    WeekRange,
    observations_as_of,
    stat_lines_for_live_surface,
)
from research.pipeline.nflverse.participation import ParticipationMetric
from research.pipeline.nflverse.team_eras import final_week_of

_RECEIVERS: Final = frozenset({"WR", "TE"})
_STORY_FIELDS: Final = ("points_rank", "points_per_game", "games_played", "best_week", "weeks_above_median")


@dataclass(frozen=True, slots=True)
class StoryWithoutTouches:
    """`Omit<PlayerFactsLastSeasonStory, "touchesRank">`: the story before the touches rank joins it."""

    season: int
    points_rank: RankedStat
    points_per_game: float
    games_played: int
    best_week: WeekPoints
    weeks_above_median: int
    receiving_yards_rank: RankedStat

    def with_touches(self, touches: RankedStat | None) -> LastSeasonStory:
        return LastSeasonStory(
            self.season,
            self.points_rank,
            self.points_per_game,
            self.games_played,
            self.best_week,
            self.weeks_above_median,
            self.receiving_yards_rank,
            touches,
        )


def last_season_stories_for(
    conn: Connection, season: int, positions: Mapping[str, Position], as_of: datetime
) -> dict[str, StoryWithoutTouches]:
    """`lastSeasonStoriesFor`: his total's finish, his rate, his best week and his steady weeks."""
    skill = [player_id for player_id, position in positions.items() if is_skill_position(position)]
    if not skill:
        return {}
    query = ObservationQuery(season, WeekRange(1, final_week_of(season)), as_of, None, tuple(skill))
    rows = stat_lines_for_live_surface(conn, query)
    names = names_for(conn, skill)
    weeks_by_position: dict[Position, list[float]] = {}
    weeks_by_player: dict[str, list[WeekPoints]] = {}
    receiving: dict[str, float] = {}
    for row in rows:
        position = positions.get(row.line.player_id)
        if position is None:
            continue
        points = compute_fantasy_points(row.line, position, PPR_SCORING)
        weeks_by_position.setdefault(position, []).append(points)
        weeks_by_player.setdefault(row.line.player_id, []).append(WeekPoints(row.line.week, points))
        receiving[row.line.player_id] = receiving.get(row.line.player_id, 0.0) + row.line.receiving_yards
    medians = {position: median(weeks) for position, weeks in weeks_by_position.items()}
    totals: dict[Position, list[tuple[str, float]]] = {}
    for player_id, weeks in weeks_by_player.items():
        total = 0.0
        for week in weeks:
            total += week.points
        totals.setdefault(positions[player_id], []).append((player_id, round_points(total)))

    def ranks(value_of: Callable[[str, float], float]) -> dict[str, RankedStat]:
        groups = {
            position: [RankableStat(pid, names.get(pid, pid), value_of(pid, total)) for pid, total in entries]
            for position, entries in totals.items()
        }
        return rank_within_groups(groups)

    points_ranks = ranks(lambda pid, total: total)
    receiving_ranks = ranks(lambda pid, total: receiving.get(pid, 0.0))
    stories: dict[str, StoryWithoutTouches] = {}
    for position, entries in totals.items():
        for player_id, total in entries:
            weeks = weeks_by_player[player_id]
            best = weeks[0]
            for week in weeks:
                if week.points > best.points:
                    best = week
            above = sum(1 for week in weeks if week.points > medians.get(position, 0.0))
            stories[player_id] = StoryWithoutTouches(
                season,
                points_ranks[player_id],
                round_points(total / len(weeks)),
                len(weeks),
                WeekPoints(best.week, round_points(best.points)),
                above,
                receiving_ranks[player_id],
            )
    return stories


def _ranked_quantity(
    facts: Mapping[str, DiscoveryFacts],
    names: Mapping[str, str],
    select: Callable[[DiscoveryQuantityValues], float | None],
) -> dict[str, RankedStat]:
    by_position: dict[Position, list[RankableStat]] = {}
    for player_id, entry in facts.items():
        value = select(entry.current)
        if value is not None:
            by_position.setdefault(entry.position, []).append(
                RankableStat(player_id, names.get(player_id, player_id), value)
            )
    return rank_within_groups(by_position)


@dataclass(frozen=True, slots=True)
class _YardsAndTargets:
    total_yards: float
    targets: float


def _yards_and_targets(
    conn: Connection, season: int, ids: Sequence[str], as_of: datetime
) -> dict[str, _YardsAndTargets]:
    """`seasonYardsAndTargetsFor`: rushing plus receiving yards, and raw targets, per player."""
    if not ids:
        return {}
    lines = stat_lines_for_live_surface(
        conn, ObservationQuery(season, WeekRange(1, final_week_of(season)), as_of, None, tuple(ids))
    )
    usage = observations_as_of(
        conn, ObservationQuery(season, WeekRange(1, LAST_POSSIBLE_WEEK), as_of, STAT_LINE_SOURCE, tuple(ids))
    )
    yards: dict[str, float] = {}
    for row in lines:
        yards[row.line.player_id] = (
            yards.get(row.line.player_id, 0.0) + row.line.rushing_yards + row.line.receiving_yards
        )
    targets: dict[str, float] = {}
    for obs in usage:
        if obs.metric == ParticipationMetric.TARGETS:
            targets[obs.player_id] = targets.get(obs.player_id, 0.0) + obs.value
    return {pid: _YardsAndTargets(yards.get(pid, 0.0), targets.get(pid, 0.0)) for pid in ids}


def _per_opportunity(position: Position, touches: float | None, yards: _YardsAndTargets | None) -> float | None:
    if yards is None:
        return None
    denominator = yards.targets if position in _RECEIVERS else touches
    return None if denominator is None or denominator <= 0 else js_round((yards.total_yards / denominator) * 10) / 10


def _pooled(
    facts: Mapping[str, DiscoveryFacts], select: Callable[[DiscoveryQuantityValues], float | None]
) -> dict[Position, list[float]]:
    pools: dict[Position, list[float]] = {}
    for entry in facts.values():
        for values in (entry.current, entry.prior):
            value = None if values is None else select(values)
            if value is not None:
                pools.setdefault(entry.position, []).append(value)
    return pools


def _trends(conn: Connection, facts: Mapping[str, DiscoveryFacts], recent: int, as_of: datetime) -> dict[str, Trend]:
    """`trendsFor`: points a game, yards per opportunity and target share, year over year."""
    older = recent - 1
    ids = list(facts)
    recent_yards, older_yards = (
        _yards_and_targets(conn, recent, ids, as_of),
        _yards_and_targets(conn, older, ids, as_of),
    )
    per_opportunity: dict[str, tuple[float | None, float | None]] = {}
    for pid, entry in facts.items():
        now = _per_opportunity(entry.position, entry.current.touches, recent_yards.get(pid))
        then = (
            None if entry.prior is None else _per_opportunity(entry.position, entry.prior.touches, older_yards.get(pid))
        )
        per_opportunity[pid] = (now, then)
    opportunity_pools: dict[Position, list[float]] = {}
    for pid, (now, then) in per_opportunity.items():
        listed = [value for value in (now, then) if value is not None]
        if listed:
            opportunity_pools.setdefault(facts[pid].position, []).extend(listed)
    ppg_pools, share_pools = _pooled(facts, lambda v: v.points_per_game), _pooled(facts, lambda v: v.target_share)
    trends: dict[str, Trend] = {}
    for pid, entry in facts.items():
        if entry.prior is None:
            continue
        p, c, position = entry.prior, entry.current, entry.position
        ppg = build_trend_metric(older, p.points_per_game, recent, c.points_per_game, ppg_pools.get(position, []))
        share = build_trend_metric(older, p.target_share, recent, c.target_share, share_pools.get(position, []))
        now, then = per_opportunity[pid]
        ypo: TrendMetric | None = build_trend_metric(older, then, recent, now, opportunity_pools.get(position, []))
        if ppg is not None or share is not None or ypo is not None:
            trends[pid] = Trend(ppg, ypo, share)
    return trends


@dataclass(frozen=True, slots=True)
class UsageTouchesAndTrend:
    usage: dict[str, Usage]
    touches_rank: dict[str, RankedStat]
    trend: dict[str, Trend]


def usage_touches_and_trend_for(
    conn: Connection, season: int, positions: Mapping[str, Position], as_of: datetime
) -> UsageTouchesAndTrend:
    """`usageTouchesAndTrendFactsFor`: the shares and their ranks, the touches rank, the trend."""
    facts = discovery_facts_for_season(
        conn, season, positions, PPR_SCORING, season in LIVE_ADMITTED_DERIVED_SEASONS, as_of
    )
    names = names_for(conn, list(facts))
    snap = _ranked_quantity(facts, names, lambda v: v.snap_share)
    target = _ranked_quantity(facts, names, lambda v: v.target_share)
    red_zone = _ranked_quantity(facts, names, lambda v: v.red_zone_touch_share)
    touches = _ranked_quantity(facts, names, lambda v: v.touches)
    usage = {
        pid: Usage(
            season,
            entry.current.snap_share,
            snap.get(pid),
            entry.current.target_share,
            target.get(pid),
            entry.current.red_zone_touch_share,
            red_zone.get(pid),
        )
        for pid, entry in facts.items()
    }
    return UsageTouchesAndTrend(usage, touches, _trends(conn, facts, season, as_of))
