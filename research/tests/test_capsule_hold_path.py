"""Lane 294: a season-capsule rewrite that falls never replaces a written capsule (the hold path), the
night's retry passes ask a held rewrite again, the capsule gate counts a held page written, and a read the
writer's asks could not write is asked once more of the retry writer. The store and the gateway are
stubbed throughout."""

import json
from collections.abc import Iterator, Sequence
from contextlib import nullcontext
from dataclasses import replace
from datetime import UTC, datetime
from types import SimpleNamespace
from typing import Any, cast

import httpx
import pytest
from sqlalchemy import Engine

from research.capsules import generate
from research.capsules import sweep as sweep_module
from research.capsules.config import CAPSULE_CONFIG, WriterSettings
from research.capsules.facts_block import FACTS_SOURCE
from research.capsules.gateway import Completion, GatewayClient, GenerationError
from research.capsules.gateway_ledger import ModelPrice, Usage
from research.capsules.generate import CapsuleResult, Fallback, ReadResult, generate_capsule
from research.capsules.narrative import NarrativeResult, failed_narrative
from research.capsules.prompt import NO_WORN_PHRASES, WornPhrases
from research.capsules.spans import SpanRules
from research.capsules.store import WRITTEN_SOURCE, StoredCapsule
from research.capsules.sweep import Subject, SweepPlan, SweepReport, sweep_capsules
from research.capsules.throttle_waits import AskWaits, RunWaits
from research.capsules.validate import ValidationResult
from research.nightly import capsule_step
from research.nightly.capsule_gate import judge_capsules
from research.nightly.capsule_step import RETRY_PASSES, CapsuleStepPlan, _Passes, checked_retry_model

NOW = datetime(2026, 10, 29, 5, 33, tzinfo=UTC)
_AT = datetime(2026, 10, 28, 6, tzinfo=UTC)
_WRITER = "zai/glm-5.3-flash"
_RETRY = "deepseek/deepseek-v4.1-flash-1017"
_FIXED = "The retry writer's note."


def _spelled(pid: str) -> str:
    """The id in letters, so each page's sentence is its own (a sentence's numbers normalize away)."""
    return "".join(chr(ord("a") + int(c)) if c.isdigit() else c for c in pid)


def _written(pid: str) -> StoredCapsule:
    return StoredCapsule(
        pid,
        "old-hash",
        "Short.",
        f"His written note on {_spelled(pid)} from last night.",
        WRITTEN_SOURCE,
        None,
        _WRITER,
        _AT,
    )


def _facts_row(pid: str) -> StoredCapsule:
    return StoredCapsule(pid, "stale:demoted", "his facts", "his facts", FACTS_SOURCE, None, None, _AT)


def _subject(pid: str) -> Subject:
    facts = SimpleNamespace(identity=SimpleNamespace(name=f"Player {pid.upper()}", id=pid), facts_hash="new-hash")
    return Subject(cast("Any", facts), pid)


def _fallen() -> CapsuleResult:
    read = ReadResult("his facts", FACTS_SOURCE, None, Fallback("failed_validation", "A week without its season."), ())
    return CapsuleResult(read, read, failed_narrative("never written"), FACTS_SOURCE, None, None, 6, 6)


def _ok() -> CapsuleResult:
    read = ReadResult("A fresh note of its own.", WRITTEN_SOURCE, None, None, ())
    return CapsuleResult(read, read, NarrativeResult(), WRITTEN_SOURCE, _WRITER, None, 2, 2)


# The hold path.


def _committing(monkeypatch: pytest.MonkeyPatch) -> tuple[Engine, list[tuple[str, str, str]]]:
    committed: list[tuple[str, str, str]] = []
    monkeypatch.setattr(
        sweep_module,
        "upsert_capsule",
        lambda conn, row, at: committed.append((row.player_id, row.source, row.facts_hash)),
    )
    return cast("Engine", SimpleNamespace(begin=lambda: nullcontext(None))), committed


def test_a_rewrite_of_a_written_capsule_that_falls_keeps_the_written_row(monkeypatch: pytest.MonkeyPatch) -> None:
    engine, committed = _committing(monkeypatch)
    monkeypatch.setattr(sweep_module, "generate_capsule", lambda *_, **__: _fallen())
    result, kept = sweep_module.write_one(engine, _subject("a"), _written("a"), cast("Any", None), NO_WORN_PHRASES)
    assert result.source == FACTS_SOURCE and kept
    assert committed == []


