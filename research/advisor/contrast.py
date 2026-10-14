"""EACH SHORTLIST ROW'S WHY, AS ITS CONTRAST TO THE CALL: one sentence, its fact first.

The call's own why stays the oracle's (`why.py`, compared bit for bit by the parity harness). Every
row after it leads with the one fact that sets him apart from the call, in this order: the tier he
closes, how much likelier (or less likely) he is than the call to last to your next turn, another
position, another slot, and only when none holds, that he is the same kind of pick. The cost comes
second: the first row says it in full, with its basis ("costing 20.2 points over this pick and your
next", the points over replacement `recommend_pick` adds up across this pick and the best player
left at your next), and every row after says only the figure ("4.7 points less"), so no row repeats
the clause once a card has stated it. The row already prints his position rank and his chance of
lasting, so neither number is repeated here.

The voice is the capsules' (`research.capsules.voice_rules`, which the parity case runs over every
recorded room): fantasy words, second person, no em-dash, no semicolon.
"""

from collections.abc import Sequence
from typing import Final

from research.advisor.why import tier_clause
from research.model.decide.draft import Recommendation
from research.model.decide.reasons import FillsStartingSlot, TierCliff
from research.model.decide.roster import position_word, ships_projected_rows
from research.model.domain import BENCH_SLOT, RosterSlotType
from research.model.jsmath import js_to_fixed

# A gap under this many points over replacement reads as none.
_LEVEL: Final = 0.05
# How much likelier (or less likely) than the call a row must be to last before it is said.
_LASTS_APART: Final = 0.2


def _slot_of(r: Recommendation) -> RosterSlotType | None:
    return next((reason.slot for reason in r.reasons if isinstance(reason, FillsStartingSlot)), None)


def _tier_of(r: Recommendation) -> str | None:
    slot = _slot_of(r)
    if not ships_projected_rows(r.position) or slot is None or slot == BENCH_SLOT:
        return None
    cliff = next((reason for reason in r.reasons if isinstance(reason, TierCliff)), None)
    if cliff is None:
        return None
    return tier_clause(position_word(r.position, False), position_word(r.position, True), cliff)


def _capitalize(text: str) -> str:
    return text[:1].upper() + text[1:]


_ORDINALS: Final = ("second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth")


def _facts(r: Recommendation, call: Recommendation, has_next: bool, place: int) -> list[str]:
    """The facts that set this row apart from the call, strongest first, ending with its place in
    line, which no other row shares."""
    out: list[str] = []
    tier = _tier_of(r)
    if tier is not None:
        out.append(_capitalize(tier))
    apart = r.survival_probability - call.survival_probability if has_next else 0.0
    if apart >= _LASTS_APART:
        out.append("Likelier than the call to last to your next pick")
    elif apart <= -_LASTS_APART:
        out.append("Less likely than the call to last to your next pick")
    one = position_word(r.position, False)
    if r.position != call.position:
        out.append(f"A {one} where the call is a {position_word(call.position, False)}")
    slot = _slot_of(r)
    if slot is not None and slot not in {_slot_of(call), BENCH_SLOT}:
        out.append(f"A {one} who fills your {slot} slot")
    if r.position == call.position:
        out.append(f"Another {one} like the call")
    word = _ORDINALS[place] if place < len(_ORDINALS) else f"{place + 2}th"
    out.append(f"The {word} player in line on this list, a {one}")
    return out


def _cost(gap: float, first: bool, has_next: bool) -> str:
    """What taking him costs against the call: in full with its basis once, then the figure."""
    basis = "over this pick and your next" if has_next else "at this last pick"
    if abs(gap) < _LEVEL:
        return f"even with the call {basis}" if first else "even with the call"
    points = js_to_fixed(abs(gap), 1)
    if first:
        return f"costing {points} points {basis}" if gap > 0 else f"adding {points} points {basis}"
    return f"{points} points less" if gap > 0 else f"{points} points more"


def contrasts(shortlist: Sequence[Recommendation], pick_number: int, has_next: bool) -> list[str | None]:
    """Each row's contrast to the call (the first row), None for the call itself."""
    del pick_number  # a row's words are its facts, never dealt by the pick
    if not shortlist:
        return []
    call = shortlist[0]
    out: list[str | None] = [None]
    said: set[str] = set()
    for index, r in enumerate(shortlist[1:]):
        cost = _cost(call.expected_value_added - r.expected_value_added, index == 0, has_next)
        # The strongest fact no earlier row on the card has led with, so each row gives its own reason;
        # its place in line, which no other row shares, when every other fact is taken.
        fact = next(fact for fact in _facts(r, call, has_next, index) if fact not in said)
        said.add(fact)
        out.append(f"{fact}, {cost}.")
    return out
