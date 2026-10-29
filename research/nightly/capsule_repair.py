"""WHAT THE REPAIR PASS REWRITES, AND IN WHAT ORDER (the coordinator's Lane 17 rulings 1 and 2).

1. **Unwritten pages first.** A facts block costs the reader more than a shared span, so before any
   repair spends budget the unwritten pages get their retry (`capsule_step._Passes.repair`).
2. **The hard targets next**: every page but the first (in board order) of each written sentence on
   two pages, and every written page that fails its page gate. Both fail the run.
3. **The span targets last, most shared first**: every carrier but the first (in board order) of each
   six-word span on two pages, ordered by how many shared spans it carries, then by the widest span it
   carries; the step rewrites only the first `span_repair_pages_per_night` of them a night (ruled
   2026-10-15). Spans never fail the run, so a
   span rewrite that cannot pass its validator keeps the page's written read rather than leaving a
   facts block, as every rewrite of a written page does (the hold path, `capsules.sweep`).
"""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass

from research.capsules.config import CAPSULE_CONFIG
from research.nightly.capsule_gate import CapsuleGateResult, repair_targets


@dataclass(frozen=True, slots=True)
class RepairTargets:
    """One repair attempt's pages: the hard ones in board order, the span ones most shared first."""

    hard: tuple[str, ...]
    spans: tuple[str, ...]

    @property
    def empty(self) -> bool:
        return not self.hard and not self.spans


def _in_board_order(pages: set[str], order: Sequence[str]) -> tuple[str, ...]:
    place = {pid: index for index, pid in enumerate(order)}
    return tuple(sorted(pages, key=lambda pid: place.get(pid, len(place))))


def repair_order(gate: CapsuleGateResult, failing: Mapping[str, object], order: Sequence[str]) -> RepairTargets:
    """The hard targets (shared sentences, the page gate) and the span targets, each in its order."""
    hard = set(repair_targets([s.player_ids for s in gate.shared], order)) | set(failing)
    widest: dict[str, int] = {}
    carried: dict[str, int] = {}
    for span in gate.spans:
        for pid in span.player_ids:
            widest[pid] = max(widest.get(pid, 0), len(span.player_ids))
            carried[pid] = carried.get(pid, 0) + 1
    place = {pid: index for index, pid in enumerate(order)}
    span_pages = set(repair_targets([s.player_ids for s in gate.spans], order)) - hard
    spans = tuple(
        sorted(
            span_pages,
            key=lambda pid: (-carried.get(pid, 0), -widest.get(pid, 0), place.get(pid, len(place))),
        )
    )
    return RepairTargets(_in_board_order(hard, order), spans)


def quoted_spans(gate: CapsuleGateResult, pages: Sequence[str]) -> dict[str, tuple[str, ...]]:
    """Each page's own shared spans for its repair prompt, at most `max_quoted_spans` of them."""
    cap = CAPSULE_CONFIG.repetition.max_quoted_spans
    return {pid: gate.span_phrases[pid][:cap] for pid in pages if pid in gate.span_phrases}