def test_a_first_capsule_that_falls_still_stores_its_facts_block(monkeypatch: pytest.MonkeyPatch) -> None:
    engine, committed = _committing(monkeypatch)
    monkeypatch.setattr(sweep_module, "generate_capsule", lambda *_, **__: _fallen())
    for stored in (None, _facts_row("a")):
        _, kept = sweep_module.write_one(engine, _subject("a"), stored, cast("Any", None), NO_WORN_PHRASES)
        assert not kept
    # The sheet's own hash: a page the writer never wrote is due again on its unwritten source alone.
    assert committed == [("a", FACTS_SOURCE, "new-hash")] * 2


def test_the_sweep_counts_a_held_rewrite_and_names_why_it_fell(monkeypatch: pytest.MonkeyPatch) -> None:
    stored = {"a": _written("a"), "b": _facts_row("b")}
    _, committed = _committing(monkeypatch)
    engine = cast("Engine", SimpleNamespace(connect=lambda: nullcontext(None), begin=lambda: nullcontext(None)))
    monkeypatch.setattr(
        sweep_module, "stored_capsules_for", lambda conn, ids: {k: stored[k] for k in ids if k in stored}
    )
    monkeypatch.setattr(sweep_module, "queue_regeneration", lambda conn, ids: 0)
    monkeypatch.setattr(sweep_module, "worn_phrases", lambda subjects, stored: WornPhrases((), ()))
    monkeypatch.setattr(sweep_module, "generate_capsule", lambda *_, **__: _fallen())
    gateway = GatewayClient.for_run("k", cast("httpx.Client", None), WriterSettings(_WRITER, 1, 60))
    report = sweep_capsules(
        engine,
        gateway,
        NOW,
        SweepPlan(10, span_rules=SpanRules(frozenset())),
        lambda c, a: [_subject("a"), _subject("b")],
    )
    assert report.held == ["a"]
    assert (report.facts, report.kept, report.refused) == (1, 1, 0)
    assert committed == [("b", FACTS_SOURCE, "new-hash")]
    assert report.fell == [
        "Player B: facts (failed validation: A week without its season.)",
        "Player A: facts (failed validation: A week without its season.), held over the written read",
    ]


# The re-asks within the night.


def _passes(monkeypatch: pytest.MonkeyPatch, outcomes: Iterator[SweepReport]) -> tuple[_Passes, list[SweepPlan]]:
    passes = _Passes(
        cast("Engine", None),
        cast("Any", None),
        NOW,
        CapsuleStepPlan(),
        lambda _: None,
        cast("Any", None),
        rules=SpanRules(frozenset()),
    )
    plans: list[SweepPlan] = []

    def sweep_capsules(*args: Any) -> SweepReport:
        plans.append(cast("SweepPlan", args[3]))
        return next(outcomes)

    monkeypatch.setattr(capsule_step, "sweep_capsules", sweep_capsules)
    return passes, plans


def test_a_held_rewrite_is_asked_again_by_the_retry_passes_until_it_lands(monkeypatch: pytest.MonkeyPatch) -> None:
    outcomes = iter(
        [
            SweepReport(NOW, 4, 2, ["a", "b"], 1, 0, kept=1, held=["a"]),
            SweepReport(NOW, 4, 1, ["a"], 0, 0, kept=1, held=["a"]),
            SweepReport(NOW, 4, 1, ["a"], 1, 0),
        ]
    )
    passes, plans = _passes(monkeypatch, outcomes)
    first = passes.sweep("capsules", SweepPlan(10))
    assert passes.held == {"a"} and passes.spend.held == 1
    passes.retry("capsule retries", first.facts, ())
    # Two retry rounds: the first fell again and held, the second landed; no third round is asked.
    assert [plan.again for plan in plans[1:]] == [frozenset({"a"}), frozenset({"a"})]
    assert all(plan.unwritten_only for plan in plans[1:])
    assert passes.held == frozenset() and passes.spend.held == 0


