"""THE CAPSULE GATE: the board's capsules as the nightly holds them, before a run goes live.

The founder's rule: every non-stat sentence on a page comes from the writer, and a stock sentence
across players is a defect. The run fails when
- the board's unwritten pages pass `unwritten_share_max` (2%) of the board: a facts block (the
  fallback for a player the writer could not serve, `capsules.facts_block`), a row still on the
  oracle's template, or no row at all; or
- any sentence of four words or more (`shared_sentence_min_words`) of a written capsule appears on
  two players' pages (compared normalized, as the repetition measures compare, across both sizes of
  every written read on the board). Shorter ones, "Draft him." and "Let him go.", are the
  product's vocabulary, not stock prose; or
- any six words in a row (`capsules.spans`, case folded, punctuation stripped, player and club names
  breaking the run) still appear on `stock_span_pages` (three) players' written pages or more once the
  repairs have run: a stock phrase, not coincidence (the live review's M1, as the coordinator ruled
  it). A span on exactly two pages is counted and queued for the repair but does not fail the run,
  and a span a fact sheet prints itself (a label or a stat name copied word for word) is exempt.
  Each page's shared spans are kept, joined where they overlap, for the repair's prompt.

Phase D extends this gate (the page findings of `capsules.pull_figures`, the run's other gates);
the nightly's capsule step runs it after the sweep.
"""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from datetime import datetime
from types import MappingProxyType
from typing import Final

from sqlalchemy import Connection, text

from research.capsules.config import CAPSULE_CONFIG
from research.capsules.facts.board import board_rows
from research.capsules.facts.collect import universe_ids_for
from research.capsules.facts_block import FACTS_SOURCE
from research.capsules.narrative import normalize_sentence, sentences_verbatim
from research.capsules.render import render_facts_for_model
from research.capsules.spans import (
    Runs,
    SharedSpan,
    SpanRules,
    name_words,
    page_runs,
    phrases_on_page,
    shared_spans,
    sheet_spans,
)
from research.capsules.store import WRITTEN_SOURCE, StoredCapsule, stored_capsules_for
from research.capsules.sweep import subjects_of
from research.season import PRODUCT_SEASON

_EXAMPLES: Final = 5


@dataclass(frozen=True, slots=True)
class SharedSentence:
    sentence: str
    player_ids: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class CapsuleGateResult:
    board_players: int
    written: int
    facts_blocks: int
    template: int
    missing: int
    shared: tuple[SharedSentence, ...]
    # Every span on two pages or more that no fact sheet prints, queued for the repair.
    spans: tuple[SharedSpan, ...] = ()
    # Each page that carries a shared span, to its shared spans joined where they overlap.
    span_phrases: Mapping[str, tuple[str, ...]] = field(default_factory=lambda: MappingProxyType({}))
    # Spans two pages or more share that a fact sheet prints, so not judged.
    exempt_spans: int = 0
    share_max: float = CAPSULE_CONFIG.unwritten_share_max
    stock_span_pages: int = CAPSULE_CONFIG.stock_span_pages

    @property
    def stock_spans(self) -> tuple[SharedSpan, ...]:
        """The spans that fail the run: on `stock_span_pages` pages or more."""
        return tuple(s for s in self.spans if len(s.player_ids) >= self.stock_span_pages)

    @property
    def unwritten_share(self) -> float:
        unwritten = self.board_players - self.written
        return 0.0 if self.board_players == 0 else unwritten / self.board_players

    @property
    def ok(self) -> bool:
        return self.unwritten_share <= self.share_max and not self.shared and not self.stock_spans

    def summary(self) -> str:
        verdict = "passed" if self.ok else "failed"
        line = (
            f"capsule gate: {verdict}, {self.board_players} board pages, {self.written} written, "
            f"{self.facts_blocks} facts blocks, {self.template} on the oracle's template, {self.missing} missing "
            f"({self.unwritten_share:.1%} unwritten, the line {self.share_max:.0%}), "
            f"{len(self.shared)} written sentences on two pages, {len(self.spans)} six-word spans on two pages or "
            f"more ({len(self.span_phrases)} pages carry one, queued for repair), {len(self.stock_spans)} on "
            f"{self.stock_span_pages} pages or more (failing), {self.exempt_spans} sheet labels exempt"
        )
        examples = "; ".join(
            [
                *(f'"{s.sentence}" on {len(s.player_ids)} pages' for s in self.shared[:_EXAMPLES]),
                *(f'span "{s.span}" on {len(s.player_ids)} pages' for s in self.spans[:_EXAMPLES]),
            ]
        )
        return line if not examples else f"{line}: {examples}"


