"""LANE 266, HOW VARIED THE READS SOUND: distinct sentence openers across a set of written reads.

Each sentence is masked as the shape-duplicate rate masks it (`tally.ShapeMasks`: player names, clubs and
numbers become placeholders) so "Start Nacua" and "Start Chase" are one opener. Two figures over the same
reads: the distinct first words of every sentence, and the distinct first-three-word sequences, each also
for the reads' first sentences alone (how the reads open), and each per 100 reads. Distinct counts grow
slower than the reads they come from, so two arms are compared on the same players (`common_reads`).
"""

from collections import Counter
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Final

from research.capsules.narrative import sentences_verbatim
from research.explore.writer_bakeoff.tally import ShapeMasks

OPENER_WORDS: Final = 3
PER: Final = 100
TOP_OPENERS: Final = 8


@dataclass(frozen=True, slots=True)
class Variety:
    reads: int
    sentences: int
    distinct_first_words: int
    distinct_first_three: int
    distinct_read_first_words: int
    distinct_read_first_three: int
    first_words_per_100_reads: float
    first_three_per_100_reads: float
    read_first_three_per_100_reads: float
    # The most used read openers (first three words of the first sentence), with their counts.
    top_read_openers: tuple[tuple[str, int], ...]


def opener(sentence: str, masks: ShapeMasks, words: int) -> str:
    """The sentence's first `words` words, masked and normalized."""
    return " ".join(masks.shape(sentence).split()[:words])


def _per(count: int, reads: int) -> float:
    return PER * count / reads if reads else 0.0


def variety(reads: Mapping[str, str], masks: ShapeMasks) -> Variety:
    """Over `reads` (player id to written text): how many distinct ways their sentences and the reads open."""
    sentences = [s for text in reads.values() for s in sentences_verbatim(text)]
    firsts = [found[0] for text in reads.values() if (found := sentences_verbatim(text))]
    one = {opener(s, masks, 1) for s in sentences}
    three = {opener(s, masks, OPENER_WORDS) for s in sentences}
    read_three = Counter(opener(s, masks, OPENER_WORDS) for s in firsts)
    n = len(reads)
    return Variety(
        reads=n,
        sentences=len(sentences),
        distinct_first_words=len(one),
        distinct_first_three=len(three),
        distinct_read_first_words=len({opener(s, masks, 1) for s in firsts}),
        distinct_read_first_three=len(read_three),
        first_words_per_100_reads=_per(len(one), n),
        first_three_per_100_reads=_per(len(three), n),
        read_first_three_per_100_reads=_per(len(read_three), n),
        top_read_openers=tuple(read_three.most_common(TOP_OPENERS)),
    )


def common_reads(a: Mapping[str, str], b: Mapping[str, str]) -> tuple[dict[str, str], dict[str, str]]:
    """`a` and `b` cut to the players both carry, so their distinct counts compare on equal ground."""
    both = a.keys() & b.keys()
    return {k: v for k, v in a.items() if k in both}, {k: v for k, v in b.items() if k in both}