def test_the_retry_rounds_stop_at_their_count_and_when_a_round_reaches_no_page(monkeypatch: pytest.MonkeyPatch) -> None:
    always_held = iter([SweepReport(NOW, 4, 1, ["a"], 0, 0, kept=1, held=["a"])] * (RETRY_PASSES + 2))
    passes, plans = _passes(monkeypatch, always_held)
    passes.sweep("capsules", SweepPlan(10))
    passes.retry("capsule retries", 0, ())
    assert len(plans) == 1 + RETRY_PASSES
    assert passes.held == {"a"} and passes.spend.held == 1

    spent_out = iter([SweepReport(NOW, 4, 1, ["a"], 0, 0, kept=1, held=["a"]), SweepReport(NOW, 4, 0, [], 0, 0)])
    passes, plans = _passes(monkeypatch, spent_out)
    passes.sweep("capsules", SweepPlan(10))
    passes.retry("capsule retries", 0, ())
    # A round that reaches no page (each one left at the night's ceiling) ends the retries.
    assert len(plans) == 1 + 1


def test_an_unwritten_only_pass_is_eligible_for_its_held_pages_alone() -> None:
    plan = SweepPlan(10, unwritten_only=True, again=frozenset({"a"}))
    assert sweep_module._eligible(_subject("a"), _written("a"), plan)
    assert not sweep_module._eligible(_subject("c"), _written("c"), plan)
    assert sweep_module._eligible(_subject("b"), _facts_row("b"), plan)


# The gate's count.


def test_the_gate_counts_a_held_page_written_and_names_the_held() -> None:
    """Last night's shape: 536 pages, 17 facts blocks fails at 3.2%; the 13 whose rewrite fell held their
    written capsules, so 4 are unwritten, 0.7%, and the run passes."""
    ids = [f"p{i}" for i in range(536)]
    line = CAPSULE_CONFIG.unwritten_line_in_season
    rules = SpanRules(frozenset())
    before = {pid: (_facts_row(pid) if i < 17 else _written(pid)) for i, pid in enumerate(ids)}  # noqa: PLR2004
    after = {pid: (_facts_row(pid) if i < 4 else _written(pid)) for i, pid in enumerate(ids)}  # noqa: PLR2004
    failed = judge_capsules(ids, before, rules, line)
    held = judge_capsules(ids, after, rules, line)
    assert not failed.ok and round(failed.unwritten_share, 4) == 0.0317  # noqa: PLR2004
    assert held.ok and held.written == 532  # noqa: PLR2004
    summary = replace(held, held=13).summary()
    assert "532 written (13 held over a rewrite that fell tonight), 4 facts blocks" in summary


# The retry writer.


class _Stub:
    """The gateway as `generate` sees it, one script per model; `with_model` hands the retry writer's view."""

    def __init__(self, model: str, scripts: dict[str, list[Completion | GenerationError]]) -> None:
        self.model = model
        self.scripts = scripts
        self.calls = 0
        self.asked: list[str] = []
        self.waits = RunWaits()

    def with_model(self, model: str) -> "_Stub":
        return _Stub(model, self.scripts)

    def ask_waits(self) -> AskWaits:
        return self.waits.ask()

    def complete(
        self, messages: list[dict[str, str]], max_tokens: int, min_words: int = 20, ask: AskWaits | None = None
    ) -> Completion:
        del max_tokens, min_words, ask
        self.calls += 1
        self.asked.append(messages[-1]["content"])
        item = self.scripts[self.model].pop(0)
        if isinstance(item, GenerationError):
            raise item
        return item


@pytest.fixture
def strict_page(monkeypatch: pytest.MonkeyPatch) -> None:
    """Every collaborator that needs a real sheet stubbed; only the retry writer's note passes."""
    monkeypatch.setattr(generate, "narrative_requests_for", lambda facts: ())
    monkeypatch.setattr(generate, "bundle_prompt_for", lambda facts, requests, worn: "the bundle prompt")
    monkeypatch.setattr(generate, "writer_rules_for", lambda facts: "the rules")
    monkeypatch.setattr(generate, "correction_prompt_for", lambda facts, size, prior: f"correct the {size} note")
    monkeypatch.setattr(generate, "render_facts_block", lambda facts: "his facts")
    monkeypatch.setattr(generate, "grounding_of", lambda facts: None)
    monkeypatch.setattr(generate, "settle_narrative", lambda raw, facts, requests, model: NarrativeResult())
    monkeypatch.setattr(
        generate,
        "validate_capsule",
        lambda body, facts, size, asked_shorter=False: ValidationResult(
            body == _FIXED, () if body == _FIXED else ("A rule.",)
        ),
    )


