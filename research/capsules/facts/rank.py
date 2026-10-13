"""A PLAYER'S FINISH AMONG HIS PEERS, AND HIS YEAR-OVER-YEAR MOVE.

Ported from `research-ts/src/capsules/{rank,trend}.ts`. A rank is one plus the peers strictly
ahead (a tie shares the better rank), over every peer the store holds a real reading for, with the
qualifier count stated and, for a top-three finish, the peer one rank ahead named. A trend is
material when it moves by half the position's own spread across the two seasons.
"""

import bisect
import math
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Final

from research.capsules.facts.model import RankedStat, TrendMetric
from research.model.decide.slots import id_key
from research.model.jsmath import js_pow

TREND_MATERIALITY_STDDEV_FRACTION: Final = 0.5
_NAMED_NEIGHBOR_THROUGH: Final = 3


@dataclass(frozen=True, slots=True)
class RankableStat:
    player_id: str
    name: str
    value: float


def rank_peers(entries: Sequence[RankableStat]) -> dict[str, RankedStat]:
    """`rankPeers`: best first (ties by id), each rank one plus the peers strictly ahead."""
    qualifier_count = len(entries)
    ordered = sorted(entries, key=lambda entry: (-entry.value, id_key(entry.player_id)))
    ascending = sorted(entry.value for entry in entries)
    name_at_rank: dict[int, str] = {}
    ranked: list[tuple[RankableStat, int]] = []
    for entry in ordered:
        position_rank = 1 + len(ascending) - bisect.bisect_right(ascending, entry.value)
        name_at_rank.setdefault(position_rank, entry.name)
        ranked.append((entry, position_rank))
    out: dict[str, RankedStat] = {}
    for entry, position_rank in ranked:
        neighbor = name_at_rank.get(position_rank - 1) if 1 < position_rank <= _NAMED_NEIGHBOR_THROUGH else None
        out[entry.player_id] = RankedStat(entry.value, position_rank, qualifier_count, neighbor)
    return out


def rank_within_groups[K](groups: Mapping[K, Sequence[RankableStat]]) -> dict[str, RankedStat]:
    """`rankWithinGroups`: each group ranked on its own."""
    out: dict[str, RankedStat] = {}
    for entries in groups.values():
        out.update(rank_peers(entries))
    return out


def population_std_dev(values: Sequence[float]) -> float:
    """`populationStdDev`: zero under two values."""
    if len(values) < 2:  # noqa: PLR2004 - a spread needs two values
        return 0.0
    total = 0.0
    for value in values:
        total += value
    mean = total / len(values)
    variance = 0.0
    for value in values:
        variance += js_pow(value - mean, 2)
    return math.sqrt(variance / len(values))


def build_trend_metric(
    prior_season: int,
    prior_value: float | None,
    recent_season: int,
    recent_value: float | None,
    pooled: Sequence[float],
) -> TrendMetric | None:
    """`buildTrendMetric`: None unless both seasons have a reading."""
    if prior_value is None or recent_value is None:
        return None
    delta = recent_value - prior_value
    spread = population_std_dev(pooled)
    material = spread > 0 and abs(delta) >= TREND_MATERIALITY_STDDEV_FRACTION * spread
    return TrendMetric(prior_season, prior_value, recent_season, recent_value, delta, material)
