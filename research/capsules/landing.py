"""THE LANDING GATE: how the sweep writes pages concurrently and keeps the repetition checks honest.

Written one at a time, each writer call was told the six-word spans tonight's earlier pages already
share, so it saw every page that finished before it started. The sweep now keeps `concurrency`
pages in flight on a rolling pool (`gateway.GatewayClient.rolling`): a slot is refilled the moment
its page lands, and each page is told, when it starts, what the pages landed so far repeat
(`TonightWindow.repeated`), which is every page that finished before it started: the sequential
guarantee, kept (Lane 24, the coordinator's ruling of 2026-10-15, after the first wave-based night
spent its time waiting on each wave's slowest call).

What a page in flight cannot see is the pages that land while it is written. So each page is checked
as it lands (`TonightWindow.land`) against the pages already landed in the window: a written sentence
or a six-word span it shares with one of them is counted, and the page is a carrier left to the
repair pass that already exists (`nightly.capsule_repair`), which reads the store and finds it like
any other shared sentence or span (the page landed first keeps it, as every page but the first is
rewritten). The gate's judgment of each pass is unchanged.
"""

import threading
from collections import Counter, deque
from collections.abc import Mapping, Sequence
from dataclasses import dataclass

from research.capsules.narrative import held_sentences
from research.capsules.spans import SpanRules, page_runs, spans_of


class BoardSentences:
    """THE BOARD'S HELD SENTENCES as tonight leaves them, shared by every writer thread of a sweep:
    each written page's sentences (both reads, `min_words` long or longer), starting from the store
    and moved as each page is committed. Every rewrite of chosen pages (any `SweepPlan.only` pass: the
    shared-sentence repair, the graced rewrite and the span repair) claims its sentences exclusively
    (`claim(..., exclusive=True)`): a rewrite that would land a sentence another page already carries
    is refused and the page keeps its written read, so no rewrite can ever make a shared
    sentence (the production rerun of 2026-10-15 went from 13 to 39 shared sentences while its span
    repair rewrote 509 pages). Every other write records its sentences as it commits."""

    def __init__(self, pages: Mapping[str, Sequence[str]], min_words: int) -> None:
        self._lock = threading.Lock()
        self._min_words = min_words
        self._by_page: dict[str, frozenset[str]] = {}
        self._holders: dict[str, set[str]] = {}
        for pid, reads in pages.items():
            self._put(pid, frozenset(held_sentences(reads, min_words)))

    def _put(self, pid: str, sentences: frozenset[str]) -> None:
        for sentence in self._by_page.get(pid, frozenset()):
            self._holders[sentence].discard(pid)
        self._by_page[pid] = sentences
        for sentence in sentences:
            self._holders.setdefault(sentence, set()).add(pid)

    def claim(self, pid: str, reads: Sequence[str], *, exclusive: bool) -> bool:
        """Records the page's new sentences (none for a facts block: pass no reads), unless
        `exclusive` and one of them is already on another page, when nothing moves and False says
        the write must not land."""
        sentences = frozenset(held_sentences(reads, self._min_words))
        with self._lock:
            if exclusive and any(self._holders.get(s, set()) - {pid} for s in sentences):
                return False
            self._put(pid, sentences)
            return True


@dataclass(frozen=True, slots=True)
class Landing:
    """What one landed page shares with the pages landed before it in the window."""

    sentences: int = 0
    spans: int = 0

    @property
    def carrier(self) -> bool:
        return self.sentences > 0 or self.spans > 0


class TonightWindow:
    """The most recent `window` pages landed tonight: their spans (each page's, the sheet labels
    exempt) and their held sentences (both reads, `min_words` long or longer)."""

    def __init__(self, rules: SpanRules, window: int, min_words: int) -> None:
        self._rules = rules
        self._min_words = min_words
        self._pages: deque[tuple[frozenset[str], frozenset[str]]] = deque(maxlen=window)

    def repeated(self, cap: int) -> tuple[str, ...]:
        """The spans two or more landed pages already share, most widely first, for the next writer."""
        counts = Counter(span for spans, _ in self._pages for span in spans)
        shared = sorted((span for span, n in counts.items() if n > 1), key=lambda s: (-counts[s], s))
        return tuple(shared[:cap])

    def land(self, texts: Sequence[str], reads: Sequence[str]) -> Landing:
        """Adds a landed page (`texts`: every prose text of it; `reads`: its two reads) and returns
        what it shares with the pages landed before it."""
        spans = spans_of(page_runs(texts, self._rules.names)) - self._rules.exempt
        sentences = frozenset(held_sentences(reads, self._min_words))
        seen_spans = frozenset(s for page, _ in self._pages for s in page)
        seen_sentences = frozenset(s for _, page in self._pages for s in page)
        self._pages.append((spans, sentences))
        return Landing(len(sentences & seen_sentences), len(spans & seen_spans))
