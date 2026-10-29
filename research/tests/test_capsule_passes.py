"""The capsule step's orchestration (the Lane 17 review's H1, M2 and M5), with the store and the
gateway stubbed: the repair attempts' order, the last attempt never rewriting for spans, the grace
past the night's call ceiling, and one facts pass a night on the skip and failure paths."""

from collections.abc import Callable, Iterator, Sequence
from contextlib import nullcontext
from dataclasses import dataclass, field
from datetime import UTC, datetime
from types import SimpleNamespace
from typing import Any, cast

import pytest
from sqlalchemy import Connection, Engine

from research.capsules import sweep as sweep_module
from research.capsules.config import CAPSULE_CONFIG
from research.capsules.facts_block import FACTS_SOURCE
from research.capsules.generate import CapsuleResult, Fallback, ReadResult
from research.capsules.narrative import failed_narrative
from research.capsules.spans import SharedSpan, SpanRules
from research.capsules.store import RETRY_FIRST_FACTS_HASH, StoredCapsule
from research.capsules.sweep import FactsPassMemo, Subject, SweepPlan, SweepReport
from research.db.read_cache import UNCACHED, ReadThrough
from research.nightly import capsule_demotion, capsule_step, run_parts
from research.nightly.capsule_demotion import Demotion
from research.nightly.capsule_gate import CapsuleGateResult, SharedSentence
from research.nightly.capsule_step import NIGHT_CALLS_PER_PLAYER, REPAIR_PASSES, CapsuleStepPlan, _Passes
from research.nightly.page_findings import PageFindings
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

    def sweep(name: str, plan: SweepPlan, *, ceiling: bool = True, check_pages: bool = False) -> SweepReport:
        del ceiling, check_pages
        script.plans.append((name, plan))
        return SweepReport(NOW, 4, 1, ["b"], 1, 0)

    monkeypatch.setattr(passes, "_judged", judged)
    monkeypatch.setattr(passes, "sweep", sweep)
    # The demotion after the graced rewrite writes no sweep (`test_capsule_demotion`).
    monkeypatch.setattr(passes, "_demote", lambda shared, order: ())
    return passes


def _kind(name: str, plan: SweepPlan) -> str:
    if plan.unwritten_only:
        return "retry"
    if plan.grace:
        return "graced"
    return "spans" if name.startswith("capsule span repair") else "hard"


def test_each_attempt_retries_then_rewrites_hard_then_retries_then_spans_and_the_last_never_spans(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    script = _Script()
    _passes(script, monkeypatch).repair()
    kinds = [_kind(name, plan) for name, plan in script.plans]
    # The scripted retry pass writes its page, so each retry is one sweep.
    one_attempt = ["retry", "hard", "retry", "spans"]
    last_attempt = ["retry", "hard", "retry"]
    # A sentence still on two pages after the last attempt gets the graced rewrite (ruled 2026-10-15).
    assert kinds == [*one_attempt * (REPAIR_PASSES - 1), *last_attempt, "graced"]
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
        return SweepReport(NOW, 4, 1, processed, 0, len(processed), asks_by_player=dict.fromkeys(processed, 6))

    monkeypatch.setattr(capsule_step, "sweep_capsules", sweep_capsules)
    passes.asks_by_player["x"] = NIGHT_CALLS_PER_PLAYER
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
        frozenset({"ingest", "fit", "week-reads"}),
        CapsuleStepPlan(),
    )
    capsules = next(step for step in steps if step.record.name == "capsules")
    assert capsules.record == StepRecord("capsules", "failed", "RuntimeError: the gateway went away")
    assert len(reads) == 1


