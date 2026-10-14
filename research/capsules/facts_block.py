"""THE FACTS BLOCK: what a page carries when the writer cannot serve a player within its ceiling.

The founder's rule: every non-stat sentence on a page comes from the writer, and a stock sentence
across players is a defect, a frame with the name and the numbers swapped included. So the fallback
is no prose at all: the player's own numbers with their basis, as labelled facts, one to a line and
no sentence among them, stored `source = 'facts'` and rendered by the page as a facts list. The
nightly counts these pages against its 2% line (`research.nightly.capsule_gate`), and the sweep
retries each one every night until the writer serves him.

Every number is the sheet's; a projection under ten points prints to the tenth, the precision the
page's pull figure reads it at.
"""

from typing import TYPE_CHECKING, Final

from research.capsules.render_words import whole
from research.model.jsmath import js_to_fixed
from research.pipeline.jscompat import js_string

if TYPE_CHECKING:
    from research.capsules.facts.build import PlayerFacts

FACTS_SOURCE: Final = "facts"
_WHOLE_NUMBER_FLOOR: Final = 10


def _points(value: float) -> str:
    return whole(value) if abs(value) >= _WHOLE_NUMBER_FLOOR else js_to_fixed(value, 1)


def facts_lines(facts: "PlayerFacts") -> tuple[tuple[str, str], ...]:
    """(label, value) for each fact the block states: the projection and its basis, the ranges, the
    board's rank and where drafters take him."""
    p, market, availability = facts.projection, facts.market, facts.availability
    basis = "" if availability is None else f" in {js_to_fixed(availability.expected_games, 1)} expected games"
    position_rank = "" if market.position_rank is None else f", {facts.identity.position}{market.position_rank}"
    by_adp = "" if market.position_adp is None else f" ({market.position_adp} by ADP)"
    return (
        ("Projected points", f"{_points(p.projected_points)}{basis}"),
        ("Middle range", f"{whole(p.typical_low)} to {whole(p.typical_high)} points"),
        ("Full range", f"{whole(p.floor_points)} to {whole(p.ceiling_points)} points"),
        (
            "Board rank",
            "not on our board" if market.board_rank is None else f"{market.board_rank} overall{position_rank}",
        ),
        ("ADP", "none" if market.adp is None else f"{js_string(market.adp)}{by_adp}"),
    )


def render_facts_block(facts: "PlayerFacts") -> str:
    """The block as stored: one `Label: value` line per fact."""
    return "\n".join(f"{label}: {value}" for label, value in facts_lines(facts))
