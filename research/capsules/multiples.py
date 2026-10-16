"""A MULTIPLE IS A CLAIM: "double", "twice", "half", "triple" and their kin only where the figures make it.

Lane 52's review (M2): the sample's best capsule read "22 points a game, almost double our preseason
pace of 14.1". 22 is 1.56 times 14.1, and the multiple is a figure the sheet never prints, said in
words, so the number rules could not see it. A multiple is refused unless two figures in its sentence,
or the sentence before it ("he is running at barely half of that"), stand within a tenth of the ratio
it names (a hedge, "almost double", gets no wider room).

What counts as a multiple (the re-reviews' N5, N6 and R2-H1, ruled):
- a verb that names one: "doubled", "doubles", "tripled", "triples", "halved", "halves";
- "2x" or "3x", and "one and a half times";
- "double", "twice", "triple", "half", "two times" or "three times" when hedged ("almost double", "close
  to half") or followed by an object ("double it", "twice the 14.1", "half of his 14.1", "twice as many"),
  whatever comes after.
Exempt, by name only, the non-comparisons: "half" of a named counted thing with no figure after it
("half of his targets", "half of his 12 catches", "half the season"; the list is `_COUNTED`) in a
sentence, and the one before it, that holds no other figure: a week or season marker is a date, not a
figure, and the count inside the phrase is its own), "half a chance",
"twice a week", a "double-digit" week, a "double team", "double coverage", the "second half", and "he
scored twice" (no object, no hedge).
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
_HEDGE: Final = r"(?:almost|nearly|about|roughly|barely|just|more than|less than|over|under|close to)"
_OBJECT: Final = r"\s+(?:of\s+)?(?:as|the|his|her|that|what|our|its|their|him|it|this|those|a|an)\b"
_MULTIPLE: Final = re.compile(
    rf"\b(?P<verb>{'|'.join(_VERB_RATIOS)})\b"
    r"|\b(?P<times>[23])x\b"
    r"|\b(?P<one_half>one and a half times)\b"
    r"|(?<!first )(?<!second )(?<!back )(?<!front )(?<!other )(?<!later )(?<!early )"
    rf"\b(?P<hedge>{_HEDGE}\s+)?(?P<word>{'|'.join(_WORD_RATIOS)})\b(?P<object>{_OBJECT})?",
    re.IGNORECASE,
)
# The counted things "half" may be half of without comparing two figures (the re-review's R3-H1,
# ruled): exempt by name, and only when no figure follows in the sentence.
_COUNTED: Final = (
    r"targets|snaps|carries|touches|routes|games|season|field|team|guys|drives|"
    r"catches|receptions|yards|attempts|passes|completions|looks"
)
_HALF_OF_A_COUNT: Final = re.compile(
    rf"half\s+(?:of\s+)?(?:his|her|their|the|our|its)\s+(?:\d+\s+)?(?:{_COUNTED})\b", re.IGNORECASE
)
# A week or season marker is a date, never a figure that follows the counted noun ("in week 2 of 2026").
_WEEK_MARKER: Final = re.compile(r"\bweeks?\s+\d+(?:\s*(?:,|and|or|to|through|-)\s*\d+)*", re.IGNORECASE)
# The other non-comparisons, read from the comparison word on, each exempt by name.
_NOT_A_COMPARISON: Final = re.compile(
    r"half\s+an?\s+(?!\d)[a-z]"
    r"|twice\s+an?\s+(?:week|game|day|month|season|year|quarter|half|night)\b"
    r"|double[\s-](?:digits?|teams?|teamed|coverage)\b",
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


def _is_claim(match: re.Match[str], sentence: str, before: str) -> bool:
    if match.group("word") is None:
        return True
    if match.group("hedge") is None and match.group("object") is None:
        return False
    if _NOT_A_COMPARISON.match(sentence, match.start("word")) is not None:
        return False
    count = _HALF_OF_A_COUNT.match(sentence, match.start("word"))
    if count is None:
        return True
    # A counted noun exempts only a sentence (and the one before it, as `_made_by` reads) that holds no
    # figure but the count inside the match, a week marker or a year (the re-review's R4-H1).
    rest = f"{before} {sentence[: count.start()]} {sentence[count.end() :]}"
    return bool(_figures(_WEEK_MARKER.sub(" ", rest)))


def _claims(sentence: str, before: str = "") -> list[tuple[str, float]]:
    return [
        (match.group(0).strip(), _ratio(match))
        for match in _MULTIPLE.finditer(sentence)
        if _is_claim(match, sentence, before)
    ]


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
            for phrase, ratio in _claims(sentence, sentences[index - 1] if index else "")
            if not _made_by(ratio, figures)
        ]
    return violations
