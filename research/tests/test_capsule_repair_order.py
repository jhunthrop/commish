"""The repair's order (the coordinator's Lane 17 rulings 1 and 2): hard targets (a sentence on two
pages, the page gate) before span targets, span targets most shared first, a repair's own order kept by
the sweep, and a span repair that cannot pass its validator keeping the written read."""

from datetime import UTC, datetime
from types import SimpleNamespace
from typing import Any, cast

import pytest
from sqlalchemy import Engine

from research.capsules import sweep
from research.capsules.config import CAPSULE_CONFIG
from research.capsules.prompt import NO_WORN_PHRASES
from research.capsules.spans import SharedSpan
from research.capsules.store import StoredCapsule
from research.nightly.capsule_gate import CapsuleGateResult, SharedSentence
from research.nightly.capsule_repair import repair_order

ORDER = ["a", "b", "c", "d", "e"]


def _gate(shared: tuple[SharedSentence, ...], spans: tuple[SharedSpan, ...]) -> CapsuleGateResult:
    return CapsuleGateResult(5, 5, 0, 0, 0, shared, CAPSULE_CONFIG.unwritten_line_in_season, spans)


def test_hard_targets_come_before_spans_and_spans_go_most_shared_first() -> None:
    gate = _gate(
        (SharedSentence("if he is on your roster let him go", ("a", "d")),),
        (
            SharedSpan("two pages only share this one", ("a", "b")),
            SharedSpan("five pages share this one", tuple(ORDER)),
        ),
    )
    targets = repair_order(gate, {"c": ("capsule_time_frame:c:x",)}, ORDER)
    assert targets.hard == ("c", "d")
    # b, c, d and e carry the five-page span; c and d are already hard targets, b and e follow, widest first.
    assert targets.spans == ("b", "e")


def test_the_sweep_keeps_a_repairs_own_order() -> None:
    subjects = [cast("sweep.Subject", SimpleNamespace(universe_id=pid)) for pid in ORDER]
    plan = sweep.SweepPlan(10, only=("e", "b", "zz"))
    assert [s.universe_id for s in sweep._ordered(subjects, {}, plan)] == ["e", "b"]


def test_a_rewrite_that_falls_to_the_facts_block_keeps_the_written_read(monkeypatch: pytest.MonkeyPatch) -> None:
    fallen = SimpleNamespace(source="facts")
    monkeypatch.setattr(sweep, "generate_capsule", lambda *_, **__: fallen)
    stored = StoredCapsule("a", "h", "c", "f", "llm", None, None, datetime(2026, 10, 14, tzinfo=UTC))
    subject = cast("sweep.Subject", SimpleNamespace(universe_id="a", facts=None))
    # No engine is touched: nothing is written.
    result, kept = sweep.write_one(cast("Engine", None), subject, stored, cast("Any", None), NO_WORN_PHRASES)
    assert result.source == "facts" and kept


def test_the_span_pages_carrying_the_most_shared_spans_go_first() -> None:
    gate = _gate(
        (),
        (
            SharedSpan("a span on three pages here", ("a", "b", "c")),
            SharedSpan("one span that c and e share", ("c", "e")),
            SharedSpan("another span c and e share", ("c", "e")),
        ),
    )
    # c carries three shared spans, e two, b one.
    assert repair_order(gate, {}, ORDER).spans == ("c", "e", "b")