def _sentences(row: StoredCapsule) -> set[str]:
    """The read's sentences held to uniqueness: normalized, and of at least the minimum length."""
    normalized = {normalize_sentence(s) for body in (row.body_compact, row.body_full) for s in sentences_verbatim(body)}
    return {s for s in normalized if len(s.split()) >= CAPSULE_CONFIG.shared_sentence_min_words}


def shared_written_sentences(rows: Mapping[str, StoredCapsule]) -> tuple[SharedSentence, ...]:
    """Every sentence of four words or more of a written capsule that another written page carries too."""
    pages: dict[str, list[str]] = {}
    for player_id, row in rows.items():
        if row.source == WRITTEN_SOURCE:
            for sentence in _sentences(row):
                pages.setdefault(sentence, []).append(player_id)
    shared = [SharedSentence(sentence, tuple(sorted(ids))) for sentence, ids in pages.items() if len(ids) > 1]
    return tuple(sorted(shared, key=lambda s: (-len(s.player_ids), s.sentence)))


def _written_runs(rows: Mapping[str, StoredCapsule], names: frozenset[str]) -> dict[str, Runs]:
    return {
        pid: page_runs((row.body_compact, row.body_full), names)
        for pid, row in rows.items()
        if row.source == WRITTEN_SOURCE
    }


def judge_capsules(board_ids: Sequence[str], rows: Mapping[str, StoredCapsule], rules: SpanRules) -> CapsuleGateResult:
    """The gate over the board's universe ids and their stored rows, spans judged by `rules`."""
    on_board = {pid: rows[pid] for pid in board_ids if pid in rows}
    sources = [row.source for row in on_board.values()]
    runs = _written_runs(on_board, rules.names)
    spans = shared_spans(runs, rules.exempt)
    exempt = len(shared_spans(runs)) - len(spans)
    held = frozenset(s.span for s in spans)
    carriers = {pid for s in spans for pid in s.player_ids}
    return CapsuleGateResult(
        board_players=len(board_ids),
        written=sources.count(WRITTEN_SOURCE),
        facts_blocks=sources.count(FACTS_SOURCE),
        template=len(sources) - sources.count(WRITTEN_SOURCE) - sources.count(FACTS_SOURCE),
        missing=len(board_ids) - len(on_board),
        shared=shared_written_sentences(on_board),
        spans=spans,
        span_phrases=MappingProxyType({pid: phrases_on_page(runs[pid], held) for pid in sorted(carriers)}),
        exempt_spans=exempt,
    )


def board_universe_ids(conn: Connection, as_of: datetime) -> list[str]:
    """The board's pages as the capsules key them (the universe id), in served order."""
    provider_ids = [row.player_id for row in board_rows(conn, PRODUCT_SEASON, as_of)]
    universe = universe_ids_for(conn, provider_ids)
    return list(dict.fromkeys(universe[pid] for pid in provider_ids if pid in universe))


def span_names(conn: Connection) -> frozenset[str]:
    """The words that break a span: every player's name in the store, and every club's."""
    return name_words(str(name) for name in conn.execute(text("select name from research.provider_players")).scalars())


def span_rules(conn: Connection, as_of: datetime) -> SpanRules:
    """The names, and every span the board's fact sheets print at `as_of` (the exemption)."""
    names = span_names(conn)
    sheets = (render_facts_for_model(subject.facts) for subject in subjects_of(conn, as_of))
    return SpanRules(names, sheet_spans(sheets, names))


def capsule_gate(conn: Connection, as_of: datetime) -> CapsuleGateResult:
    """The gate over the board as served at `as_of` (its pages keyed on the universe id)."""
    board_ids = board_universe_ids(conn, as_of)
    return judge_capsules(board_ids, stored_capsules_for(conn, board_ids), span_rules(conn, as_of))
