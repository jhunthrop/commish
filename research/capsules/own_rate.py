"""HE CANNOT LOSE MORE THAN HE SCORES: a per-game cost or gain put on the player is held to his own
points a game (the coordinator's M3 ruling, Lane 52).

A law's figure on the sheet is a population average: among players in his spot, how far points a game
moved from one season to the next, summed over the group's laws (`facts.evidence`, the matched
difference-in-differences of `research-ts/src/projections/laws/harness.ts`). Written as "costs him
13.7 points a game" on a back scoring 8.9, a reader takes it as his own points. So a per-game figure
the prose puts on him with a cost or gain word ("costs him", "docks him", "adds", "gains", the cost
words) is refused when it is larger than his own points a game. His own points a game (ruled for the
re-review's N4) is this season's when the sheet prints it, else the largest per-game figure the sheet
prints for him (last season's, or our preseason number over the games we expected). The rule reads
the verbs that put a figure on him (the cost words, "loses", "sets him back", "subtracts", "adds",
"gains", "takes"), a word or two before the figure ("a full", "a hefty"), and the units "a game",
"per game", "every game", "each game", "pts/game" and "ppg" (the re-review's N3). The average written
as an average ("among players in his spot, points a game fell 13.7") passes.
"""

import re
from typing import TYPE_CHECKING, Final

from research.capsules.sentences import split_sentences
from research.pipeline.jscompat import js_string

if TYPE_CHECKING:
    from research.capsules.facts.build import PlayerFacts

OWN_RATE_VIOLATION: Final = "The text puts a per-game figure on him that is larger than his own points a game"
_VERBS: Final = (
    r"costs?|costing|docks?|docked|docking|shaves?|shaved|shaving|minus|down|adds?|added|adding|gains?|gained|"
    r"gaining|takes?|taking|loses?|losing|lost|subtracts?|subtracted|subtracting|sets?\s+(?:him\s+)?back"
)
# A word or two between the verb (and "him") and the figure, never the people an average is among.
_FILLER: Final = r"(?:\s+(?!players\b|backs\b|receivers\b|ends\b|quarterbacks\b|others\b|those\b)[a-z'-]+){0,2}?"
_UNIT: Final = r"(?:fantasy\s+)?(?:points?|pts)?\s*(?:(?:a|per|every|each)\s+game\b|/\s*game\b)|ppg\b"
_ATTRIBUTED: Final = re.compile(
    rf"\b(?:{_VERBS})\b(?:\s+(?:him|his\s+\w+|you))?{_FILLER}\s+(?P<figure>\d+(?:\.\d+)?)\s*(?:{_UNIT})",
    re.IGNORECASE,
)


def own_points_per_game(facts: "PlayerFacts") -> float | None:
    """His own points a game: this season's when the sheet prints it, else the largest per-game figure it
    prints for him, or None with none."""
    if facts.season is not None and facts.season.points_per_game is not None:
        return facts.season.points_per_game
    rates = [] if facts.last_season_story is None else [facts.last_season_story.points_per_game]
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
