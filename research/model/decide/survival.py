"""WHO WILL NOT LAST UNTIL YOUR NEXT TURN: the closed-form survival.

Ported from `research-ts/src/projections/decide/survival.ts`. A player's place in the queue of
upcoming selections is drawn from a bell curve centred on where he sits on the board right now,
conditioned on his not having gone yet: `P(place > n | place > 0)` with a spread of
`DRAFT_NOISE_FLOOR_PICKS + DRAFT_NOISE_SLOPE * place`. The two constants are honest guesses, not
measurements, exactly as the oracle states them.

The answer for a player depends only on his queue place and the picks between the two turns, so
`SurvivalCurve` remembers it per (place, picks between): a pure function memoised, the same
numbers. The room-tendency drift is the oracle's too; the advisor never passes one, so the queue
is ordered by market price alone.
"""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from typing import Final

from research.model.arithmetic import Arithmetic
from research.model.decide.normal import normal_cdf
from research.model.decide.slots import id_key
from research.model.domain import Position
from research.model.jsmath import js_max

MIN_DRAFTS_FOR_ROOM_TENDENCY: Final = 3
DRAFT_NOISE_FLOOR_PICKS: Final = 1
DRAFT_NOISE_SLOPE: Final = 0.25
_PRICE_FLOOR: Final = 0.5


@dataclass(frozen=True, slots=True)
class BoardEntry:
    """One undrafted player and what the market says he costs."""

    player_id: str
    position: Position
    average_draft_position: float


@dataclass(frozen=True, slots=True)
class RoomTendency:
    """How many picks early this room takes each position. No identity field exists, nor may one."""

    picks_early_by_position: Mapping[Position, float]
    drafts_observed: int


@dataclass(frozen=True, slots=True)
class SurvivalCurve:
    """`survivalProbabilities`, with each (queue place, picks between) answered once."""

    arithmetic: Arithmetic
    _memo: dict[tuple[int, int], float] = field(default_factory=dict)

    def survival_of(self, queue_place: int, intervening_picks: int) -> float:
        """`survivalOf`: P(queue place > n | queue place > 0); exactly 1 when nobody picks between."""
        if intervening_picks <= 0:
            return 1.0
        key = (queue_place, intervening_picks)
        known = self._memo.get(key)
        if known is None:
            spread = DRAFT_NOISE_FLOOR_PICKS + DRAFT_NOISE_SLOPE * queue_place
            already_here = normal_cdf(queue_place / spread, self.arithmetic)
            still_here = 1 - normal_cdf((intervening_picks - queue_place) / spread, self.arithmetic)
            known = still_here / already_here
            self._memo[key] = known
        return known

    def probabilities(
        self, board: Sequence[BoardEntry], from_pick: int, to_pick: int, room: RoomTendency | None = None
    ) -> dict[str, float]:
        """Every undrafted player's chance of lasting from `from_pick` to `to_pick`, in queue order."""
        if from_pick < 1:
            raise ValueError(f"A survival question starts at a whole pick number; got {from_pick}.")
        if to_pick <= from_pick:
            raise ValueError(f"Your next turn must come after pick {from_pick}; got {to_pick}.")
        intervening = to_pick - from_pick - 1
        order = queue_order(board, room)
        return {player_id: self.survival_of(index + 1, intervening) for index, player_id in enumerate(order)}


def _drift(position: Position, room: RoomTendency | None) -> float:
    if room is None or room.drafts_observed < MIN_DRAFTS_FOR_ROOM_TENDENCY:
        return 0.0
    return room.picks_early_by_position.get(position, 0.0)


def queue_order(board: Sequence[BoardEntry], room: RoomTendency | None = None) -> list[str]:
    """`queueOrder`: cheapest price first (pulled forward by the room's drift), ties by id."""
    priced = [
        (js_max(_PRICE_FLOOR, entry.average_draft_position - _drift(entry.position, room)), entry.player_id)
        for entry in board
    ]
    priced.sort(key=lambda row: (row[0], id_key(row[1])))
    return [player_id for _, player_id in priced]
