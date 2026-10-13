"""THE SMALL WORDS THE FACT SHEET IS WRITTEN IN, shared by `render.py` and `render_depth.py`: a
whole number, a signed one, a position's plural, and one ranked quantity as a clause."""

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


def whole(value: float) -> str:
    """`${Math.round(value)}`."""
    return js_string(js_round(value))


def signed(value: float, digits: int = 1) -> str:
    """`signed`: the value to `digits` places, with its sign."""
    rounded = js_number(js_to_fixed(value, digits))
    return f"+{js_string(rounded)}" if rounded >= 0 else js_string(rounded)


def ranked_clause(position: Position, label: str, rank: RankedStat, fmt: Callable[[float], str]) -> str:
    """One ranked quantity as a clause with its honest qualifier count, no period."""
    where = f"{position}{rank.position_rank} among {rank.qualifier_count} qualifying {POSITION_PLURAL[position]}"
    if rank.position_rank == 1:
        return f"{label} {fmt(rank.value)}, {where}, best at the position"
    if rank.named_neighbor is not None:
        return f"{label} {fmt(rank.value)}, {where}, one spot behind {rank.named_neighbor}"
    return f"{label} {fmt(rank.value)}, {where}"
