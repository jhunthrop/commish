"""HIS ROLE AND HIS ROOM: the depth chart, how the role moved, who else eats, the scoring-range
usage, and the career arc.

Ported from `research-ts/src/capsules/facts/{depth-chart,role,scoring-usage,career}.ts`, each a
pure function of rows the depth pass read once for the whole board.
"""

from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Final

from research.capsules.facts.depth_model import (
    DepthChart,
    DepthChartNeighbor,
    PriorSeason,
    RoleTrend,
    ScoringUsage,
    SplitShare,
    TargetCompetition,
    TargetLeader,
    Volatility,
)
from research.capsules.facts.model import RankedStat, WeekPoints
from research.capsules.facts.rank import RankableStat, rank_within_groups
from research.model.decide.slots import id_key
from research.model.domain import Position
from research.model.instants import js_iso
from research.model.jsmath import js_round

_MAX_NEIGHBORS: Final = 4
_WINDOW: Final = 4
_LEADERS: Final = 2
START_WORTHY_POINTS: Final = 15
_TEN_THOUSAND: Final = 10_000


@dataclass(frozen=True, slots=True)
class DepthRow:
    player_id: str
    team: str
    position: Position
    slot: float
    season: int
    as_of: datetime


def depth_chart_for(
    player_id: str,
    team: str,
    position: Position,
    rows_by_room: Mapping[tuple[str, Position], Sequence[DepthRow]],
    names: Mapping[str, str],
) -> DepthChart | None:
    """`depthChartFor`: his listed slot and up to four teammates at his position around him."""
    room = rows_by_room.get((team, position), ())
    mine = next((row for row in room if row.player_id == player_id), None)
    if mine is None:
        return None
    others = sorted(
        (row for row in room if row.player_id != player_id), key=lambda row: (row.slot, id_key(row.player_id))
    )[:_MAX_NEIGHBORS]
    around = tuple(DepthChartNeighbor(names.get(row.player_id, row.player_id), row.slot) for row in others)
    return DepthChart(mine.season, js_iso(mine.as_of)[:10], mine.slot, around)


@dataclass(frozen=True, slots=True)
class PlayerWeekShare:
    week: int
    snap_share: float | None
    target_share: float | None


def _round4(value: float) -> float:
    return js_round(value * _TEN_THOUSAND) / _TEN_THOUSAND


def _mean(weeks: Sequence[PlayerWeekShare], select: Callable[[PlayerWeekShare], float | None]) -> float | None:
    values = [value for value in (select(week) for week in weeks) if value is not None]
    if not values:
        return None
    total = 0.0
    for value in values:
        total += value
    return _round4(total / len(values))


def _split(
    early: Sequence[PlayerWeekShare], late: Sequence[PlayerWeekShare], select: Callable[[PlayerWeekShare], float | None]
) -> SplitShare | None:
    early_mean, late_mean = _mean(early, select), _mean(late, select)
    return None if early_mean is None or late_mean is None else SplitShare(early_mean, late_mean)


def role_trend_for(season: int, weeks: Sequence[PlayerWeekShare]) -> RoleTrend | None:
    """`roleTrendFor`: his first four weeks with a reading against his last four."""
    reading = sorted((w for w in weeks if w.snap_share is not None or w.target_share is not None), key=lambda w: w.week)
    if len(reading) < _WINDOW * 2:
        return None
    early, late = reading[:_WINDOW], reading[-_WINDOW:]
    snap = _split(early, late, lambda w: w.snap_share)
    target = _split(early, late, lambda w: w.target_share)
    if snap is None and target is None:
        return None
    return RoleTrend(season, tuple(w.week for w in early), tuple(w.week for w in late), snap, target)


@dataclass(frozen=True, slots=True)
class TeamPlayerTargets:
    player_id: str
    targets: float
    team_targets: float


def target_competition_for(
    season: int, team: str, rows: Sequence[TeamPlayerTargets], names: Mapping[str, str]
) -> TargetCompetition | None:
    """`targetCompetitionFor`: the team's two biggest target earners and their combined share."""
    shares = sorted(
        (
            (row.player_id, _round4(row.targets / row.team_targets))
            for row in rows
            if row.team_targets > 0 and row.targets > 0
        ),
        key=lambda pair: (-pair[1], id_key(pair[0])),
    )
    if len(shares) < _LEADERS:
        return None
    leaders = tuple(TargetLeader(names.get(player_id, player_id), share) for player_id, share in shares[:_LEADERS])
    combined = 0.0
    for leader in leaders:
        combined += leader.share
    return TargetCompetition(season, team, leaders, _round4(combined))


@dataclass(frozen=True, slots=True)
class ScoringTally:
    red_zone_carries: float = 0.0
    red_zone_targets: float = 0.0
    inside_ten_carries: float = 0.0
    inside_ten_targets: float = 0.0
    air_yards: float = 0.0
    air_yard_targets: float = 0.0


def _target_depth(tally: ScoringTally) -> float | None:
    if tally.air_yard_targets <= 0:
        return None
    return js_round((tally.air_yards / tally.air_yard_targets) * 10) / 10


def _rank_quantity(
    tallies: Mapping[str, ScoringTally],
    positions: Mapping[str, Position],
    names: Mapping[str, str],
    select: Callable[[ScoringTally], float | None],
) -> dict[str, RankedStat]:
    by_position: dict[Position, list[RankableStat]] = {}
    for player_id, tally in tallies.items():
        position = positions.get(player_id)
        value = select(tally)
        if position is None or value is None:
            continue
        by_position.setdefault(position, []).append(RankableStat(player_id, names.get(player_id, player_id), value))
    return rank_within_groups(by_position)


def scoring_usage_for(
    season: int, tallies: Mapping[str, ScoringTally], positions: Mapping[str, Position], names: Mapping[str, str]
) -> dict[str, ScoringUsage]:
    """`scoringUsageFor`: red-zone and inside-ten touches and target depth, each ranked by position."""
    red_zone = _rank_quantity(tallies, positions, names, lambda t: t.red_zone_carries + t.red_zone_targets)
    inside_ten = _rank_quantity(tallies, positions, names, lambda t: t.inside_ten_carries + t.inside_ten_targets)
    depth = _rank_quantity(tallies, positions, names, _target_depth)
    out: dict[str, ScoringUsage] = {}
    for player_id in tallies:
        usage = ScoringUsage(season, red_zone.get(player_id), inside_ten.get(player_id), depth.get(player_id))
        if usage.red_zone_touches is None and usage.inside_ten_touches is None and usage.target_depth is None:
            continue
        out[player_id] = usage
    return out


def volatility_for(
    season: int, weeks: Sequence[WeekPoints], threshold: float = START_WORTHY_POINTS
) -> Volatility | None:
    """`volatilityFor`: the weeks over the bar, and the worst week (ties to the earlier)."""
    if not weeks:
        return None
    worst = sorted(weeks, key=lambda w: (w.points, w.week))[0]
    above = sum(1 for w in weeks if w.points > threshold)
    return Volatility(season, len(weeks), above, threshold, worst)


def prior_seasons_for(headlines: Sequence[PriorSeason | None]) -> tuple[PriorSeason, ...]:
    """`priorSeasonsFor`: the seasons he has a headline for, newest first."""
    return tuple(sorted((h for h in headlines if h is not None), key=lambda h: -h.season))
