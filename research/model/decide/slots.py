"""FILLING A STARTING LINEUP BEST-FIRST, in the one place that knows how.

Ported from `research-ts/src/projections/decide/slots.ts`. Spots are filled narrowest eligibility
first, each with the best man it can take under `score` (ties on the player id by the oracle's
collation), which for this product's laminar slot families is the best whole lineup.
"""

from collections.abc import Callable, Sequence
from dataclasses import dataclass
from typing import Protocol

from research.model.domain import BENCH_SLOT, Position, RosterSlotConfig, RosterSlotType
from research.pipeline.jscompat import CollationKey, collation_key


@dataclass(frozen=True, slots=True)
class StartingSpot:
    slot: RosterSlotType
    slot_index: int
    eligible_positions: tuple[Position, ...]

    @property
    def key(self) -> str:
        """`spotKey`."""
        return f"{self.slot}:{self.slot_index}"


class Slottable(Protocol):
    @property
    def player_id(self) -> str: ...

    @property
    def position(self) -> Position: ...


def starting_spots(roster_slots: Sequence[RosterSlotConfig]) -> tuple[StartingSpot, ...]:
    """`startingSpots`: one place per configured starting spot, narrowest first (a stable sort)."""
    spots = [
        StartingSpot(config.slot, index, config.eligible_positions)
        for config in roster_slots
        if config.slot != BENCH_SLOT
        for index in range(config.count)
    ]
    return tuple(sorted(spots, key=lambda spot: len(spot.eligible_positions)))


def id_key(player_id: str) -> CollationKey:
    """A player id's `localeCompare` key (three `str.translate` passes, so nothing is remembered)."""
    return collation_key(player_id)


def best_in_spot[T: Slottable](
    spot: StartingSpot, players: Sequence[T], taken: set[str], score: Callable[[T], float]
) -> T | None:
    """The first element of `eligibleFor(...).sort(score desc, id)`: the best eligible man left."""
    best: T | None = None
    best_score = 0.0
    for player in players:
        if player.player_id in taken or player.position not in spot.eligible_positions:
            continue
        value = score(player)
        if (
            best is None
            or value > best_score
            or (value == best_score and id_key(player.player_id) < id_key(best.player_id))
        ):
            best = player
            best_score = value
    return best


def assign_starters[T: Slottable](
    spots: Sequence[StartingSpot], players: Sequence[T], score: Callable[[T], float]
) -> dict[str, T | None]:
    """`assignStarters`: spot key to the man in it, or None where nobody eligible is left."""
    taken: set[str] = set()
    filled: dict[str, T | None] = {}
    for spot in spots:
        best = best_in_spot(spot, players, taken, score)
        if best is not None:
            taken.add(best.player_id)
        filled[spot.key] = best
    return filled


def best_starting_total[T: Slottable](
    players: Sequence[T], roster_slots: Sequence[RosterSlotConfig], score: Callable[[T], float]
) -> float:
    """`bestStartingTotal`: the fold, in spot order, of the best lineup's scores."""
    total = 0.0
    for player in assign_starters(starting_spots(roster_slots), players, score).values():
        total = total + (0 if player is None else score(player))
    return total
