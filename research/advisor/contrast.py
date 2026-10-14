"""EACH SHORTLIST ROW'S WHY, AS ITS CONTRAST TO THE CALL: one sentence, from measured facts only.

The call's own why stays the oracle's (`why.py`, compared bit for bit by the parity harness). Every
row after it says what choosing him instead of the call trades: the points over replacement he
gives up (or gains) against the call, whether he plays another position, and the one fact that
sets him apart, the tier he closes or how much likelier he is than the call to last to your next
turn. The row already prints his position rank and his chance of lasting, so neither number is
ever repeated here.

No stock sentence across rows: the rows of one card are dealt different frames, rotated by the
pick, and each frame words its trailing fact its own way, so two rows never share a sentence with
only the names and numbers swapped. The voice is the capsules' (`research.capsules.voice_rules`,
which the parity case runs over every recorded room): fantasy words, second person, no em-dash, no
semicolon.
"""

from collections.abc import Callable, Sequence
from dataclasses import dataclass
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
# Each frame's words for "likelier to last" and "less likely to last", in frame order.
_LIKELIER: Final = (
    "likelier than the call to last to your next turn",
    "more likely than the call to still be there at your next turn",
    "likelier to wait for your next turn than the call",
    "the one more likely to be there when you pick again",
)
_LESS_LIKELY: Final = (
    "less likely than the call to last to your next turn",
    "less likely than the call to still be there at your next turn",
    "less likely to wait for your next turn than the call",
    "the one less likely to be there when you pick again",
)


@dataclass(frozen=True, slots=True)
class _Row:
    gap: float
    same_position: bool
    one: str
    call_one: str
    slot: RosterSlotType | None
    call_slot: RosterSlotType | None
    tier: str | None
    # +1 likelier than the call to last, -1 less likely, 0 neither said.
    lasts: int
    has_next: bool


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


def _lasts(row: Recommendation, call: Recommendation, has_next: bool) -> int:
    if not has_next:
        return 0
    apart = row.survival_probability - call.survival_probability
    if apart >= _LASTS_APART:
        return 1
    if apart <= -_LASTS_APART:
        return -1
    return 0


def _gap(row: _Row) -> str:
    """The value he trades against the call, with its basis: points over replacement across this
    pick and the best player left at your next (`recommend_pick`'s expected value added)."""
    basis = "across this pick and your next" if row.has_next else "at this last pick"
    if abs(row.gap) < _LEVEL:
        return f"level with the call {basis}"
    points = js_to_fixed(abs(row.gap), 1)
    return f"{points} points over replacement {'behind' if row.gap > 0 else 'ahead of'} the call {basis}"


def _position(row: _Row) -> str:
    return f"another {row.one}" if row.same_position else f"a {row.one} instead of a {row.call_one}"


def _extra(row: _Row, frame: int) -> str:
    """The one fact that sets him apart, as a trailing clause worded by the frame, or nothing."""
    if row.tier is not None:
        return f", and he is {row.tier}"
    if row.lasts:
        return f", and he is {(_LIKELIER if row.lasts > 0 else _LESS_LIKELY)[frame]}"
    if row.slot is not None and row.slot not in {row.call_slot, BENCH_SLOT}:
        return f", and he fills your {row.slot} slot"
    return ""


def _frame_gives(row: _Row) -> str:
    return f"Taking him gives you {_position(row)}, {_gap(row)}{_extra(row, 0)}."


def _frame_is(row: _Row) -> str:
    return f"He is {_position(row)}, {_gap(row)}{_extra(row, 1)}."


def _frame_if(row: _Row) -> str:
    want = f"would rather have this {row.one}" if row.same_position else f"want a {row.one} now"
    return f"If you {want}, he sits {_gap(row)}{_extra(row, 2)}."


def _frame_swap(row: _Row) -> str:
    swap = f"swaps one {row.one} for another" if row.same_position else f"takes a {row.one} over the {row.call_one}"
    return f"Picking him {swap}, {_gap(row)}{_extra(row, 3)}."


_FRAMES: Final[tuple[Callable[[_Row], str], ...]] = (_frame_gives, _frame_is, _frame_if, _frame_swap)


def contrasts(shortlist: Sequence[Recommendation], pick_number: int, has_next: bool) -> list[str | None]:
    """Each row's contrast to the call (the first row), None for the call itself. The rows of one
    card take different frames, so no two share a sentence with only the numbers swapped: past the
    frames there are (a shortlist longer than the api's five), a row carries None and keeps its
    plain why, whatever size the caller asks for."""
    if not shortlist:
        return []
    call = shortlist[0]
    out: list[str | None] = [None]
    for index, r in enumerate(shortlist[1:]):
        if index >= len(_FRAMES):
            out.append(None)
            continue
        row = _Row(
            gap=call.expected_value_added - r.expected_value_added,
            same_position=r.position == call.position,
            one=position_word(r.position, False),
            call_one=position_word(call.position, False),
            slot=_slot_of(r),
            call_slot=_slot_of(call),
            tier=_tier_of(r),
            lasts=_lasts(r, call, has_next),
            has_next=has_next,
        )
        out.append(_FRAMES[(pick_number + index) % len(_FRAMES)](row))
    return out