def test_a_shared_sentence_at_the_ceiling_takes_one_generation_past_it_after_the_last_attempt(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The graced rewrite reaches a page at the ceiling that the hard passes had to leave, once."""
    passes = _passes(_Script(), monkeypatch)
    monkeypatch.undo()
    monkeypatch.setattr(passes, "_check_pages", lambda name, report: None)
    seen: list[frozenset[str]] = []

    def sweep_capsules(*args: Any) -> SweepReport:
        plan = cast("SweepPlan", args[3])
        seen.append(plan.exclude)
        processed = [] if "b" in plan.exclude else ["b"]
        return SweepReport(NOW, 4, 1, processed, 1, 0, asks_by_player=dict.fromkeys(processed, 6))

    monkeypatch.setattr(capsule_step, "sweep_capsules", sweep_capsules)
    monkeypatch.setattr(passes, "_judged", lambda: (_gate(0, True, False), ORDER, {}))
    passes.asks_by_player["b"] = NIGHT_CALLS_PER_PLAYER
    passes.sweep("hard", SweepPlan(10, only=("b",)))
    passes.grace_shared_sentences()
    passes.grace_shared_sentences()
    assert seen == [frozenset({"b"}), frozenset(), frozenset({"b"})]


def test_no_graced_rewrite_when_no_sentence_is_shared(monkeypatch: pytest.MonkeyPatch) -> None:
    script = _Script()
    passes = _passes(script, monkeypatch)
    monkeypatch.setattr(passes, "_judged", lambda: (_gate(0, False, True), ORDER, {}))
    passes.grace_shared_sentences()
    assert script.plans == []


def test_the_span_repair_rewrites_at_most_the_nights_cap(monkeypatch: pytest.MonkeyPatch) -> None:
    script = _Script()
    passes = _passes(script, monkeypatch)
    passes.span_pages_left = 1
    many = (SharedSpan("six words that two pages share", ("a", "b", "c", "d")),)

    def judged() -> tuple[CapsuleGateResult, list[str], dict[str, tuple[str, ...]]]:
        return CapsuleGateResult(4, 4, 0, 0, 0, (), _LINE, many), ORDER, {}

    def sweep(name: str, plan: SweepPlan) -> SweepReport:
        script.plans.append((name, plan))
        return SweepReport(NOW, 4, 1, list(plan.only or ()), 1, 0)

    monkeypatch.setattr(passes, "_judged", judged)
    monkeypatch.setattr(passes, "sweep", sweep)
    passes.repair()
    span_plans = [plan for name, plan in script.plans if name.startswith("capsule span repair")]
    assert [plan.only for plan in span_plans] == [("b",)]
    assert passes.span_pages_left == 0


def _fell_to_facts(name: str, violation: str) -> tuple[Subject, CapsuleResult]:
    """A page and a result that fell to its facts block on a validation failure."""
    read = ReadResult("facts", FACTS_SOURCE, None, Fallback("failed_validation", violation), ())
    result = CapsuleResult(read, read, failed_narrative("never written"), FACTS_SOURCE, None, None, 6, 6)
    return Subject(cast("Any", SimpleNamespace(identity=SimpleNamespace(name=name))), "u1"), result


def test_a_page_that_falls_to_its_facts_block_is_named_with_why_on_the_report() -> None:
    report = SweepReport(NOW, 4, 1)
    subject, result = _fell_to_facts("Ricky Pearsall", "Mixed evidence: the strongest downside is never cited.")
    sweep_module._tally(report, subject, result, kept=False)
    assert report.fell == [
        "Ricky Pearsall: facts (failed validation: Mixed evidence: the strongest downside is never cited.)"
    ]


def _logged_passes(monkeypatch: pytest.MonkeyPatch, report: SweepReport) -> tuple[_Passes, list[str]]:
    lines: list[str] = []
    passes = _passes(_Script(), monkeypatch)
    passes.log = lines.append
    monkeypatch.undo()  # the real sweep, over a stubbed `sweep_capsules`
    monkeypatch.setattr(capsule_step, "sweep_capsules", lambda *args: report)
    return passes, lines


def test_each_pass_logs_the_pages_that_fell_to_their_facts_blocks_and_why(monkeypatch: pytest.MonkeyPatch) -> None:
    """Lane 73: the 2026-10-17T05 night kept no reason any of its 95 first-pass facts blocks fell (the
    sweep's detail was never read), so each pass now names them in its log."""
    fell = [
        "Derius Davis: facts (failed validation: a time frame)",
        "Chip Trayanum: facts (failed validation: a betting word)",
    ]
    passes, lines = _logged_passes(monkeypatch, SweepReport(NOW, 4, 2, ["a", "b"], 0, 2, fell=list(fell)))
    passes.sweep("capsule retries 1", SweepPlan(10, unwritten_only=True))
    assert lines[-1] == f"capsule retries 1, 2 pages fell to their facts blocks: {'; '.join(fell)}"


def test_a_pass_where_no_page_fell_logs_no_fallback_line(monkeypatch: pytest.MonkeyPatch) -> None:
    passes, lines = _logged_passes(monkeypatch, SweepReport(NOW, 4, 1, ["a"], 1, 0))
    passes.sweep("capsules", SweepPlan(10))
    assert len(lines) == 1
    assert "fell to their facts blocks" not in lines[0]


def _after_demotion(
    monkeypatch: pytest.MonkeyPatch, unwritten: list[str], left: int
) -> tuple[_Passes, _Script, list[str]]:
    script, lines = _Script(), list[str]()
    passes = _passes(script, monkeypatch)
    passes.log = lines.append
    passes.budget = passes.spend.processed + left
    passes.demoted = [Demotion("d", "slug-d", "the role explains it", 2)]
    monkeypatch.setattr(passes, "_unwritten_pages", lambda: unwritten)
    return passes, script, lines


def test_after_the_demotion_one_retry_writes_the_unwritten_pages_past_the_ceiling_but_not_the_demoted(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Lane 73 ruling 2: the pages still unwritten after the demotion take one more retry, past the
    night's ceiling, each refused a sentence another page carries (`plan.only`); tonight's demotions
    keep their ruling (written first the next night, no model call tonight)."""
    passes, script, _ = _after_demotion(monkeypatch, ["a", "d", "c"], left=10)
    passes.asks_by_player.update({"a": NIGHT_CALLS_PER_PLAYER + 6, "c": NIGHT_CALLS_PER_PLAYER})
    passes.graced.update({"a", "c"})
    passes.retry_after_demotion()
    [(name, plan)] = script.plans
    assert name.startswith("capsule retry after the demotion")
    assert plan.only == ("a", "c")
    assert plan.budget == 10  # noqa: PLR2004 - the night's page budget left, never a new one


def test_the_retry_after_the_demotion_ignores_the_ceiling_in_the_real_sweep(monkeypatch: pytest.MonkeyPatch) -> None:
    passes, _, _ = _after_demotion(monkeypatch, ["a"], left=10)
    monkeypatch.undo()
    monkeypatch.setattr(passes, "_unwritten_pages", lambda: ["a"])
    monkeypatch.setattr(passes, "_check_pages", lambda name, report: None)
    seen: list[frozenset[str]] = []

    def sweep_capsules(*args: Any) -> SweepReport:
        seen.append(cast("SweepPlan", args[3]).exclude)
        return SweepReport(NOW, 4, 1, ["a"], 1, 0)

    monkeypatch.setattr(capsule_step, "sweep_capsules", sweep_capsules)
    passes.asks_by_player["a"] = 2 * NIGHT_CALLS_PER_PLAYER
    passes.graced.add("a")
    passes.retry_after_demotion()
    assert seen == [frozenset()]


def test_the_retry_after_the_demotion_stops_at_the_nights_budget_and_says_so(monkeypatch: pytest.MonkeyPatch) -> None:
    passes, script, _ = _after_demotion(monkeypatch, ["a", "b", "c"], left=2)
    passes.retry_after_demotion()
    [(name, plan)] = script.plans
    assert plan.budget == 2  # noqa: PLR2004
    assert "the night's page budget reaches 2 of the 3 unwritten pages, 1 left for the next night" in name


def test_no_retry_after_the_demotion_once_the_budget_is_spent(monkeypatch: pytest.MonkeyPatch) -> None:
    passes, script, lines = _after_demotion(monkeypatch, ["a"], left=0)
    passes.retry_after_demotion()
    assert script.plans == []
    assert lines == [
        "capsule retry after the demotion: the night's page budget is spent, 1 unwritten pages left for the next night"
    ]


Judged = tuple[CapsuleGateResult, list[str], dict[str, tuple[str, ...]]]


def _recording_checks(
    monkeypatch: pytest.MonkeyPatch, judged: Callable[[], Judged]
) -> tuple[_Passes, list[str], list[str]]:
    """The real passes over a stubbed sweep, each pass's name and each checked pass's name recorded."""
    passes = _passes(_Script(), monkeypatch)
    monkeypatch.undo()
    monkeypatch.setattr(passes, "_judged", judged)
    monkeypatch.setattr(passes, "_demote", lambda shared, order: ())
    monkeypatch.setattr(passes, "_unwritten_pages", lambda: ["c"])
    monkeypatch.setattr(capsule_step, "sweep_capsules", lambda *args: SweepReport(NOW, 4, 1, ["b"], 1, 0))
    swept: list[str] = []
    checked: list[str] = []
    real_account = passes._account

    def account(name: str, report: SweepReport, at: frozenset[str], *, graced_pass: bool) -> None:
        swept.append(name)
        real_account(name, report, at, graced_pass=graced_pass)

    monkeypatch.setattr(passes, "_account", account)
    monkeypatch.setattr(passes, "_check_pages", lambda name, report: checked.append(name))
    return passes, swept, checked


def test_every_pass_no_later_judgment_reads_is_page_checked_and_none_before(monkeypatch: pytest.MonkeyPatch) -> None:
    """Lane 73: a page written where no later repair reads the page gate (the last attempt's hard rewrite
    and its blocked retry, the graced rewrite, the retry after the demotion) goes through the page gate
    before the night's gate counts it, all from one function; the passes before are judged by the next
    attempt's own read of the page gate."""
    passes, swept, checked = _recording_checks(monkeypatch, lambda: (_gate(1, True, True), ORDER, {}))
    passes.repair()
    passes.retry_after_demotion()
    last = f"capsule repair {REPAIR_PASSES}"
    after = swept[swept.index(f"{last}, unwritten pages first 1") + 1 :]
    assert checked == after
    assert [name for name in checked if "past the ceiling" in name or "after the demotion" in name]
    assert any(name.startswith(f"{last} (") for name in checked)
    assert f"{last}, pages the rewrite blocked 1" in checked


def test_after_an_early_break_only_the_graced_rewrite_and_the_retry_after_the_demotion_are_checked(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Review 73 item 6: attempt 1 finds nothing to repair and breaks; the passes after it are the
    graced rewrite and the retry after the demotion, each checked by its own call's argument."""
    reads: Iterator[Judged] = iter([(_gate(1, False, False), ORDER, {}), (_gate(0, False, False), ORDER, {})])
    shared: Judged = (_gate(0, True, False), ORDER, {})
    passes, swept, checked = _recording_checks(monkeypatch, lambda: next(reads, shared))
    passes.repair()
    passes.retry_after_demotion()
    assert swept[0] == "capsule repair 1, unwritten pages first 1"
    assert checked == swept[1:]
    assert [name.split(" (")[0] for name in checked] == [
        "capsule repair, one generation past the ceiling",
        "capsule retry after the demotion",
    ]


def test_a_pass_is_page_checked_only_when_its_caller_asks(monkeypatch: pytest.MonkeyPatch) -> None:
    passes, _, checked = _recording_checks(monkeypatch, lambda: (_gate(0, False, False), ORDER, {}))
    passes.sweep("asked", SweepPlan(10), check_pages=True)
    passes.sweep("not asked", SweepPlan(10))
    assert checked == ["asked"]


def _fake_facts(name: str) -> Any:
    return SimpleNamespace(identity=SimpleNamespace(name=name))


def _checking_passes(monkeypatch: pytest.MonkeyPatch) -> tuple[_Passes, list[str], list[tuple[str, str, str]]]:
    """Passes whose page gate fails page b, every facts block row they write recorded."""
    lines: list[str] = []
    writes: list[tuple[str, str, str]] = []
    passes = _Passes(
        cast("Engine", SimpleNamespace(begin=lambda: nullcontext(None))),
        cast("Any", None),
        NOW,
        CapsuleStepPlan(),
        lines.append,
        cast(
            "FactsPassMemo",
            lambda conn, at: (Subject(_fake_facts("Player A"), "a"), Subject(_fake_facts("Player B"), "b")),
        ),
        rules=SpanRules(frozenset()),
    )
    monkeypatch.setattr(
        capsule_step,
        "page_findings",
        lambda conn, at, facts: PageFindings({"b": ("rank_off_page:b:WR3",), "z": ("x",)}),
    )
    monkeypatch.setattr(capsule_demotion, "render_facts_block", lambda facts: "his facts")
    monkeypatch.setattr(
        capsule_demotion,
        "upsert_capsule",
        lambda conn, row, at: writes.append((row.player_id, row.source, row.facts_hash)),
    )
    return passes, lines, writes


def test_a_page_that_fails_the_page_gate_after_an_unjudged_pass_falls_to_its_facts_block(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    passes, lines, writes = _checking_passes(monkeypatch)
    passes._check_pages(
        "capsule retry after the demotion (2 unwritten pages)", SweepReport(NOW, 4, 2, ["a", "b"], 2, 0)
    )
    assert writes == [("b", FACTS_SOURCE, RETRY_FIRST_FACTS_HASH)]
    assert lines == [
        "capsule retry after the demotion (2 unwritten pages): 1 pages failed the page gate and fell to "
        "their facts blocks: Player B (rank_off_page:b:WR3)"
    ]


def test_a_hard_target_whose_rewrite_was_refused_is_checked_though_the_pass_wrote_nothing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Review 73 item 2: the pass wrote no page (its one rewrite was refused, the page kept its failing
    read), and the check still runs, so the page falls to its facts block rather than failing the night."""
    passes, _, writes = _checking_passes(monkeypatch)
    passes._check_pages("capsule repair 3 (1 pages)", SweepReport(NOW, 4, 1, ["b"], 0, 0, kept=1, refused=1))
    assert writes == [("b", FACTS_SOURCE, RETRY_FIRST_FACTS_HASH)]


def test_a_page_the_check_drops_is_never_written_again_that_night(monkeypatch: pytest.MonkeyPatch) -> None:
    """Review 73 item 1: a dropped page keeps its write-first-next-night stamp: no later pass tonight
    (the blocked retries, the retry after the demotion) may write it."""
    passes, _, _ = _checking_passes(monkeypatch)
    passes._check_pages("capsule repair, one generation past the ceiling", SweepReport(NOW, 4, 1, ["b"], 1, 0))
    assert passes.dropped == frozenset({"b"})
    seen: list[SweepPlan] = []

    def sweep_capsules(*args: Any) -> SweepReport:
        seen.append(cast("SweepPlan", args[3]))
        return SweepReport(NOW, 4, 0)

    monkeypatch.setattr(capsule_step, "sweep_capsules", sweep_capsules)
    passes.sweep("capsule repair 3, pages the rewrite blocked 1", SweepPlan(10, unwritten_only=True))
    assert "b" in seen[0].exclude
    monkeypatch.setattr(passes, "_unwritten_pages", lambda: ["a", "b"])
    monkeypatch.setattr(passes, "_check_pages", lambda name, report: None)
    passes.retry_after_demotion()
    assert seen[1].only == ("a",)


def test_no_page_processed_means_no_page_gate_read(monkeypatch: pytest.MonkeyPatch) -> None:
    passes = _passes(_Script(), monkeypatch)
    monkeypatch.undo()
    monkeypatch.setattr(capsule_step, "page_findings", lambda *args: pytest.fail("read the page gate"))
    passes._check_pages("capsule retry", SweepReport(NOW, 4, 0))


def test_no_retry_after_the_demotion_when_every_page_is_written(monkeypatch: pytest.MonkeyPatch) -> None:
    passes, script, lines = _after_demotion(monkeypatch, ["d"], left=10)
    passes.retry_after_demotion()
    assert script.plans == []
    assert lines == []


def test_the_unwritten_pages_to_retry_are_those_with_a_sheet_tonight() -> None:
    """Review 73 item 8: a board page with no sheet tonight cannot be written, so the retry after the
    demotion neither counts it nor runs for it."""
    stored = {
        "a": StoredCapsule("a", "h", "c", "f", FACTS_SOURCE, None, None, NOW),
        "b": StoredCapsule("b", "h", "c", "f", "llm", None, None, NOW),
    }
    assert capsule_step.unwritten_with_sheets(["a", "b", "c", "d"], stored, frozenset({"a", "b", "d"})) == ["a", "d"]


def test_no_blocked_retry_runs_when_every_unwritten_page_was_dropped(monkeypatch: pytest.MonkeyPatch) -> None:
    """Re-review 73 N2: the one facts block is the page the check dropped, so no retry pass runs."""
    script = _Script()
    passes = _passes(script, monkeypatch)
    passes.dropped = frozenset({"b"})
    passes._retry_unwritten("capsule repair 3, pages the rewrite blocked", check_pages=True)
    assert script.plans == []
