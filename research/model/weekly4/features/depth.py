"""THE DEPTH CHART AT AN INSTANT (round 4 preregistration, section 5 item 6, amendment 2 item 5).

On the stamp check's pass the replay reads week W's chart, on a fail week W-1's, each at or before
t_g. A club's chart is one statement: from 2025 nflverse publishes dated snapshots, so the read takes
each club's newest snapshot at or before t_g and never merges two. Each player's rank is his best
depth order on it. The fit's scale is the weekly charts' slot rank (2016 to 2024, three receivers at
depth 1); a dated chart ranks across the position, so its rank r is read as ceil(r / s), s the
starting slots the weekly charts carry at the position, and the mapping is recorded.
"""

import math
from collections import defaultdict
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime
from types import MappingProxyType
from typing import Final, Literal

from research.model.weekly3.ledger import Stamp
from research.model.weekly4.features.admitted import DEPTH_CHARTS, DEPTH_COLUMNS, admit_read
from research.model.weekly4.features.reads import DepthRow, as_of_rows
from research.pipeline.nflverse.depth_chart_weeks import DATED_FROM_SEASON

DepthRule = Literal["week", "prior"]
DEPTH_PAIRS: Final = tuple((DEPTH_CHARTS, column) for column in DEPTH_COLUMNS)
STARTING_SLOTS: Final[Mapping[str, int]] = MappingProxyType({"QB": 1, "RB": 1, "WR": 3, "TE": 1})


def slot_rank(rank: int, position: str) -> int:
    """An across-position rank on the slot scale (a position with no listed slots keeps its rank)."""
    return math.ceil(rank / STARTING_SLOTS.get(position, 1))


@dataclass(frozen=True, slots=True)
class DepthChart:
    ranks: Mapping[str, Mapping[str, int]]  # club -> player -> his best rank on the slot scale
    week: int  # the chart's week (W, or W-1 on the fallback)
    mapped: bool  # a dated chart, its ranks mapped to the slot scale
    stamp: Stamp


def _newest_per_club(rows: Sequence[DepthRow]) -> list[DepthRow]:
    newest: dict[str, datetime] = {}
    for r in rows:
        newest[r.team] = max(newest.get(r.team, r.as_of), r.as_of)
    return [r for r in rows if r.as_of == newest[r.team]]


def depth_charts(rows: Sequence[DepthRow], season: int, week: int, moment: datetime, rule: DepthRule) -> DepthChart:
    chart_week = week if rule == "week" else week - 1
    kind: Literal["depth", "depth_prior"] = "depth" if rule == "week" else "depth_prior"
    found = _newest_per_club(as_of_rows(rows, chart_week, chart_week, moment))
    stamp = admit_read(kind, DEPTH_PAIRS, found, season, week, moment)
    mapped = season >= DATED_FROM_SEASON
    ranks: dict[str, dict[str, int]] = defaultdict(dict)
    for r in found:
        rank = slot_rank(r.depth_order, r.position) if mapped else r.depth_order
        best = ranks[r.team].get(r.player_id)
        ranks[r.team][r.player_id] = rank if best is None else min(best, rank)
    return DepthChart(MappingProxyType({k: MappingProxyType(v) for k, v in ranks.items()}), chart_week, mapped, stamp)