_BUNDLE = Completion(json.dumps({"compact": "bad", "full": "bad", "narrative": {}}), Usage(cost_usd=0.001))
_BAD = Completion("bad", Usage(cost_usd=0.001))
_WRITER_ASKS = [_BUNDLE, *[_BAD] * 10]


def _write(scripts: dict[str, list[Completion | GenerationError]], retry: str | None) -> tuple[CapsuleResult, _Stub]:
    gateway = _Stub(_WRITER, scripts)
    return generate_capsule(cast("Any", None), cast("GatewayClient", gateway), retry_model=retry), gateway


@pytest.mark.usefixtures("strict_page")
def test_a_read_the_writer_could_not_write_is_written_by_the_retry_writer() -> None:
    result, gateway = _write(
        {_WRITER: list(_WRITER_ASKS), _RETRY: [Completion(_FIXED, Usage(cost_usd=0.0005))] * 2}, _RETRY
    )
    assert result.source == WRITTEN_SOURCE and result.rescued
    assert result.model == _RETRY
    assert (result.compact.text, result.full.text) == (_FIXED, _FIXED)
    assert result.retry_asks == 2  # noqa: PLR2004 - one a read
    # The retry writer's two asks are on the bill, outside the writer's asks the night's ceiling counts.
    assert result.asks == gateway.calls
    assert result.calls == gateway.calls + 2


@pytest.mark.usefixtures("strict_page")
def test_a_retry_draft_that_fails_too_is_the_facts_block() -> None:
    result, _ = _write({_WRITER: list(_WRITER_ASKS), _RETRY: [_BAD, _BAD]}, _RETRY)
    assert result.source == FACTS_SOURCE and not result.rescued and result.model is None
    assert result.retry_asks == 2  # noqa: PLR2004
    assert result.full.fallback == Fallback("failed_validation", "A rule.")


@pytest.mark.usefixtures("strict_page")
def test_a_refused_retry_ask_keeps_the_writers_own_fall() -> None:
    refused = GenerationError("the gateway refused the request", False)
    result, _ = _write({_WRITER: list(_WRITER_ASKS), _RETRY: [refused, refused]}, _RETRY)
    assert result.source == FACTS_SOURCE
    assert result.compact.fallback == Fallback("failed_validation", "A rule.")


@pytest.mark.usefixtures("strict_page")
def test_no_retry_writer_asks_nothing_more() -> None:
    result, gateway = _write({_WRITER: list(_WRITER_ASKS)}, None)
    assert result.source == FACTS_SOURCE and result.retry_asks == 0
    assert gateway.calls == result.calls


def test_an_unlisted_or_unpriced_retry_writer_is_off_by_a_warning(monkeypatch: pytest.MonkeyPatch) -> None:
    lines: list[str] = []
    settings = WriterSettings(_WRITER, 16, 600, retry_model=_RETRY)
    prices: Sequence[ModelPrice] = (
        ModelPrice(_RETRY, None, None, "test", listed=False),
        ModelPrice(_RETRY, None, None, "test", listed=True),
        ModelPrice(_RETRY, 0.1, 0.4, "test", listed=True),
    )
    seen = iter(prices)
    monkeypatch.setattr(capsule_step, "fetch_price", lambda http, key, model: next(seen))
    http = cast("httpx.Client", None)
    assert checked_retry_model(http, "k", settings, lines.append) is None
    assert checked_retry_model(http, "k", settings, lines.append) is None
    assert checked_retry_model(http, "k", settings, lines.append) == _RETRY
    assert [line.split(", which")[1] for line in lines] == [
        " the gateway's model list does not carry; the retry writer is off tonight",
        " the gateway's model list carries with no price; the retry writer is off tonight",
    ]
    assert checked_retry_model(http, "k", WriterSettings(_WRITER, 16, 600, retry_model=None), lines.append) is None
