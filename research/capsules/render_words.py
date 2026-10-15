"""THE SMALL WORDS THE FACT SHEET IS WRITTEN IN, shared by `render.py` and `render_depth.py`: a
week with its season, a whole number, a signed one, a position's plural, one ranked quantity as a
clause, and the sheet's labels.

THE LABELS are the sheet's framing words, the ones that say what a line is rather than what a figure
is out of: "in our records", "where most outcomes fall", "as the page prints it". The live review of 2026-10-15
found the injury line's labels copied into prose ("report since the run-up to week" on 122 pages,
"since the run-up to the next game" on one); that line now prints the status as data (`render_season`)
and "the run-up to" is a worn phrase (`Repetition.refrain_stems`). "On file", clerk's language on 113
live pages, is printed nowhere on the sheet and is a worn phrase too (the coordinator's ruling). A label in a read is a validator
failure
(`prose_checks.label_copies`) and its words are never exempt from the span gate
(`span_rules`). A figure with its basis ("players left in his tier before a", "missed to injury or a
reserve list") is not a label: a read may state it that way.
"""

from collections.abc import Callable
from types import MappingProxyType
from typing import Final

from research.capsules.facts.model import RankedStat
from research.model.domain import Position
from research.model.jsmath import js_round, js_to_fixed
from research.pipeline.jscompat import js_number, js_string

# `POSITION_PLURAL` (`domain/position-words.ts`): how a population reads in a sentence.
POSITION_PLURAL: Final = MappingProxyType[Position, str](
    {
        "QB": "quarterbacks",
        "RB": "running backs",
        "WR": "receivers",
        "TE": "tight ends",
        "K": "kickers",
        "DEF": "defenses",
    }
)


# The sheet's labels, each printed by the renderers through these names.
IN_OUR_RECORDS: Final = "in our records"
NEXT_TO_PLAY: Final = "is the next to play"
AS_THE_PAGE_PRINTS: Final = "as the page prints it"
MOST_OUTCOMES: Final = "where most outcomes fall"
LOW_TAIL: Final = "injury-shortened seasons making the low one"
POOLED_IN: Final = "busts and injuries pooled in"
AS_WE_SAW_IT: Final = "as we saw it before the season"
RISK_COUNTED: Final = "with injury risk counted"
SHEET_LABELS: Final = (
    IN_OUR_RECORDS,
    NEXT_TO_PLAY,
    AS_THE_PAGE_PRINTS,
    MOST_OUTCOMES,
    LOW_TAIL,
    POOLED_IN,
    AS_WE_SAW_IT,
    RISK_COUNTED,
)


def week_of(week: int, season: int) -> str:
    """A week as every sheet line and every capsule names it: with its season, "week 7 of 2025"."""
    return f"week {week} of {season}"


def whole(value: float) -> str:
    """`${Math.round(value)}`."""
    return js_string(js_round(value))


def signed(value: float, digits: int = 1) -> str:
    """`signed`: the value to `digits` places, with its sign."""
    rounded = js_number(js_to_fixed(value, digits))
    return f"+{js_string(rounded)}" if rounded >= 0 else js_string(rounded)


def percent(fraction: float, digits: int = 0) -> str:
    """A fraction as a percent: whole by default (`Math.round`), else to `digits` places (`toFixed`)."""
    if digits == 0:
        return f"{js_string(js_round(fraction * 100))}%"
    return f"{js_to_fixed(fraction * 100, digits)}%"


def rank_where(position: Position, rank: RankedStat, among: str | None = None, *, neutral: bool = False) -> str:
    """Where a rank stands and who it is among (`among`, the position's qualifying peers when None),
    with "best at the position" or the neighbour ahead unless the quantity is a role (`neutral`)."""
    who = f"qualifying {POSITION_PLURAL[position]}" if among is None else among
    where = f"{position}{rank.position_rank} among {rank.qualifier_count} {who}"
    if neutral:
        return where
    if rank.position_rank == 1:
        return f"{where}, best at the position"
    if rank.named_neighbor is not None:
        return f"{where}, one spot behind {rank.named_neighbor}"
    return where


def ranked_clause(
    position: Position, label: str, rank: RankedStat, fmt: Callable[[float], str], among: str | None = None
) -> str:
    """One ranked quantity as a clause with its honest qualifier count, no period."""
    return f"{label} {fmt(rank.value)}, {rank_where(position, rank, among)}"
