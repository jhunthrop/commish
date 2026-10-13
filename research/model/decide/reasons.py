"""WHY HE IS ON THE SHORTLIST, AS DATA: the closed union of reason codes `recommendPick` carries.

Ported from `research-ts/src/projections/decide/draft.ts` (`PickReason`, `reasonsFor`,
`REASON_PRIORITY`). The room renders them into words (`research.advisor.why`); nothing here writes
prose.
"""

from collections.abc import Sequence
from dataclasses import dataclass
from types import MappingProxyType
from typing import Final, Literal, Protocol

from research.model.decide.roster_view import Fit
from research.model.decide.slots import id_key
from research.model.decide.tiers import is_real_tier_cliff, tier_standing_in, tiers_of
from research.model.domain import Position, RosterSlotType

WILL_NOT_SURVIVE_BELOW: Final = 0.35
SAFE_TO_WAIT_ABOVE: Final = 0.8
TIER_IS_THIN_AT: Final = 3

ReasonCode = Literal[
    "value_over_replacement",
    "will_not_survive",
    "safe_to_wait",
    "no_further_turn",
    "tier_cliff",
    "fills_starting_slot",
    "roster_saturated",
]


@dataclass(frozen=True, slots=True)
class ValueOverReplacement:
    value_over_replacement: float
    position: Position
    position_rank: int
    code: ReasonCode = "value_over_replacement"


@dataclass(frozen=True, slots=True)
class WillNotSurvive:
    survival_probability: float
    next_pick: int
    code: ReasonCode = "will_not_survive"


@dataclass(frozen=True, slots=True)
class SafeToWait:
    survival_probability: float
    next_pick: int
    code: ReasonCode = "safe_to_wait"


@dataclass(frozen=True, slots=True)
class NoFurtherTurn:
    pick_number: int
    code: ReasonCode = "no_further_turn"


@dataclass(frozen=True, slots=True)
class TierCliff:
    position: Position
    drop_to_next_tier: float
    players_left_in_tier: int
    code: ReasonCode = "tier_cliff"


@dataclass(frozen=True, slots=True)
class FillsStartingSlot:
    slot: RosterSlotType
    code: ReasonCode = "fills_starting_slot"


@dataclass(frozen=True, slots=True)
class RosterSaturated:
    position: Position
    already_rostered: int
    already_benched: int
    code: ReasonCode = "roster_saturated"


PickReason = (
    ValueOverReplacement | WillNotSurvive | SafeToWait | NoFurtherTurn | TierCliff | FillsStartingSlot | RosterSaturated
)

# Most decisive first, so a surface that shows only one reason shows the one that decided it.
_PRIORITY: Final = MappingProxyType[ReasonCode, int](
    {
        "will_not_survive": 0,
        "tier_cliff": 1,
        "roster_saturated": 2,
        "fills_starting_slot": 3,
        "value_over_replacement": 4,
        "safe_to_wait": 5,
        "no_further_turn": 6,
    }
)


class Valued(Protocol):
    @property
    def player_id(self) -> str: ...

    @property
    def position(self) -> Position: ...

    @property
    def projected_points(self) -> float: ...

    @property
    def value_over_replacement(self) -> float: ...

    @property
    def position_rank(self) -> int: ...


class PositionPools:
    """`positionPool` per position (best first by value over replacement, ties by id) and its tiers,
    drawn once per board rather than once per candidate."""

    def __init__(self, board: Sequence[Valued]) -> None:
        self._board = tuple(board)
        self._pools: dict[Position, tuple[dict[str, int], list[float], list[int]]] = {}

    def _pool(self, position: Position) -> tuple[dict[str, int], list[float], list[int]]:
        known = self._pools.get(position)
        if known is None:
            pool = sorted(
                (entry for entry in self._board if entry.position == position),
                key=lambda entry: (-entry.value_over_replacement, id_key(entry.player_id)),
            )
            points = [entry.projected_points for entry in pool]
            known = ({entry.player_id: index for index, entry in enumerate(pool)}, points, tiers_of(points))
            self._pools[position] = known
        return known

    def cliff_for(self, player_id: str, position: Position) -> TierCliff | None:
        """The `tier_cliff` reason, when his tier is thin and the drop behind it a real cliff."""
        index_of, points, tiers = self._pool(position)
        index = index_of.get(player_id, -1)
        standing = tier_standing_in(tiers, points, index)
        own = points[index] if 0 <= index < len(points) else 0.0
        if is_real_tier_cliff(own, standing.drop_to_next_tier) and standing.players_left_in_tier <= TIER_IS_THIN_AT:
            return TierCliff(position, standing.drop_to_next_tier, standing.players_left_in_tier)
        return None


@dataclass(frozen=True, slots=True)
class Turn:
    """The pick on the clock and the seat's next one (None at its last)."""

    pick_number: int
    next_pick_number: int | None


def reasons_for(
    candidate: Valued, fit: Fit, survival: float, turn: Turn, pools: PositionPools
) -> tuple[PickReason, ...]:
    """`reasonsFor`, ordered most decisive first (a stable sort on the priority)."""
    reasons: list[PickReason] = [
        ValueOverReplacement(candidate.value_over_replacement, candidate.position, candidate.position_rank)
    ]
    if turn.next_pick_number is None:
        reasons.append(NoFurtherTurn(turn.pick_number))
    elif survival < WILL_NOT_SURVIVE_BELOW:
        reasons.append(WillNotSurvive(survival, turn.next_pick_number))
    elif survival > SAFE_TO_WAIT_ABOVE:
        reasons.append(SafeToWait(survival, turn.next_pick_number))
    if fit.marginal_starting_value > 0 and fit.slot is not None:
        reasons.append(FillsStartingSlot(fit.slot))
    elif fit.slot is not None:
        reasons.append(RosterSaturated(candidate.position, fit.already_rostered, fit.already_benched))
    cliff = pools.cliff_for(candidate.player_id, candidate.position)
    if cliff is not None:
        reasons.append(cliff)
    return tuple(sorted(reasons, key=lambda reason: _PRIORITY[reason.code]))
