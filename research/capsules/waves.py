"""THE WAVE GATE: how the sweep writes pages concurrently and keeps the repetition checks honest.

Written one at a time, each writer call was told the six-word spans tonight's earlier pages already
share (`spans.TonightSpans`), so it saw every page that finished before it started. Written
concurrently, two pages in flight at once cannot see each other. The sweep therefore writes in
waves of the pool's width (Lane 24's decision):

1. Every page of a wave is told the spans of every page that landed before the wave started, which
   is every page that finished before it started: the sequential guarantee, kept.
2. When the wave lands, its pages are checked against each other (`wave_collisions`): a written
   sentence or a six-word span two of them share is the one collision concurrency can add. It is
   counted on the sweep's report, and its carriers are left to the repair pass that already exists
   (`nightly.capsule_repair`), which reads the store and finds them like any other shared sentence
   or span. The gate's final judgment is unchanged: judged once after the last attempt.

The cost is that a span becoming repeated inside a wave is quoted to the writer one wave later (at
most `concurrency - 1` pages later than sequential writing would quote it), and a collision inside a
wave is repaired rather than avoided; the sweep's report counts both so a night shows what they cost.
"""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass

from research.capsules.narrative import held_sentences
from research.capsules.spans import SpanRules, page_runs, spans_of


def waves[T](items: Sequence[T], width: int) -> list[Sequence[T]]:
    """The items in order, cut into consecutive waves of at most `width`."""
    if width < 1:
        raise ValueError(f"a wave is at least one page wide, got {width}")
    return [items[i : i + width] for i in range(0, len(items), width)]


@dataclass(frozen=True, slots=True)
class WaveCollisions:
    """What one wave's own pages share with each other: the written sentences, the spans, and every
    page that carries one (left to the repair pass)."""

    sentences: int = 0
    spans: int = 0
    carriers: tuple[str, ...] = ()


def _shared(by_page: Mapping[str, set[str] | frozenset[str]]) -> tuple[int, set[str]]:
    holders: dict[str, list[str]] = {}
    for pid, items in by_page.items():
        for item in items:
            holders.setdefault(item, []).append(pid)
    shared = [ids for ids in holders.values() if len(ids) > 1]
    return len(shared), {pid for ids in shared for pid in ids}


def wave_collisions(
    pages: Mapping[str, Sequence[str]], reads: Mapping[str, Sequence[str]], rules: SpanRules, min_words: int
) -> WaveCollisions:
    """The collisions among one wave's written pages: `pages` holds each page's every prose text (both
    reads and the narrative, as spans read them), `reads` its two reads (as whole sentences are held)."""
    sentences, sentence_pages = _shared({pid: held_sentences(texts, min_words) for pid, texts in reads.items()})
    span_sets = {pid: spans_of(page_runs(texts, rules.names)) - rules.exempt for pid, texts in pages.items()}
    spans, span_pages = _shared(span_sets)
    return WaveCollisions(sentences, spans, tuple(sorted(sentence_pages | span_pages)))
