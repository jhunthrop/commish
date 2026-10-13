"""THE ROSTER RULES THE DECISION LAYER ASKS: legality, the slot a man lands in, the ceilings, the
snake order and the plain words for a position.

Ported from `research-ts/src/domain/{roster-eligibility,must-pick,position-words}.ts`,
`src/draft-engine/{slotting,roster-need,order}.ts` and `projections/preseason/kdef-decision.ts`.
A filled roster is read here as the slots its players occupy (`FilledSlots`): every rule below
counts occupants per slot and never reads who they are, so the slot types are the whole of it.
"""

from collections.abc import Sequence
from dataclasses import dataclass
from types import MappingProxyType
from typing import Final, Literal

from research.model.domain import BENCH_SLOT, Position, RosterSlotConfig, RosterSlotType
from research.model.jsmath import js_round

FilledSlots = tuple[RosterSlotType, ...]

# The two positions a real draft board takes last; they never share a slot and hold no bench body.
LATE_ROUND_ONLY_POSITIONS: Final[tuple[Position, ...]] = ("K", "DEF")
# Which position a shared slot is in practice: the eligible one that scores the most over a season.
_SHARED_SLOT_CLAIMANT_ORDER: Final[tuple[Position, ...]] = ("QB", "RB", "WR", "TE", "K", "DEF")

KdefVerdict = Literal["projected", "market_order"]
# The kicker and team defense decision (`kdef-decision.ts`): both ship in market order.
KDEF_DECISION: Final = MappingProxyType[Position, KdefVerdict]({"K": "market_order", "DEF": "market_order"})


@dataclass(frozen=True, slots=True)
class RosterCeilingPolicy:
    """`RosterCeilingPolicy`: bench bodies allowed at a position the league starts exactly one of."""

    backups_at_single_starter_position: int


# `AUTOPICK_CONFIG.rosterCeilings`: the advice follows the engine's current rule.
AUTOPICK_ROSTER_CEILINGS: Final = RosterCeilingPolicy(backups_at_single_starter_position=1)


def ships_projected_rows(position: Position) -> bool:
    """`shipsProjectedRows`: false for a position the board ships in market order."""
    return position not in KDEF_DECISION or KDEF_DECISION[position] == "projected"


def eligible_slots_for_position(position: Position, slot_config: Sequence[RosterSlotConfig]) -> list[RosterSlotType]:
    return [config.slot for config in slot_config if position in config.eligible_positions]


def _filled_in(slot: RosterSlotType, roster: FilledSlots) -> int:
    return sum(1 for filled in roster if filled == slot)


def _can_add(
    slot_config: Sequence[RosterSlotConfig], roster: FilledSlots, position: Position, slot: RosterSlotType
) -> bool:
    """`validateRosterAdd(...).valid`."""
    config = next((c for c in slot_config if c.slot == slot), None)
    if config is None or position not in config.eligible_positions:
        return False
    return _filled_in(slot, roster) < config.count


def assign_slot(
    position: Position, roster: FilledSlots, slot_config: Sequence[RosterSlotConfig]
) -> RosterSlotType | None:
    """`assignSlot`: the first eligible slot in config order with room, or None."""
    for slot in eligible_slots_for_position(position, slot_config):
        if _can_add(slot_config, roster, position, slot):
            return slot
    return None


def restricted_positions(slot_config: Sequence[RosterSlotConfig], roster: FilledSlots) -> list[Position] | None:
    """`restrictedPositions`: the positions a full-bench roster can still take, None while any fits."""

    def open_count(config: RosterSlotConfig) -> int:
        return config.count - _filled_in(config.slot, roster)

    if any(config.slot == BENCH_SLOT and open_count(config) > 0 for config in slot_config):
        return None
    open_positions: dict[Position, None] = {}
    for config in slot_config:
        if config.slot != BENCH_SLOT and open_count(config) > 0:
            for position in config.eligible_positions:
                open_positions.setdefault(position, None)
    rostered = {position for config in slot_config for position in config.eligible_positions}
    return None if len(open_positions) == len(rostered) else list(open_positions)


def _rostered_positions(slot_config: Sequence[RosterSlotConfig]) -> list[Position]:
    seen: dict[Position, None] = {}
    for config in slot_config:
        for position in config.eligible_positions:
            seen.setdefault(position, None)
    return list(seen)


def _is_shared(config: RosterSlotConfig) -> bool:
    return config.slot != BENCH_SLOT and len(config.eligible_positions) > 1


def _dedicated(position: Position, slot_config: Sequence[RosterSlotConfig]) -> int:
    return sum(config.count for config in slot_config if config.slot == position)


def _shared_eligible(position: Position, slot_config: Sequence[RosterSlotConfig]) -> int:
    return sum(config.count for config in slot_config if _is_shared(config) and position in config.eligible_positions)


