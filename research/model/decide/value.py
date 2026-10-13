"""REPLACEMENT LEVELS, VALUE OVER REPLACEMENT, TIERS AND THE OUTLOOK BAND.

Ported from `research-ts/src/projections/decide/{replacement,tiers,outlook}.ts`.
"""

import math
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Final

from research.model.domain import BENCH_SLOT, Position, RosterSlotConfig
from research.model.jsmath import js_max, js_sorted, locale_compare

GAMES_PER_SEASON: Final = 17
TIER_BREAK_GAMES: Final = 1
TIER_SPAN_POINTS: Final = 2 * GAMES_PER_SEASON
Z_NINETIETH: Final = 1.2815515655446004


@dataclass(frozen=True, slots=True)
class LeagueShape:
    team_count: int
    roster_slots: tuple[RosterSlotConfig, ...]


@dataclass(frozen=True, slots=True)
class SeasonProjection:
    player_id: str
    position: Position
    projected_points: float


@dataclass(frozen=True, slots=True)
class ValuedPlayer:
    player_id: str
    position: Position
    projected_points: float
    value_over_replacement: float
    position_rank: int
    replacement_level: float


def _by_points_descending(a: SeasonProjection, b: SeasonProjection) -> float:
    return (b.projected_points - a.projected_points) or locale_compare(a.player_id, b.player_id)


def _pools(projections: Sequence[SeasonProjection]) -> dict[Position, list[SeasonProjection]]:
    pools: dict[Position, list[SeasonProjection]] = {}
    for projection in projections:
        if not math.isfinite(projection.projected_points):
            raise ValueError(
                f"Projection for {projection.player_id} is not a finite number; the decision layer consumes projections, it does not repair them."
            )
        pools.setdefault(projection.position, []).append(projection)
    return {position: js_sorted(pool, _by_points_descending) for position, pool in pools.items()}


def starting_demand(projections: Sequence[SeasonProjection], shape: LeagueShape) -> dict[Position, int]:
    """`startingDemand`: single-position slots first, then each flex unit to the best next man."""
    if shape.team_count < 1:
        raise ValueError(f"A league shape needs a whole number of teams; got {shape.team_count}.")
    pools = _pools(projections)
    starting = [slot for slot in shape.roster_slots if slot.slot != BENCH_SLOT]
    demand: dict[Position, int] = {}
    for slot in starting:
        for position in slot.eligible_positions:
            demand.setdefault(position, 0)
    for slot in starting:
        if len(slot.eligible_positions) == 1:
            demand[slot.eligible_positions[0]] += slot.count * shape.team_count
    flexible = sorted(
        (slot for slot in starting if len(slot.eligible_positions) > 1), key=lambda slot: len(slot.eligible_positions)
    )
    for slot in flexible:
        for _ in range(slot.count * shape.team_count):
            best: Position | None = None
            best_points = -math.inf
            for position in slot.eligible_positions:
                pool = pools.get(position, [])
                index = demand[position]
                if index < len(pool) and pool[index].projected_points > best_points:
                    best = position
                    best_points = pool[index].projected_points
            if best is None:
                break
            demand[best] += 1
    return demand


def replacement_levels(projections: Sequence[SeasonProjection], shape: LeagueShape) -> dict[Position, float]:
    """`replacementLevel(...).byPosition`: the last starter's points at each position."""
    pools = _pools(projections)
    levels: dict[Position, float] = {}
    for position, count in starting_demand(projections, shape).items():
        pool = pools.get(position, [])
        levels[position] = 0.0 if count == 0 else (pool[count - 1].projected_points if count - 1 < len(pool) else 0.0)
    return levels


def value_board(projections: Sequence[SeasonProjection], shape: LeagueShape) -> list[ValuedPlayer]:
    """`valueBoard`: every projection at a started position, by value over replacement."""
    levels = replacement_levels(projections, shape)
    board: list[ValuedPlayer] = []
    for position, pool in _pools(projections).items():
        level = levels.get(position)
        if level is None:
            continue
        for index, projection in enumerate(pool):
            board.append(
                ValuedPlayer(
                    projection.player_id,
                    projection.position,
                    projection.projected_points,
                    projection.projected_points - level,
                    index + 1,
                    level,
                )
            )
    return js_sorted(
        board,
        lambda a, b: (b.value_over_replacement - a.value_over_replacement) or locale_compare(a.player_id, b.player_id),
    )


