"""ONE ROSTER AS THE RECOMMENDATION READS IT: where its men sit, its lineup, and what a candidate
would add to it (`fitFor` in `research-ts/src/projections/decide/draft.ts`).

Everything a fit reads that depends on the roster alone (the placements, the lineup total, the slot
a position would land in, the ceilings, the lineup with the best man at a position out) is worked
out once per roster and kept here, so a fit costs one `LineupBase.with_one` (and one more for a
bench body's cover). The arithmetic is the oracle's: marginal is the lineup with him less the
lineup without him, insurance is `BENCH_INSURANCE_SHARE` of his cover when he would sit and of his
own surplus when he would start.
"""

from collections.abc import Sequence
from dataclasses import dataclass, field
from typing import Final

from research.model.decide.marginal import LineupBase, Scored
from research.model.decide.roster import (
    FilledSlots,
    RosterCeilingPolicy,
    any_starter_open,
    assign_slot,
    position_ceiling,
)
from research.model.decide.slots import StartingSpot, starting_spots
from research.model.domain import BENCH_SLOT, Position, RosterSlotConfig, RosterSlotType
from research.model.jsmath import js_max

# What a man is worth sitting behind somebody: a bye week, an injury, and not much else.
BENCH_INSURANCE_SHARE: Final = 0.08


@dataclass(frozen=True, slots=True)
class RosteredPlayer:
    """A player already on the roster, with his value over replacement (required, never defaulted)."""

    player_id: str
    position: Position
    value_over_replacement: float


@dataclass(frozen=True, slots=True)
class Fit:
    """`RosterFit`: what he adds to this roster, where he would land, and the counts the reasons read."""

    marginal_starting_value: float
    insurance: float
    value: float
    slot: RosterSlotType | None
    waits_for_starters: bool
    already_rostered: int
    already_benched: int


def surplus(value_over_replacement: float) -> float:
    """Below-replacement men contribute nothing to a lineup, never negatively (`Math.max(0, x)`)."""
    return js_max(0.0, value_over_replacement)


def _scored(player: RosteredPlayer) -> Scored:
    return Scored(player.player_id, player.position, surplus(player.value_over_replacement))


def place_roster(
    roster: Sequence[RosteredPlayer], slot_config: Sequence[RosterSlotConfig]
) -> list[tuple[RosterSlotType, Position]]:
    """`placeRoster`: the draft's own slot assignment replayed over the roster in draft order."""
    filled: list[RosterSlotType] = []
    placements: list[tuple[RosterSlotType, Position]] = []
    for player in roster:
        slot = assign_slot(player.position, tuple(filled), slot_config)
        if slot is None:
            continue
        filled.append(slot)
        placements.append((slot, player.position))
    return placements


@dataclass(frozen=True, slots=True)
class LeagueRules:
    """The slot config, its starting spots and the ceiling per position: one per request."""

    slot_config: tuple[RosterSlotConfig, ...]
    ceilings: RosterCeilingPolicy
    spots: tuple[StartingSpot, ...] = field(init=False)
    _ceiling_by_position: dict[Position, int] = field(init=False, default_factory=dict)

    def __post_init__(self) -> None:
        object.__setattr__(self, "spots", starting_spots(self.slot_config))

    def ceiling(self, position: Position) -> int:
        known = self._ceiling_by_position.get(position)
        if known is None:
            known = position_ceiling(position, self.slot_config, self.ceilings)
            self._ceiling_by_position[position] = known
        return known


class RosterView:
    """One roster's fixed facts, and `fit_for` any candidate against it."""

    def __init__(self, roster: Sequence[RosteredPlayer], rules: LeagueRules) -> None:
        self.roster = tuple(roster)
        self.rules = rules
        placements = place_roster(self.roster, rules.slot_config)
        self.filled: FilledSlots = tuple(slot for slot, _ in placements)
        self._rostered = {p: sum(1 for r in self.roster if r.position == p) for p in {r.position for r in self.roster}}
        self._benched = {
            p: sum(1 for slot, q in placements if q == p and slot == BENCH_SLOT) for p in {q for _, q in placements}
        }
        self.lineup = LineupBase(rules.spots, [_scored(player) for player in self.roster])
        self._starter_open = any_starter_open(self.filled, rules.slot_config)
        self._slot_by_position: dict[Position, RosterSlotType | None] = {}
        self._without_best: dict[Position, LineupBase | None] = {}

    def with_player(self, player: RosteredPlayer) -> "RosterView":
        """The roster with `player` taken (`[...roster, candidate]`)."""
        return RosterView((*self.roster, player), self.rules)

    def landing_slot(self, position: Position) -> RosterSlotType | None:
        """`landingSlot`: where a man at `position` would land, or None."""
        if position not in self._slot_by_position:
            self._slot_by_position[position] = assign_slot(position, self.filled, self.rules.slot_config)
        return self._slot_by_position[position]

    def _cover_base(self, position: Position) -> LineupBase | None:
        """The lineup with the best man at `position` out, or None with nobody there."""
        if position not in self._without_best:
            at_position = [player for player in self.roster if player.position == position]
            if not at_position:
                self._without_best[position] = None
            else:
                best = at_position[0]
                for player in at_position[1:]:
                    if player.value_over_replacement > best.value_over_replacement:
                        best = player
                without = [_scored(player) for player in self.roster if player is not best]
                self._without_best[position] = LineupBase(self.rules.spots, without)
        return self._without_best[position]

    def _cover_value(self, newcomer: Scored) -> float:
        """`coverValue`: what he adds with the best man at his position out."""
        base = self._cover_base(newcomer.position)
        if base is None:
            return newcomer.score
        return base.with_one(newcomer) - base.total

    def fit_for(self, player_id: str, position: Position, value_over_replacement: float) -> Fit:
        """`fitFor`: his marginal value and insurance to this roster, or unplaceable."""
        already_rostered = self._rostered.get(position, 0)
        already_benched = self._benched.get(position, 0)
        if already_rostered + 1 > self.rules.ceiling(position):
            return Fit(0.0, 0.0, 0.0, None, False, already_rostered, already_benched)
        slot = self.landing_slot(position)
        if slot is None:
            return Fit(0.0, 0.0, 0.0, None, False, already_rostered, already_benched)
        newcomer = Scored(player_id, position, surplus(value_over_replacement))
        marginal = self.lineup.with_one(newcomer) - self.lineup.total
        sits = slot == BENCH_SLOT
        insurance = BENCH_INSURANCE_SHARE * (self._cover_value(newcomer) if sits else newcomer.score)
        return Fit(
            marginal,
            insurance,
            marginal + insurance,
            slot,
            sits and self._starter_open,
            already_rostered,
            already_benched,
        )
