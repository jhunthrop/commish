"""THE CAPSULE GATE: the board's capsules as the nightly holds them, before a run goes live.

The founder's rule: every non-stat sentence on a page comes from the writer, and a stock sentence
across players is a defect. The run fails when
- the board's unwritten pages pass `unwritten_share_max` (2%) of the board: a facts block (the
  fallback for a player the writer could not serve, `capsules.facts_block`), a row still on the
  oracle's template, or no row at all; or
- any sentence of four words or more (`shared_sentence_min_words`) of a written capsule appears on
  two players' pages (compared normalized, as the repetition measures compare, across both sizes of
  every written read on the board). Shorter ones, "Draft him." and "Let him go.", are the
  product's vocabulary, not stock prose.

Phase D extends this gate (the page findings of `capsules.pull_figures`, the run's other gates);
the nightly's capsule step runs it after the sweep.
"""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Final

from sqlalchemy import Connection

from research.capsules.config import CAPSULE_CONFIG
from research.capsules.facts.board import board_rows
from research.capsules.facts.collect import universe_ids_for
from research.capsules.facts_block import FACTS_SOURCE
from research.capsules.narrative import normalize_sentence, sentences_verbatim
from research.capsules.store import WRITTEN_SOURCE, StoredCapsule, stored_capsules_for
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
    share_max: float = CAPSULE_CONFIG.unwritten_share_max

    @property
    def unwritten_share(self) -> float:
        unwritten = self.board_players - self.written
        return 0.0 if self.board_players == 0 else unwritten / self.board_players

    @property
    def ok(self) -> bool:
        return self.unwritten_share <= self.share_max and not self.shared

    def summary(self) -> str:
        verdict = "passed" if self.ok else "failed"
        line = (
            f"capsule gate: {verdict}, {self.board_players} board pages, {self.written} written, "
            f"{self.facts_blocks} facts blocks, {self.template} on the oracle's template, {self.missing} missing "
            f"({self.unwritten_share:.1%} unwritten, the line {self.share_max:.0%}), "
            f"{len(self.shared)} written sentences on two pages"
        )
        examples = "; ".join(f'"{s.sentence}" on {len(s.player_ids)} pages' for s in self.shared[:_EXAMPLES])
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


def judge_capsules(board_ids: Sequence[str], rows: Mapping[str, StoredCapsule]) -> CapsuleGateResult:
    """The gate over the board's universe ids and their stored rows."""
    on_board = {pid: rows[pid] for pid in board_ids if pid in rows}
    sources = [row.source for row in on_board.values()]
    return CapsuleGateResult(
        board_players=len(board_ids),
        written=sources.count(WRITTEN_SOURCE),
        facts_blocks=sources.count(FACTS_SOURCE),
        template=len(sources) - sources.count(WRITTEN_SOURCE) - sources.count(FACTS_SOURCE),
        missing=len(board_ids) - len(on_board),
        shared=shared_written_sentences(on_board),
    )


def board_universe_ids(conn: Connection, as_of: datetime) -> list[str]:
    """The board's pages as the capsules key them (the universe id), in served order."""
    provider_ids = [row.player_id for row in board_rows(conn, PRODUCT_SEASON, as_of)]
    universe = universe_ids_for(conn, provider_ids)
    return list(dict.fromkeys(universe[pid] for pid in provider_ids if pid in universe))


def capsule_gate(conn: Connection, as_of: datetime) -> CapsuleGateResult:
    """The gate over the board as served at `as_of` (its pages keyed on the universe id)."""
    board_ids = board_universe_ids(conn, as_of)
    return judge_capsules(board_ids, stored_capsules_for(conn, board_ids))