def _is_tier_break(above_production: float, above_key: float, below_key: float) -> bool:
    return above_production > 0 and (above_key - below_key) * GAMES_PER_SEASON >= above_production * TIER_BREAK_GAMES


def is_real_tier_cliff(own_projected_points: float, drop_to_next_tier: float) -> bool:
    """`isRealTierCliff`."""
    return own_projected_points > 0 and drop_to_next_tier * GAMES_PER_SEASON >= own_projected_points * TIER_BREAK_GAMES


def _least_spread_split(run: Sequence[float], count: int) -> list[int]:
    size = len(run)
    prefix = [0.0]
    squares = [0.0]
    for value in run:
        prefix.append(prefix[-1] + value)
        squares.append(squares[-1] + value * value)

    def spread(first: int, last: int) -> float:
        members = last - first + 1
        total = prefix[last + 1] - prefix[first]
        return squares[last + 1] - squares[first] - (total * total) / members

    cost = [[math.inf] * size for _ in range(count + 1)]
    first_of_last = [[0] * size for _ in range(count + 1)]
    for last in range(size):
        cost[1][last] = spread(0, last)
    for groups in range(2, count + 1):
        for last in range(groups - 1, size):
            for first in range(groups - 1, last + 1):
                candidate = cost[groups - 1][first - 1] + spread(first, last)
                if candidate < cost[groups][last]:
                    cost[groups][last] = candidate
                    first_of_last[groups][last] = first
    assignment = [0] * size
    end = size - 1
    for group in range(count, 0, -1):
        start = 0 if group == 1 else first_of_last[group][end]
        for index in range(start, end + 1):
            assignment[index] = group - 1
        end = start - 1
    return assignment


def _widest_group_span(run: Sequence[float], assignment: list[int]) -> float:
    spans = []
    for group in dict.fromkeys(assignment):
        first = assignment.index(group)
        last = len(assignment) - 1 - assignment[::-1].index(group)
        spans.append(run[first] - run[last])
    return js_max(*spans)


def _natural_split_within_span(run: Sequence[float]) -> list[int]:
    for count in range(1, len(run)):
        assignment = _least_spread_split(run, count)
        if _widest_group_span(run, assignment) <= TIER_SPAN_POINTS:
            return assignment
    return list(range(len(run)))


def tiers_of(key_descending: Sequence[float], production: Sequence[float] | None = None) -> list[int]:
    """`tiersOf`: runs split at real breaks, each run split into the fewest tight groups."""
    by_row = key_descending if production is None else production
    starts = [
        index
        for index, key in enumerate(key_descending)
        if index == 0 or _is_tier_break(by_row[index - 1], key_descending[index - 1], key)
    ]
    tiers: list[int] = []
    next_tier = 0
    for run_index, start in enumerate(starts):
        end = starts[run_index + 1] if run_index + 1 < len(starts) else len(key_descending)
        groups = _natural_split_within_span(key_descending[start:end])
        tiers.extend(next_tier + group for group in groups)
        next_tier = next_tier + max(-1, *groups) + 1
    return tiers


def tier_standings(tiers: Sequence[int], values: Sequence[float]) -> list[tuple[int, float]]:
    """`tierStandings` (`preseason/board.ts`): (players left in tier, drop to the next tier)."""
    out: list[tuple[int, float]] = []
    for index, tier in enumerate(tiers):
        last_of_tier = len(tiers) - 1 - list(reversed(tiers)).index(tier)
        first_of_next = tiers.index(tier + 1) if (tier + 1) in tiers else -1
        drop = 0.0 if first_of_next == -1 else values[last_of_tier] - values[first_of_next]
        out.append((last_of_tier - index + 1, drop))
    return out
