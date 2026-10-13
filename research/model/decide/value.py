"""REPLACEMENT LEVELS AND VALUE OVER REPLACEMENT.

Ported from `research-ts/src/projections/decide/replacement.ts`. The tier rule lives in `tiers.py`
and is re-exported here for the board, which reads both.
"""

import math
from collections.abc import Sequence
from dataclasses import dataclass

from research.model.decide.slots import id_key
from research.model.decide.tiers import is_real_tier_cliff, tier_standings, tiers_of
from research.model.domain import BENCH_SLOT, Position, RosterSlotConfig
from research.pipeline.jscompat import CollationKey

__all__ = [
    "LeagueShape",
    "SeasonProjection",
    "ValuedPlayer",
    "is_real_tier_cliff",
    "replacement_levels",
    "starting_demand",
    "tier_standings",
    "tiers_of",
    "value_board",
]


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


def _by_points_descending(projection: SeasonProjection) -> tuple[float, CollationKey]:
    """`b.projectedPoints - a.projectedPoints || a.playerId.localeCompare(b.playerId)` as a sort key:
    the same order for finite points (checked below), and both sorts are stable."""
    return (-projection.projected_points, id_key(projection.player_id))


def _pools(projections: Sequence[SeasonProjection]) -> dict[Position, list[SeasonProjection]]:
    pools: dict[Position, list[SeasonProjection]] = {}
    for projection in projections:
        if not math.isfinite(projection.projected_points):
            raise ValueError(
                f"Projection for {projection.player_id} is not a finite number; the decision layer consumes projections, it does not repair them."
            )
        pools.setdefault(projection.position, []).append(projection)
    return {position: sorted(pool, key=_by_points_descending) for position, pool in pools.items()}


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
    return sorted(board, key=lambda player: (-player.value_over_replacement, id_key(player.player_id)))
