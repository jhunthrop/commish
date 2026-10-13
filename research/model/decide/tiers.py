"""WHERE A POSITION FALLS OFF: the tier rule, in units a manager already thinks in.

Ported from `research-ts/src/projections/decide/tiers.ts` (and `tierStandings` from
`preseason/board.ts`). A new tier starts where the next player projects at least a game's worth of
production less than the one above him; no tier stretches more than two points a game end to end,
a long run of small steps splitting at its widest gaps into as many tiers as that natural split
needs.

THE SAME NUMBERS, FASTER. The oracle reruns its least-spread dynamic programme from nothing for
each group count, one candidate at a time. Here a row of the programme is computed once and kept
for every larger count (a row's values never depend on the count asked for), and each row's inner
scan over where the last group starts is one vector expression. Every element of that vector is
the oracle's own expression, `squares[last + 1] - squares[first] - (sum * sum) / members` with
`sum = prefix[last + 1] - prefix[first]`, evaluated by numpy's elementwise IEEE 754 operations in
the same order, and the oracle's strict `<` scan keeps the first minimum, which is `argmin`'s rule.
The parity cases compare every tier against the oracle.
"""

import math
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Final

import numpy as np
import numpy.typing as npt

from research.model.jsmath import js_max

GAMES_PER_SEASON: Final = 17
TIER_BREAK_GAMES: Final = 1
TIER_SPAN_POINTS_PER_GAME: Final = 2
TIER_SPAN_POINTS: Final = TIER_SPAN_POINTS_PER_GAME * GAMES_PER_SEASON

FloatArray = npt.NDArray[np.float64]
IntArray = npt.NDArray[np.int64]


def _is_tier_break(above_production: float, above_key: float, below_key: float) -> bool:
    return above_production > 0 and (above_key - below_key) * GAMES_PER_SEASON >= above_production * TIER_BREAK_GAMES


def is_real_tier_cliff(own_projected_points: float, drop_to_next_tier: float) -> bool:
    """`isRealTierCliff`: the drop behind him is worth at least a game of his own projection."""
    return own_projected_points > 0 and drop_to_next_tier * GAMES_PER_SEASON >= own_projected_points * TIER_BREAK_GAMES


class _SpreadProgramme:
    """The least-spread split of one sorted run, its rows grown on demand and kept."""

    def __init__(self, run: Sequence[float]) -> None:
        prefix = [0.0]
        squares = [0.0]
        for value in run:
            prefix.append(prefix[-1] + value)
            squares.append(squares[-1] + value * value)
        self._size = len(run)
        self._prefix: FloatArray = np.array(prefix, dtype=np.float64)
        self._squares: FloatArray = np.array(squares, dtype=np.float64)
        # Row g: the cheapest split of run[0..last] into g groups, and where its last group starts.
        first_row = np.array([self._spread_scalar(0, last) for last in range(self._size)], dtype=np.float64)
        self._cost: list[FloatArray] = [np.full(self._size, math.inf), first_row]
        self._first_of_last: list[IntArray] = [np.zeros(self._size, np.int64), np.zeros(self._size, np.int64)]

    def _spread_scalar(self, first: int, last: int) -> float:
        members = last - first + 1
        total = float(self._prefix[last + 1]) - float(self._prefix[first])
        return float(self._squares[last + 1]) - float(self._squares[first]) - (total * total) / members

    def _grow(self, groups: int) -> None:
        previous = self._cost[groups - 1]
        cost = np.full(self._size, math.inf)
        first_of_last = np.zeros(self._size, np.int64)
        for last in range(groups - 1, self._size):
            first = np.arange(groups - 1, last + 1)
            members = (last - first + 1).astype(np.float64)
            total = self._prefix[last + 1] - self._prefix[first]
            spread = (self._squares[last + 1] - self._squares[first]) - (total * total) / members
            candidates = previous[first - 1] + spread
            best = int(np.argmin(candidates))
            if candidates[best] < cost[last]:
                cost[last] = candidates[best]
                first_of_last[last] = groups - 1 + best
        self._cost.append(cost)
        self._first_of_last.append(first_of_last)

    def split(self, count: int) -> list[int]:
        """`leastSpreadSplit(run, count)`: the group index per player."""
        while len(self._cost) <= count:
            self._grow(len(self._cost))
        assignment = [0] * self._size
        end = self._size - 1
        for group in range(count, 0, -1):
            start = 0 if group == 1 else int(self._first_of_last[group][end])
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
    programme = _SpreadProgramme(run) if len(run) > 1 else None
    for count in range(1, len(run)):
        assert programme is not None
        assignment = programme.split(count)
        if _widest_group_span(run, assignment) <= TIER_SPAN_POINTS:
            return assignment
    return list(range(len(run)))


def tiers_of(key_descending: Sequence[float], production: Sequence[float] | None = None) -> list[int]:
    """`tiersOf`: runs split at real breaks, each run split into the fewest tight natural groups."""
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


@dataclass(frozen=True, slots=True)
class TierStanding:
    tier: int
    players_left_in_tier: int
    drop_to_next_tier: float


def tier_standing_in(tiers: Sequence[int], points_descending: Sequence[float], index: int) -> TierStanding:
    """`tierStanding` given the pool's tiers already drawn (`tiers_of(points_descending)`)."""
    if not 0 <= index < len(tiers):
        raise ValueError(f"No player sits at index {index} in a pool of {len(points_descending)}.")
    tier = tiers[index]
    last_of_tier = len(tiers) - 1 - list(reversed(tiers)).index(tier)
    first_of_next = tiers.index(tier + 1) if (tier + 1) in tiers else -1
    drop = 0.0 if first_of_next == -1 else points_descending[last_of_tier] - points_descending[first_of_next]
    return TierStanding(tier, last_of_tier - index + 1, drop)


def tier_standing(points_descending: Sequence[float], index: int) -> TierStanding:
    """`tierStanding`: his tier, how many are left in it from him down, and the drop after it."""
    return tier_standing_in(tiers_of(points_descending), points_descending, index)


def tier_standings(tiers: Sequence[int], values: Sequence[float]) -> list[tuple[int, float]]:
    """`tierStandings` (`preseason/board.ts`): (players left in tier, drop to the next tier)."""
    out: list[tuple[int, float]] = []
    for index in range(len(tiers)):
        standing = tier_standing_in(tiers, values, index)
        out.append((standing.players_left_in_tier, standing.drop_to_next_tier))
    return out
