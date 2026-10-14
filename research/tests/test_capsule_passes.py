"""The capsule step's orchestration (the Lane 17 review's H1, M2 and M5), with the store and the
gateway stubbed: the repair attempts' order, the last attempt never rewriting for spans, the grace
past the night's call ceiling, and one facts pass a night on the skip and failure paths."""

from collections.abc import Sequence
from contextlib import nullcontext
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any, cast

import pytest
from sqlalchemy import Connection, Engine

from research.capsules.config import CAPSULE_CONFIG
from research.capsules.spans import SharedSpan, SpanRules
from research.capsules.sweep import FactsPassMemo, Subject, SweepPlan, SweepReport
from research.db.read_cache import UNCACHED, ReadThrough
from research.nightly import capsule_step, run_parts
from research.nightly.capsule_gate import CapsuleGateResult, SharedSentence
from research.nightly.capsule_step import NIGHT_CALLS_PER_PLAYER, REPAIR_PASSES, CapsuleStepPlan, _Passes
from research.nightly.steps import StepRecord

NOW = datetime(2026, 10, 15, 5, tzinfo=UTC)
ORDER = ["a", "b", "c", "d"]
_LINE = CAPSULE_CONFIG.unwritten_line_in_season


def _gate(blocks: int, shared: bool, spans: bool) -> CapsuleGateResult:
    sentences = (SharedSentence("if he is on your roster let him go", ("a", "b")),) if shared else ()
    shared_spans = (SharedSpan("six words that two pages share", ("c", "d")),) if spans else ()
    return CapsuleGateResult(4, 4 - blocks, blocks, 0, 0, sentences, _LINE, shared_spans)


@dataclass
class _Script:
    """Every gate judged returns blocks, a shared sentence and a shared span; every sweep is recorded."""

    plans: list[tuple[str, SweepPlan]] = field(default_factory=list)


def _passes(script: _Script, monkeypatch: pytest.MonkeyPatch) -> _Passes:
    passes = _Passes(
        cast("Engine", None),
        cast("Any", None),
        NOW,
        CapsuleStepPlan(),
        lambda _: None,
        cast("FactsPassMemo", None),
        rules=SpanRules(frozenset()),
    )

    def judged() -> tuple[CapsuleGateResult, list[str], dict[str, tuple[str, ...]]]:
        return _gate(1, True, True), ORDER, {}

    def sweep(name: str, plan: SweepPlan) -> SweepReport:
        script.plans.append((name, plan))
        return SweepReport(NOW, 4, 1, ["b"], 1, 0)

    monkeypatch.setattr(passes, "_judged", judged)
    monkeypatch.setattr(passes, "sweep", sweep)
    return passes


def _kind(plan: SweepPlan) -> str:
    if plan.unwritten_only:
        return "retry"
    return "spans" if plan.keep_written else "hard"


def test_each_attempt_retries_then_rewrites_hard_then_retries_then_spans_and_the_last_never_spans(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    script = _Script()
    _passes(script, monkeypatch).repair()
    kinds = [_kind(plan) for _, plan in script.plans]
    # The scripted retry pass writes its page, so each retry is one sweep.
    one_attempt = ["retry", "hard", "retry", "spans"]
    last_attempt = ["retry", "hard", "retry"]
    assert kinds == one_attempt * (REPAIR_PASSES - 1) + last_attempt
    # Every span rewrite is preceded, within its attempt, by a retry of the pages still unwritten.
    for index, kind in enumerate(kinds):
        if kind == "spans":
            assert kinds[index - 1] == "retry"


def test_a_page_at_the_ceiling_takes_one_generation_past_it_once(monkeypatch: pytest.MonkeyPatch) -> None:
    passes = _passes(_Script(), monkeypatch)
    monkeypatch.undo()  # the real sweep, over a stubbed `sweep_capsules`
    seen: list[frozenset[str]] = []

    def sweep_capsules(*args: Any) -> SweepReport:
        plan = cast("SweepPlan", args[3])
        seen.append(plan.exclude)
        processed = [] if "x" in plan.exclude else ["x"]
        return SweepReport(NOW, 4, 1, processed, 0, len(processed), calls_by_player=dict.fromkeys(processed, 6))

    monkeypatch.setattr(capsule_step, "sweep_capsules", sweep_capsules)
    passes.calls_by_player["x"] = NIGHT_CALLS_PER_PLAYER
    passes.sweep("retry 1", SweepPlan(10, unwritten_only=True))
    passes.sweep("retry 2", SweepPlan(10, unwritten_only=True))
    passes.sweep("hard", SweepPlan(10, only=("x",)))
    assert seen == [frozenset(), frozenset({"x"}), frozenset({"x"})]


def _counting_memo() -> tuple[FactsPassMemo, list[datetime]]:
    reads: list[datetime] = []

    def read(conn: Connection, as_of: datetime, history: ReadThrough) -> Sequence[Subject]:
        del conn, history
        reads.append(as_of)
        return []

    return FactsPassMemo(lambda: nullcontext(cast("Connection", object())), UNCACHED, read), reads


def _stub_gate_reads(monkeypatch: pytest.MonkeyPatch) -> None:
    def gate(conn: Connection, at: datetime, rules: SpanRules) -> CapsuleGateResult:
        del conn, at, rules
        return _gate(0, False, False)

    def rules(conn: Connection, at: datetime, facts: FactsPassMemo) -> SpanRules:
        facts(conn, at)
        return SpanRules(frozenset())

    def findings(conn: Connection, at: datetime, facts: FactsPassMemo) -> Any:
        facts(conn, at)
        return cast("Any", type("Findings", (), {"reasons": [], "by_page": {}})())

    monkeypatch.setattr(run_parts, "capsule_gate", gate)
    monkeypatch.setattr(run_parts, "span_rules", rules)
    monkeypatch.setattr(run_parts, "page_findings", findings)


_ENGINE = cast("Engine", type("FakeEngine", (), {"connect": lambda self: nullcontext(object())})())


def test_the_skip_path_reads_one_facts_pass(monkeypatch: pytest.MonkeyPatch) -> None:
    _stub_gate_reads(monkeypatch)
    memo, reads = _counting_memo()
    ticks = iter([NOW.replace(second=s) for s in range(10)])
    run_parts._capsules(_ENGINE, lambda: next(ticks), lambda _: None, True, CapsuleStepPlan(), memo)
    assert len(reads) == 1


def test_the_failure_path_reads_the_pass_the_step_already_holds(monkeypatch: pytest.MonkeyPatch) -> None:
    _stub_gate_reads(monkeypatch)
    memo, reads = _counting_memo()

    def step_that_raises(engine: Engine, now: datetime, plan: CapsuleStepPlan, log: Any, facts: FactsPassMemo) -> Any:
        facts(cast("Connection", None), now)
        raise RuntimeError("the gateway went away")

    monkeypatch.setattr(run_parts, "night_facts", lambda engine: memo)
    monkeypatch.setattr(run_parts, "run_capsule_step", step_that_raises)
    ticks = iter([NOW.replace(second=s) for s in range(10)])
    steps = run_parts.run_steps(
        _ENGINE,
        cast("Any", None),
        {},
        lambda: next(ticks),
        lambda _: None,
        frozenset({"ingest", "fit"}),
        CapsuleStepPlan(),
    )
    assert steps[-1].record == StepRecord("capsules", "failed", "RuntimeError: the gateway went away")
    assert len(reads) == 1
