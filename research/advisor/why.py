"""THE WHY: the card's sentences, built from measured facts and nothing written by a model.

Ported from `research-ts/src/advisor/why.ts` (`himSentence`) and the room sentence the service
pairs it with (`advise.ts`'s `survivalSentence`). Sentence one is about him: the tier he closes and
the drop behind him when the board has one, his rank on our board otherwise, and the slot he fills
either way; with the bench full it is the league's own must-pick line. Three shapes per family,
dealt by the pick the card is computed at, so consecutive turns do not read alike. Every number
names its basis. No em-dash, no semicolon, second person.
"""

from collections.abc import Callable, Sequence
from dataclasses import dataclass
from typing import Final

from research.model.decide.reasons import PickReason, TierCliff
from research.model.decide.roster import must_pick_line, position_word, ships_projected_rows
from research.model.domain import BENCH_SLOT, Position, RosterSlotType
from research.model.jsmath import js_round, js_to_fixed

_UNDER: Final = 0.01
_OVER: Final = 0.99


@dataclass(frozen=True, slots=True)
class HimFacts:
    """What sentence one reads about him."""

    position: Position
    position_rank: int
    fills_slot: RosterSlotType | None
    reasons: tuple[PickReason, ...]
    must_pick: Sequence[Position] | None


@dataclass(frozen=True, slots=True)
class WhySentence:
    text: str
    # `cliff:1`, `value:0`, `must:0`: the family and the shape dealt this turn.
    shape: str


@dataclass(frozen=True, slots=True)
class _Him:
    one: str
    many: str
    slot: str
    rank: int


def _capitalize(text: str) -> str:
    return text[:1].upper() + text[1:]


def _slot_clause(slot: RosterSlotType | None) -> str:
    if slot is None:
        return "has no open slot on your roster"
    if slot == BENCH_SLOT:
        return "takes a bench spot"
    return f"fills your {slot} slot"


def _cliff_of(facts: HimFacts) -> TierCliff | None:
    """A market-order position never argues a drop, nor does a man who would sit."""
    if not ships_projected_rows(facts.position) or facts.fills_slot is None or facts.fills_slot == BENCH_SLOT:
        return None
    return next((reason for reason in facts.reasons if isinstance(reason, TierCliff)), None)


def _tier_clause(him: _Him, cliff: TierCliff) -> str:
    drop = js_to_fixed(cliff.drop_to_next_tier, 1)
    if cliff.players_left_in_tier == 1:
        return f"the last {him.one} before a {drop} point drop"
    return f"one of {cliff.players_left_in_tier} {him.many} left before a {drop} point drop"


def _cliff_one(him: _Him, cliff: TierCliff) -> str:
    return f"He is {_tier_clause(him, cliff)}, and he {him.slot}."


def _cliff_two(him: _Him, cliff: TierCliff) -> str:
    after = "him" if cliff.players_left_in_tier == 1 else f"the {cliff.players_left_in_tier} left in his group"
    return f"The {him.many} fall {js_to_fixed(cliff.drop_to_next_tier, 1)} points after {after}, and he {him.slot}."


def _cliff_three(him: _Him, cliff: TierCliff) -> str:
    behind = "him" if cliff.players_left_in_tier == 1 else f"these {cliff.players_left_in_tier} {him.many}"
    return f"He {him.slot}, and behind {behind} the {him.one} board drops {js_to_fixed(cliff.drop_to_next_tier, 1)} points."


_CLIFF_SHAPES: Final[tuple[Callable[[_Him, TierCliff], str], ...]] = (_cliff_one, _cliff_two, _cliff_three)


def _rank_clause(him: _Him) -> str:
    return f"the best {him.one} on our board" if him.rank == 1 else f"the No. {him.rank} {him.one} on our board"


_VALUE_SHAPES: Final[tuple[Callable[[_Him], str], ...]] = (
    lambda him: f"He is {_rank_clause(him)}, and he {him.slot}.",
    lambda him: f"He {him.slot}, and he is {_rank_clause(him)}.",
    lambda him: f"{_capitalize(_rank_clause(him))}: he {him.slot}.",
)


def him_sentence(facts: HimFacts, variant: int) -> WhySentence:
    """`himSentence`: about him, or with the bench full the league's line about what is still owed."""
    if facts.must_pick:
        return WhySentence(must_pick_line(facts.must_pick), "must:0")
    him = _Him(
        position_word(facts.position, False),
        position_word(facts.position, True),
        _slot_clause(facts.fills_slot),
        facts.position_rank,
    )
    cliff = _cliff_of(facts)
    count = len(_VALUE_SHAPES) if cliff is None else len(_CLIFF_SHAPES)
    index = variant % count
    if cliff is None:
        return WhySentence(_VALUE_SHAPES[index](him), f"value:{index}")
    return WhySentence(_CLIFF_SHAPES[index](him, cliff), f"cliff:{index}")


def _percent_words(probability: float) -> str:
    if probability < _UNDER:
        return "under 1%"
    if probability > _OVER:
        return "over 99%"
    return f"{int(js_round(probability * 100))}%"


def survival_sentence(pick_number: int, next_pick_number: int | None, probability: float) -> str:
    """How many picks go first, and how often he is still there by where drafters take him."""
    if next_pick_number is None:
        return "This is your last pick."
    between = next_pick_number - pick_number - 1
    picks = "1 pick goes" if between == 1 else f"{between} picks go"
    return f"{picks} before your next turn, and he is still there {_percent_words(probability)} of the time by where drafters take him."
