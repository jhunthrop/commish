"""THE CAPSULE GATE: the board's capsules as the nightly holds them, before a run goes live.

The founder's rule: every non-stat sentence on a page comes from the writer, and a stock sentence
across players is a defect. The run fails when
- the board's unwritten pages (a page held over a rewrite that fell keeps its written capsule, so it
  is written, Lane 294) pass the run's line (`CapsuleConfig.unwritten_line`: 2% before the
  season's first kickoff, 3% from it on, the run's date deciding): a facts block (the
  fallback for a player the writer could not serve, `capsules.facts_block`), a row still on the
  oracle's template, or no row at all; or
- any sentence of four words or more (`shared_sentence_min_words`) of a written capsule appears on
  two players' pages (compared normalized, as the repetition measures compare, across both sizes of
  every written read on the board). Shorter ones, "Draft him." and "Let him go.", are the
  product's vocabulary, not stock prose; or
- never for six words in a row (`capsules.spans`, case folded, punctuation stripped, player and club
  names breaking the run) on two or more pages (the live review's M1, as the coordinator ruled it):
  those are counted, named and repaired within the budget, never a failure. A span the facts
  print (a rendered sheet or a facts block: a figure's basis or a stat's label copied word for word,
  `capsules.span_rules`) is exempt, and so is a whole sentence the facts print (Lane 73 ruling 3). Spans read the narrative sentences too; the whole-sentence rule reads the two reads only.
  Each page's shared spans are kept, joined where they overlap, for the repair's prompt.

Phase D extends this gate (the page findings of `capsules.pull_figures`, the run's other gates);
the nightly's capsule step runs it after the sweep.
"""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from datetime import datetime
from types import MappingProxyType
from typing import Final

from sqlalchemy import Connection

from research.capsules.config import CAPSULE_CONFIG, UnwrittenLine
from research.capsules.facts.board import board_rows
from research.capsules.facts.collect import universe_ids_for
from research.capsules.facts.season_so_far import in_season
from research.capsules.facts_block import FACTS_SOURCE
from research.capsules.narrative import held_sentences
from research.capsules.span_rules import span_rules_for
from research.capsules.spans import (
    Runs,
    SharedSpan,
    SpanRules,
    page_runs,
    page_texts,
    phrases_on_page,
    shared_spans,
)
from research.capsules.store import WRITTEN_SOURCE, StoredCapsule, stored_capsules_for
from research.capsules.sweep import Subjects
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
    # The run's unwritten line (`CapsuleConfig.unwritten_line`), required: a gate never assumes one.
    line: UnwrittenLine
    # Every span on two pages or more that no fact sheet prints, queued for the repair.
    spans: tuple[SharedSpan, ...] = ()
    # Each page that carries a shared span, to its shared spans joined where they overlap.
    span_phrases: Mapping[str, tuple[str, ...]] = field(default_factory=lambda: MappingProxyType({}))
    # The carriers eligible for a span rewrite (every one but the first in board order); the night
    # rewrites as many as its budget reaches.
    queued: int = 0
    # Spans two pages or more share that the sheets' labelled stats print, so not judged.
    exempt_spans: int = 0
    # The writer's one loud line when the run's throttle pool ran dry (`throttle_waits`), carried here so
    # the publish gate's summary says why pages fell to facts.
    throttle_alarm: str | None = None
    # The pages the capsule step demoted tonight to their facts blocks for a sentence still on two pages
    # after the graced rewrite (`capsule_demotion`), counted among the facts blocks and so unwritten.
    demoted: int = 0
    # The written pages whose rewrite fell tonight and that keep their written capsule (the hold path,
    # `capsules.sweep`): counted written, since the page still shows a written read (Lane 294 ruling 3).
    held: int = 0
    # Held pages whose old prose failed tonight's page gate and fell to their facts blocks
    # (`_Passes.check_held`): counted among the facts blocks, so unwritten, never a failure on their own.
    held_stale: int = 0

    @property
    def unwritten_share(self) -> float:
        unwritten = self.board_players - self.written
        return 0.0 if self.board_players == 0 else unwritten / self.board_players

    @property
    def ok(self) -> bool:
        # Spans are counted and repaired, never a failure (the coordinator's Lane 17 ruling 1).
        return self.unwritten_share <= self.line.share_max and not self.shared

    def _demoted_note(self) -> str:
        return "" if not self.demoted else f" ({self.demoted} demoted tonight for a sentence on two pages)"

    def _held_note(self) -> str:
        return "" if not self.held else f" ({self.held} held over a rewrite that fell tonight)"

    def _stale_note(self) -> str:
        if not self.held_stale:
            return ""
        return f" ({self.held_stale} held and stale: their old prose failed tonight's page gate)"

    def summary(self) -> str:
        verdict = "passed" if self.ok else "failed"
        line = (
            f"capsule gate: {verdict}, {self.board_players} board pages, {self.written} written{self._held_note()}, "
            f"{self.facts_blocks} facts blocks{self._demoted_note()}{self._stale_note()}, {self.template} on the oracle's template, "
            f"{self.missing} missing "
            f"({self.unwritten_share:.1%} unwritten, the {self.line.voice} line {self.line.share_max:.0%}: "
            f"{self.line.basis}), "
            f"{len(self.shared)} written sentences on two pages, {len(self.spans)} six-word spans on two pages or "
            f"more, never a failure ({len(self.span_phrases)} pages carry one, {self.queued} eligible for a span "
            "rewrite: every carrier but the first, as the budget reaches them), "
            f"{self.exempt_spans} spans the facts print exempt"
        )
        examples = "; ".join(
            [
                *(f'"{s.sentence}" on {len(s.player_ids)} pages' for s in self.shared[:_EXAMPLES]),
                *(f'span "{s.span}" on {len(s.player_ids)} pages' for s in self.spans[:_EXAMPLES]),
            ]
        )
        line = line if not examples else f"{line}: {examples}"
        return line if self.throttle_alarm is None else f"{self.throttle_alarm}; {line}"


