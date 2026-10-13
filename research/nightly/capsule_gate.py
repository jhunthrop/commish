"""THE CAPSULE GATE: the board's capsules as the nightly holds them, before a run goes live.

Ruled (coordinator, phase C fix round 1): a template capsule is allowed only as a counted fallback.
The run fails when
- the board's pages on the template floor, missing pages counted with them, pass
  `template_share_max` (2%) of the board; or
- any sentence of a template capsule appears on two players' pages (a fixed prose line; compared
  normalized, as the repetition measures compare, across every stored read on the board, both
  sizes, written or template).

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
from research.capsules.facts.collect import PRODUCT_SEASON, universe_ids_for
from research.capsules.narrative import normalize_sentence, sentences_verbatim
from research.capsules.store import StoredCapsule, stored_capsules_for

TEMPLATE_SOURCE: Final = "template"
_EXAMPLES: Final = 5


@dataclass(frozen=True, slots=True)
class SharedSentence:
    sentence: str
    player_ids: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class CapsuleGateResult:
    board_players: int
    written: int
    template: int
    missing: int
    shared: tuple[SharedSentence, ...]
    share_max: float = CAPSULE_CONFIG.template_share_max

    @property
    def floor_share(self) -> float:
        return 0.0 if self.board_players == 0 else (self.template + self.missing) / self.board_players

    @property
    def ok(self) -> bool:
        return self.floor_share <= self.share_max and not self.shared

    def summary(self) -> str:
        verdict = "passed" if self.ok else "failed"
        line = (
            f"capsule gate: {verdict}, {self.board_players} board pages, {self.written} written, "
            f"{self.template} on the template, {self.missing} missing ({self.floor_share:.1%} on the floor, "
            f"the line {self.share_max:.0%}), {len(self.shared)} template sentences on two pages"
        )
        examples = "; ".join(f'"{s.sentence}" on {len(s.player_ids)} pages' for s in self.shared[:_EXAMPLES])
        return line if not examples else f"{line}: {examples}"


def _sentences(row: StoredCapsule) -> set[str]:
    return {normalize_sentence(s) for body in (row.body_compact, row.body_full) for s in sentences_verbatim(body)}


def shared_template_sentences(rows: Mapping[str, StoredCapsule]) -> tuple[SharedSentence, ...]:
    """Every sentence a template capsule carries that another player's page carries too."""
    pages: dict[str, list[str]] = {}
    for player_id, row in rows.items():
        for sentence in _sentences(row):
            pages.setdefault(sentence, []).append(player_id)
    template_sentences = {s for row in rows.values() if row.source == TEMPLATE_SOURCE for s in _sentences(row)}
    shared = [
        SharedSentence(sentence, tuple(sorted(ids)))
        for sentence, ids in pages.items()
        if sentence in template_sentences and len(ids) > 1
    ]
    return tuple(sorted(shared, key=lambda s: (-len(s.player_ids), s.sentence)))


def judge_capsules(board_ids: Sequence[str], rows: Mapping[str, StoredCapsule]) -> CapsuleGateResult:
    """The gate over the board's universe ids and their stored rows."""
    on_board = {pid: rows[pid] for pid in board_ids if pid in rows}
    template = sum(1 for row in on_board.values() if row.source == TEMPLATE_SOURCE)
    return CapsuleGateResult(
        board_players=len(board_ids),
        written=len(on_board) - template,
        template=template,
        missing=len(board_ids) - len(on_board),
        shared=shared_template_sentences(on_board),
    )


def capsule_gate(conn: Connection, as_of: datetime) -> CapsuleGateResult:
    """The gate over the board as served at `as_of` (its pages keyed on the universe id)."""
    provider_ids = [row.player_id for row in board_rows(conn, PRODUCT_SEASON, as_of)]
    universe = universe_ids_for(conn, provider_ids)
    board_ids = list(dict.fromkeys(universe[pid] for pid in provider_ids if pid in universe))
    return judge_capsules(board_ids, stored_capsules_for(conn, board_ids))
