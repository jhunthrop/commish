"""THE WARM-UP: one call through the closed form before the instance says it is ready.

The room state is shape only, built here from arithmetic and never served or stored: twelve seats
on the standard roster, a pool whose points and draft positions simply descend, a few picks in.
It exercises every path a real call takes (the valuation, the survival curve, the recommendation,
the why and the tiers) so the first real call does not pay for imports and first-touch caches.
"""

from typing import Final

from research.advisor.advise import advise
from research.advisor.request import parse_request
from research.model.decide.survival import SurvivalCurve
from research.model.domain import STANDARD_ROSTER_SLOTS

_TEAMS: Final = 12
_PER_POSITION: Final = (("QB", 30), ("RB", 60), ("WR", 70), ("TE", 30), ("K", 16), ("DEF", 16))
_PICKS_IN: Final = 7


def _shape_only_state() -> dict[str, object]:
    pool: list[dict[str, object]] = []
    for position, count in _PER_POSITION:
        for index in range(count):
            projected = None if position in {"K", "DEF"} else 300.0 - 4.0 * index
            pool.append({"id": f"{position}-{index}", "position": position, "adp": 1.0, "projectedPoints": projected})
    for rank, entry in enumerate(pool):
        entry["adp"] = float(rank + 1)
    slots = [
        {"slot": config.slot, "count": config.count, "eligiblePositions": list(config.eligible_positions)}
        for config in STANDARD_ROSTER_SLOTS
    ]
    picks = [{"pickNumber": n + 1, "playerId": pool[n]["id"], "seat": n + 1} for n in range(_PICKS_IN)]
    return {"teamCount": _TEAMS, "rosterSlots": slots, "pool": pool, "picks": picks, "seatOnClock": _PICKS_IN + 1}


def warm_up(curve: SurvivalCurve) -> None:
    """Advise once on the shape-only state; raises if the closed form cannot answer it."""
    advise(parse_request(_shape_only_state()), curve)
