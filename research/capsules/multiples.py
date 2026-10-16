"""A MULTIPLE IS A CLAIM: "double", "twice", "half" or "triple" only where the figures make it.

Lane 52's review (M2): the sample's best capsule read "22 points a game, almost double our preseason
pace of 14.1". 22 is 1.56 times 14.1, and the multiple is a figure the sheet never prints, said in
words, so the number rules could not see it. A comparison word is refused unless two figures in its
sentence, or the sentence before it ("he is running at barely half of that"), stand within a tenth
of the ratio it names. A hedge ("almost double") gets no wider room. The word's other senses pass: a
"double-digit" week, a "double team", the "second half" of a season, "he scored twice".
"""

import re
from collections.abc import Iterable
from itertools import combinations
from typing import Final

from research.capsules.grounding import extract_numbers
from research.capsules.sentences import split_sentences

MULTIPLE_VIOLATION: Final = "The text calls one figure a multiple of another"
_RATIOS: Final = {"double": 2.0, "doubled": 2.0, "twice": 2.0, "half": 2.0, "triple": 3.0, "tripled": 3.0}
_TOLERANCE: Final = 0.1
_HEDGE: Final = r"(?:(?:almost|nearly|about|roughly|barely|just|more than|less than|over|under|close to)\s+)"
_OBJECT: Final = r"(?:of\s+)?(?:as|the|his|her|that|what|our|its|their|him|it|this|those|a|an)\b"
# A comparison: a verb that names the multiple ("his targets doubled"), or the word before its object
# ("double his", "half of that", "twice as many"), or a hedged one ("almost double").
_MULTIPLE: Final = re.compile(
    rf"\b(?P<word>doubled|tripled)\b"
    rf"|(?<!first )(?<!second )(?<!back )(?<!front )(?<!other )(?<!later )(?<!early )"
    rf"\b(?P<hedge>{_HEDGE})?(?P<cmp>double|twice|triple|half)\b(?P<object>\s+{_OBJECT})?",
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


def _claims(sentence: str) -> list[tuple[str, float]]:
    found = []
    for match in _MULTIPLE.finditer(sentence):
        word = (match.group("word") or match.group("cmp")).lower()
        if match.group("word") is None and match.group("hedge") is None and match.group("object") is None:
            continue
        found.append((match.group(0).strip(), _RATIOS[word]))
    return found


def multiple_violations(text: str) -> list[str]:
    """Every comparison word the sentence's figures (or the sentence before's) do not make."""
    violations = []
    sentences = split_sentences(text)
    for index, sentence in enumerate(sentences):
        figures = _figures(sentence) + (_figures(sentences[index - 1]) if index else [])
        violations += [
            f'{MULTIPLE_VIOLATION}, "{phrase}", in the sentence "{sentence}". No two figures there stand in '
            f"that ratio: give the two figures and leave the multiple out."
            for phrase, ratio in _claims(sentence)
            if not _made_by(ratio, figures)
        ]
    return violations
