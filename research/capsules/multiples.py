"""A MULTIPLE IS A CLAIM: "double", "twice", "half", "triple" and their kin only where the figures make it.

Lane 52's review (M2): the sample's best capsule read "22 points a game, almost double our preseason
pace of 14.1". 22 is 1.56 times 14.1, and the multiple is a figure the sheet never prints, said in
words, so the number rules could not see it. A multiple is refused unless two figures in its sentence,
or the sentence before it ("he is running at barely half of that"), stand within a tenth of the ratio
it names (a hedge, "almost double", gets no wider room).

What counts as a multiple (the re-review's N5 and N6, ruled):
- a verb that names one: "doubled", "doubles", "tripled", "triples", "halved", "halves";
- "2x" or "3x", and "one and a half times";
- "double", "twice", "triple", "half", "two times" or "three times" comparing two figures: before "as"
  ("twice as many"), before what was expected or "that" standing alone ("half of what we expected",
  "half of that"), before a figure's name ("double our number", "twice his pace", "triple the
  projection"), or before a per-game figure ("triple the 4.1 a game we expected").
Never "half of his targets", "half a chance", "half the season", a "double-digit" week, a "double
team", "he scored twice".
"""

import re
from collections.abc import Iterable
from itertools import combinations
from typing import Final

from research.capsules.grounding import extract_numbers
from research.capsules.sentences import split_sentences

MULTIPLE_VIOLATION: Final = "The text calls one figure a multiple of another"
_TOLERANCE: Final = 0.1
_VERB_RATIOS: Final = {
    "doubled": 2.0,
    "doubles": 2.0,
    "tripled": 3.0,
    "triples": 3.0,
    "halved": 2.0,
    "halves": 2.0,
}
_WORD_RATIOS: Final = {
    "double": 2.0,
    "twice": 2.0,
    "half": 2.0,
    "two times": 2.0,
    "triple": 3.0,
    "three times": 3.0,
}
# The names of figures a multiple compares: a pace, a number, a projection, an average.
_FIGURE_NAMES: Final = (
    r"number|numbers|pace|projection|expectation|expectations|average|rate|mark|total|output|figure|"
    r"scoring|production|preseason\s+number|preseason\s+pace"
)
_COMPARED: Final = (
    r"\s+(?:as\b"
    r"|(?:of\s+)?what\b"
    r"|(?:of\s+)?(?:that|those)(?=\s*(?:[,.;:!?]|$|\s+(?:a|per)\s+game))"
    rf"|(?:of\s+)?(?:our|his|her|their|the|its|that)\s+(?:[a-z0-9'-]+\s+){{0,2}}?(?:{_FIGURE_NAMES})\b"
    r"|(?:of\s+)?(?:our|his|her|their|the|its)\s+\d+(?:\.\d+)?\s*(?:points?\s+)?(?:a|per)\s+game\b)"
)
_MULTIPLE: Final = re.compile(
    rf"\b(?P<verb>{'|'.join(_VERB_RATIOS)})\b"
    r"|\b(?P<times>[23])x\b"
    r"|\b(?P<one_half>one and a half times)\b"
    rf"|\b(?P<word>{'|'.join(_WORD_RATIOS)})\b(?={_COMPARED})",
    re.IGNORECASE,
)
# A season or a year is a date, never one side of a multiple.
_YEARS: Final = range(1900, 2101)


def _figures(text: str) -> list[float]:
    return [
        abs(value)
        for _, value in extract_numbers(text)
        if value != 0 and not (float(value).is_integer() and int(value) in _YEARS)
    ]


def _made_by(ratio: float, figures: Iterable[float]) -> bool:
    return any(abs(max(a, b) / min(a, b) - ratio) <= ratio * _TOLERANCE for a, b in combinations(figures, 2))


def _ratio(match: re.Match[str]) -> float:
    if match.group("verb"):
        return _VERB_RATIOS[match.group("verb").lower()]
    if match.group("times"):
        return float(match.group("times"))
    if match.group("one_half"):
        return 1.5
    return _WORD_RATIOS[re.sub(r"\s+", " ", match.group("word").lower())]


def _claims(sentence: str) -> list[tuple[str, float]]:
    return [(match.group(0), _ratio(match)) for match in _MULTIPLE.finditer(sentence)]


def multiple_violations(text: str) -> list[str]:
    """Every comparison word the sentence's figures (or the sentence before's) do not make."""
    violations = []
    sentences = split_sentences(text)
    for index, sentence in enumerate(sentences):
        # The multiple's own words never stand as a figure ("2x" is not a 2).
        bare = _MULTIPLE.sub(" ", sentence)
        figures = _figures(bare) + (_figures(sentences[index - 1]) if index else [])
        violations += [
            f'{MULTIPLE_VIOLATION}, "{phrase}", in the sentence "{sentence}". No two figures there stand in '
            f"that ratio: give the two figures and leave the multiple out."
            for phrase, ratio in _claims(sentence)
            if not _made_by(ratio, figures)
        ]
    return violations