def _sentences(row: StoredCapsule) -> set[str]:
    """The read's sentences held to uniqueness: normalized, and of at least the minimum length."""
    return held_sentences((row.body_compact, row.body_full), CAPSULE_CONFIG.shared_sentence_min_words)


def shared_written_sentences(
    rows: Mapping[str, StoredCapsule], exempt: frozenset[str] = frozenset()
) -> tuple[SharedSentence, ...]:
    """Every sentence of four words or more of a written capsule that another written page carries too,
    but a sentence the facts print (`exempt`, `SpanRules.exempt_sentences`, Lane 73 ruling 3)."""
    pages: dict[str, list[str]] = {}
    for player_id, row in rows.items():
        if row.source == WRITTEN_SOURCE:
            for sentence in _sentences(row) - exempt:
                pages.setdefault(sentence, []).append(player_id)
    shared = [SharedSentence(sentence, tuple(sorted(ids))) for sentence, ids in pages.items() if len(ids) > 1]
    return tuple(sorted(shared, key=lambda s: (-len(s.player_ids), s.sentence)))


def _written_runs(rows: Mapping[str, StoredCapsule], names: frozenset[str]) -> dict[str, Runs]:
    return {
        pid: page_runs(page_texts(row.body_compact, row.body_full, row.narrative), names)
        for pid, row in rows.items()
        if row.source == WRITTEN_SOURCE
    }


def judge_capsules(
    board_ids: Sequence[str], rows: Mapping[str, StoredCapsule], rules: SpanRules, line: UnwrittenLine
) -> CapsuleGateResult:
    """The gate over the board's universe ids and their stored rows, spans judged by `rules`, the
    unwritten share held to `line`."""
    on_board = {pid: rows[pid] for pid in board_ids if pid in rows}
    sources = [row.source for row in on_board.values()]
    runs = _written_runs(on_board, rules.names)
    spans = shared_spans(runs, rules.exempt)
    exempt = len(shared_spans(runs)) - len(spans)
    held = frozenset(s.span for s in spans)
    carriers = {pid for s in spans for pid in s.player_ids}
    queued = repair_targets([s.player_ids for s in spans], board_ids)
    return CapsuleGateResult(
        board_players=len(board_ids),
        written=sources.count(WRITTEN_SOURCE),
        facts_blocks=sources.count(FACTS_SOURCE),
        template=len(sources) - sources.count(WRITTEN_SOURCE) - sources.count(FACTS_SOURCE),
        missing=len(board_ids) - len(on_board),
        shared=shared_written_sentences(on_board, rules.exempt_sentences),
        spans=spans,
        span_phrases=MappingProxyType({pid: phrases_on_page(runs[pid], held) for pid in sorted(carriers)}),
        queued=len(queued),
        exempt_spans=exempt,
        line=line,
    )


def board_universe_ids(conn: Connection, as_of: datetime) -> list[str]:
    """The board's pages as the capsules key them (the universe id), in served order."""
    provider_ids = [row.player_id for row in board_rows(conn, PRODUCT_SEASON, as_of)]
    universe = universe_ids_for(conn, provider_ids)
    return list(dict.fromkeys(universe[pid] for pid in provider_ids if pid in universe))


def repair_targets(holders: Sequence[tuple[str, ...]], board_order: Sequence[str]) -> list[str]:
    """Every page but the first (in board order) of each shared sentence or span (`holders`, each one's
    pages), each once, in board order: the first keeps it, so each pass strictly shrinks the set."""
    place = {player_id: index for index, player_id in enumerate(board_order)}
    rewrite: set[str] = set()
    for player_ids in holders:
        ordered = sorted(player_ids, key=lambda pid: place.get(pid, len(place)))
        rewrite.update(ordered[1:])
    return sorted(rewrite, key=lambda pid: place.get(pid, len(place)))


def span_rules(conn: Connection, as_of: datetime, subjects_at: Subjects) -> SpanRules:
    """The span rules for the board's sheets at `as_of`, read from the night's facts pass (`subjects_at`,
    the step's `FactsPassMemo`): build once a night, they are fixed by the instant."""
    return span_rules_for(conn, (subject.facts for subject in subjects_at(conn, as_of)))


def capsule_gate(conn: Connection, as_of: datetime, rules: SpanRules) -> CapsuleGateResult:
    """The gate over the board as served at `as_of` (its pages keyed on the universe id)."""
    board_ids = board_universe_ids(conn, as_of)
    line = CAPSULE_CONFIG.unwritten_line(in_season=in_season(conn, PRODUCT_SEASON, as_of))
    return judge_capsules(board_ids, stored_capsules_for(conn, board_ids), rules, line)