def _claims(position: Position, config: RosterSlotConfig) -> bool:
    return next((c for c in _SHARED_SLOT_CLAIMANT_ORDER if c in config.eligible_positions), None) == position


def _starting_demand(position: Position, slot_config: Sequence[RosterSlotConfig]) -> int:
    return _dedicated(position, slot_config) + _shared_eligible(position, slot_config)


def is_single_starter_position(position: Position, slot_config: Sequence[RosterSlotConfig]) -> bool:
    """`isSingleStarterPosition`: exactly one startable slot, counting the shared slots it claims."""
    claimed = sum(config.count for config in slot_config if _is_shared(config) and _claims(position, config))
    return position not in LATE_ROUND_ONLY_POSITIONS and _dedicated(position, slot_config) + claimed == 1


def position_ceiling(position: Position, slot_config: Sequence[RosterSlotConfig], policy: RosterCeilingPolicy) -> int:
    """`positionCeiling`: the most players a roster should hold at `position`."""
    dedicated = _dedicated(position, slot_config)
    shared = _shared_eligible(position, slot_config)
    if dedicated == 0 and shared == 0:
        return 0
    if position in LATE_ROUND_ONLY_POSITIONS:
        return dedicated
    if is_single_starter_position(position, slot_config):
        return dedicated + policy.backups_at_single_starter_position
    positions = _rostered_positions(slot_config)
    single_starters = sum(1 for candidate in positions if is_single_starter_position(candidate, slot_config))
    bench = sum(config.count for config in slot_config if config.slot == BENCH_SLOT)
    remaining = max(0, bench - single_starters * policy.backups_at_single_starter_position)
    multi = [
        candidate
        for candidate in positions
        if candidate not in LATE_ROUND_ONLY_POSITIONS and not is_single_starter_position(candidate, slot_config)
    ]
    demand = 0
    for candidate in multi:
        demand += _starting_demand(candidate, slot_config)
    share = js_round(remaining * (_starting_demand(position, slot_config) / demand))
    return dedicated + shared + int(share)


def any_starter_open(roster: FilledSlots, slot_config: Sequence[RosterSlotConfig]) -> bool:
    """`anyStarterOpen`: a starting slot other than a late-round one is still unfilled."""
    return any(
        config.slot != BENCH_SLOT
        and config.slot not in LATE_ROUND_ONLY_POSITIONS
        and config.count - _filled_in(config.slot, roster) > 0
        for config in slot_config
    )


def total_roster_slots(slot_config: Sequence[RosterSlotConfig]) -> int:
    """`totalRosterSlots`: rounds in a snake draft."""
    return sum(config.count for config in slot_config)


def snake_seat(team_count: int, pick_number: int) -> int:
    """`snakeSeat`: the 1-based draft slot a snake draft puts on the clock at a 1-based pick."""
    if pick_number < 1:
        raise ValueError(f"Invalid pick number: {pick_number}.")
    round_number = -(-pick_number // team_count)
    index_in_round = (pick_number - 1) % team_count
    order_index = index_in_round if round_number % 2 == 1 else team_count - 1 - index_in_round
    return order_index + 1


def next_turn(team_count: int, seat: int, pick_number: int, total_picks: int) -> int | None:
    """`nextTurn`: the seat's next turn after `pick_number`, or None when the draft ends first."""
    for pick in range(pick_number + 1, total_picks + 1):
        if snake_seat(team_count, pick) == seat:
            return pick
    return None


_POSITION_WORDS: Final = MappingProxyType[Position, tuple[str, str]](
    {
        "QB": ("quarterback", "quarterbacks"),
        "RB": ("back", "backs"),
        "WR": ("receiver", "receivers"),
        "TE": ("tight end", "tight ends"),
        "K": ("kicker", "kickers"),
        "DEF": ("defense", "defenses"),
    }
)


def position_word(position: Position, plural: bool) -> str:
    """`positionWord`: "back", "receivers", never a tier letter."""
    return _POSITION_WORDS[position][1 if plural else 0]


def position_label(position: Position) -> str:
    """`positionLabel`: the badge abbreviation, the team defense as D/ST."""
    return "D/ST" if position == "DEF" else position


def must_pick_line(positions: Sequence[Position]) -> str:
    """`mustPickLine`: "Your next pick must be a K or a D/ST." """
    if not positions:
        raise ValueError("mustPickLine needs at least one position; a full roster has no next pick to name.")
    parts = [f"{'an' if position == 'RB' else 'a'} {position_label(position)}" for position in positions]
    joined = parts[0] if len(parts) == 1 else f"{', '.join(parts[:-1])} or {parts[-1]}"
    return f"Your next pick must be {joined}."
