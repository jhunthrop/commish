"""HE CANNOT LOSE MORE THAN HE SCORES: a per-game cost or gain put on the player is held to his own
points a game (the coordinator's M3 ruling, Lane 52).

A law's figure on the sheet is a population average: among players in his spot, how far points a game
moved from one season to the next, summed over the group's laws (`facts.evidence`, the matched
difference-in-differences of `research-ts/src/projections/laws/harness.ts`). Written as "costs him
13.7 points a game" on a back scoring 8.9, a reader takes it as his own points. So a per-game figure
the prose puts on him with a cost or gain word ("costs him", "docks him", "adds", "gains", the cost
words) is refused when it is larger than his own points a game: the largest per-game figure the sheet
prints for him (this season's, last season's, or our preseason number over the games we expected).
The average written as an average ("among players in his spot, points a game fell 13.7") passes.
"""

import re
from typing import TYPE_CHECKING, Final

from research.capsules.sentences import split_sentences
from research.pipeline.jscompat import js_string

if TYPE_CHECKING:
    from research.capsules.facts.build import PlayerFacts

OWN_RATE_VIOLATION: Final = "The text puts a per-game figure on him that is larger than his own points a game"
_VERBS: Final = (
    r"costs?|costing|docks?|docked|docking|shaves?|shaving|minus|down|adds?|adding|gains?|gaining|takes?|taking"
)
_HEDGES: Final = r"(?:about|another|roughly|nearly|around|almost|close to|an extra|a further|over|more than)"
_ATTRIBUTED: Final = re.compile(
    rf"\b(?:{_VERBS})\b(?:\s+(?:him|his\s+\w+|you))?(?:\s+{_HEDGES})?\s+"
    r"(?P<figure>\d+(?:\.\d+)?)\s*(?:fantasy\s+)?(?:points?\s+)?(?:a|per)\s+game\b",
    re.IGNORECASE,
)


def own_points_per_game(facts: "PlayerFacts") -> float | None:
    """His own points a game: the largest per-game figure the sheet prints for him, or None with none."""
    rates = [
        rate
        for rate in (
            None if facts.season is None else facts.season.points_per_game,
            None if facts.last_season_story is None else facts.last_season_story.points_per_game,
        )
        if rate is not None
    ]
    availability = facts.availability
    if availability is not None and round(availability.expected_games) >= 1:
        rates.append(round(facts.projection.projected_points) / round(availability.expected_games))
    return max(rates) if rates else None


def own_rate_violations(text: str, own: float | None) -> list[str]:
    """Every per-game cost or gain the text puts on him that is larger than `own`, one per sentence."""
    if own is None:
        return []
    violations = []
    for sentence in split_sentences(text):
        match = next((m for m in _ATTRIBUTED.finditer(sentence) if float(m.group("figure")) > own), None)
        if match is not None:
            violations.append(
                f'{OWN_RATE_VIOLATION}: "{match.group(0)}" in the sentence "{sentence}". He scores '
                f"{js_string(round(own, 1))} points a game, and he cannot lose or gain more than he scores. The "
                "law's figure is an average change among players in his spot: say it that way, or leave the "
                "figure out."
            )
    return violations
