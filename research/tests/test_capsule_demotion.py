"""The demotion after the graced rewrite (the coordinator's Lane 62 ruling): a sentence still on two
pages keeps its first carrier in board order and demotes the others to the facts block, with no model
call; the gate counts them unwritten and the night passes under its line; the run report names them;
and the next night writes them first, each told the sentence it was demoted for."""

from dataclasses import replace
from datetime import UTC, datetime
from pathlib import Path
from types import SimpleNamespace
from typing import Any, cast

import pytest
from sqlalchemy import Engine

from research.capsules import sweep
from research.capsules.config import CAPSULE_CONFIG
from research.capsules.facts_block import FACTS_SOURCE
from research.capsules.spans import SpanRules
from research.capsules.store import RETRY_FIRST_FACTS_HASH, WRITTEN_SOURCE, StoredCapsule
from research.capsules.sweep import FactsPassMemo, Subject, SweepPlan, SweepReport
from research.nightly import capsule_step, gates, run_parts
from research.nightly.capsule_demotion import (
    DEMOTED_KEY,
    Demotion,
    carried_demotions,
    demotion_line,
    demotion_targets,
    demotion_writes,
)
from research.nightly.capsule_gate import CapsuleGateResult, SharedSentence, judge_capsules
from research.nightly.capsule_step import CapsuleSpend, CapsuleStepPlan, CapsuleStepResult, _Passes
from research.nightly.page_findings import PageFindings
from research.nightly.run import carry_demotions, keep_demotions
from research.nightly.run_store import LocalRunStore
from research.nightly.steps import StepRecord

NOW = datetime(2026, 10, 16, 5, tzinfo=UTC)
ORDER = ["a", "b", "c", "d"]
SENTENCE = "that is the whole season so far"
OTHER = "he is the one we would draft"
_LINE = CAPSULE_CONFIG.unwritten_line_in_season
# The pages of the measured night that carried its one shared sentence.
_CARRIERS = 2


def _facts(pid: str, name: str) -> Any:
    return SimpleNamespace(
        identity=SimpleNamespace(id=f"provider-{pid}", name=name, position="WR"),
        projection=SimpleNamespace(
            projected_points=181.4, typical_low=150, typical_high=210, floor_points=90, ceiling_points=260
        ),
        market=SimpleNamespace(board_rank=12, position_rank=4, adp=14.2, position_adp=5),
        availability=SimpleNamespace(expected_games=16.4),
        facts_hash=f"hash-{pid}",
    )


def _subject(pid: str, name: str) -> Subject:
    return Subject(cast("Any", _facts(pid, name)), pid)


def test_every_carrier_but_the_first_in_board_order_is_demoted() -> None:
    shared = (SharedSentence(SENTENCE, ("a", "c", "d")),)
    assert demotion_targets(shared, ["d", "c", "b", "a"]) == (("c", SENTENCE), ("a", SENTENCE))


def test_a_page_demoted_for_one_sentence_is_never_the_keeper_of_another() -> None:
    shared = (SharedSentence(SENTENCE, ("a", "b")), SharedSentence(OTHER, ("b", "c")))
    # b goes for the first sentence; the second is then on c alone, which keeps it.
    assert demotion_targets(shared, ORDER) == (("b", SENTENCE),)


def test_a_demotion_is_the_facts_block_stamped_to_be_written_first() -> None:
    subjects = [_subject("a", "Ja'Marr Chase"), _subject("c", "Puka Nacua")]
    writes, demoted, unserved = demotion_writes(subjects, (("c", SENTENCE), ("x", SENTENCE)), {"provider-c": "puka"})
    (write,) = writes
    assert write.player_id == "c"
    assert write.source == FACTS_SOURCE
    assert write.facts_hash == RETRY_FIRST_FACTS_HASH
    assert write.body_compact == write.body_full
    assert write.body_full.startswith("Projected points: 181 in 16.4 expected games")
    assert write.model is None
    assert not write.narrative
    assert demoted == (Demotion("c", "puka", SENTENCE),)
    # A carrier with no sheet tonight cannot be given a facts block, so it is named rather than hidden.
    assert unserved == ("x",)


def test_a_page_with_no_served_slug_is_named_by_the_web_slug_rule() -> None:
    _, demoted, _ = demotion_writes([_subject("c", "Amon-Ra St. Brown")], (("c", SENTENCE),), {})
    assert demoted[0].slug == "amon-ra-st-brown"


def _rows(pages: int) -> dict[str, StoredCapsule]:
    def row(i: int) -> StoredCapsule:
        shared = f" {SENTENCE.capitalize()}." if i < _CARRIERS else ""
        return StoredCapsule(
            f"p{i}", "h", f"Page {i} short read.", f"Page {i} owns this read.{shared}", WRITTEN_SOURCE, None, None, NOW
        )

    return {f"p{i}": row(i) for i in range(pages)}


def test_the_failed_night_passes_once_its_one_shared_sentence_is_demoted() -> None:
    """The 2026-10-16T05 night: 536 pages written and one sentence on two of them."""
    ids = [f"p{i}" for i in range(536)]
    rows = _rows(536)
    rules = SpanRules(frozenset())
    before = judge_capsules(ids, rows, rules, _LINE)
    assert not before.ok
    assert [s.player_ids for s in before.shared] == [("p0", "p1")]
    targets = demotion_targets(before.shared, ids)
    assert targets == (("p1", SENTENCE),)
    demoted_row = replace(rows["p1"], source=FACTS_SOURCE, facts_hash=RETRY_FIRST_FACTS_HASH)
    after = replace(judge_capsules(ids, {**rows, "p1": demoted_row}, rules, _LINE), demoted=1)
    assert after.shared == ()
    assert (after.written, after.facts_blocks) == (535, 1)
    assert after.unwritten_share == pytest.approx(1 / 536)
    assert after.ok
    assert "1 facts blocks (1 demoted tonight for a sentence on two pages)" in after.summary()
    record = gates.capsule_gate(after, ())
    assert record.passed
    assert "1 demoted tonight for a sentence on two pages" in record.summary


def _passes(plan: CapsuleStepPlan, log: list[str]) -> _Passes:
    return _Passes(
        cast("Engine", None),
        cast("Any", None),  # no gateway: a demotion makes no model call
        NOW,
        plan,
        log.append,
        cast("FactsPassMemo", None),
        rules=SpanRules(frozenset()),
    )


def test_the_step_demotes_after_the_graced_rewrite_with_no_model_call(monkeypatch: pytest.MonkeyPatch) -> None:
    log: list[str] = []
    passes = _passes(CapsuleStepPlan(), log)
    gate = CapsuleGateResult(4, 4, 0, 0, 0, (SharedSentence(SENTENCE, ("a", "c", "d")),), _LINE)
    swept: list[str] = []
    asked: list[tuple[tuple[str, str], ...]] = []

    def demote(targets: tuple[tuple[str, str], ...]) -> tuple[Demotion, ...]:
        asked.append(targets)
        return tuple(Demotion(pid, f"slug-{pid}", sentence) for pid, sentence in targets)

    def sweep(name: str, plan: SweepPlan) -> SweepReport:
        del plan
        swept.append(name)
        return SweepReport(NOW, 4, 0)

    monkeypatch.setattr(passes, "_judged", lambda: (gate, ORDER, {}))
    monkeypatch.setattr(passes, "sweep", sweep)
    monkeypatch.setattr(passes, "_demote", demote)
    passes.repair()
    # The graced rewrite ran, then the demotion, of every carrier but the first.
    assert swept[-1].startswith("capsule repair, one generation past the ceiling")
    assert asked == [(("c", SENTENCE), ("d", SENTENCE))]
    assert passes.demoted == [Demotion("c", "slug-c", SENTENCE), Demotion("d", "slug-d", SENTENCE)]
    assert log[-1] == "capsules: 2 pages demoted for a shared sentence: slug-c, slug-d"


def test_nothing_is_demoted_when_no_sentence_is_shared(monkeypatch: pytest.MonkeyPatch) -> None:
    passes = _passes(CapsuleStepPlan(), [])
    monkeypatch.setattr(passes, "_judged", lambda: (CapsuleGateResult(4, 4, 0, 0, 0, (), _LINE), ORDER, {}))
    monkeypatch.setattr(passes, "_demote", lambda targets: pytest.fail("nothing to demote"))
    passes.demote_shared_sentences()
    assert passes.demoted == []


def test_the_line_names_one_page_in_the_singular() -> None:
    assert demotion_line([Demotion("c", "puka-nacua", SENTENCE)]) == (
        "1 page demoted for a shared sentence: puka-nacua"
    )


def test_the_run_report_carries_the_demoted_list_beside_the_summary(monkeypatch: pytest.MonkeyPatch) -> None:
    gate = CapsuleGateResult(4, 3, 1, 0, 0, (), _LINE, demoted=1)
    demoted = (Demotion("c", "puka-nacua", SENTENCE),)
    result = CapsuleStepResult(gate, PageFindings({}), CapsuleSpend(), True, demoted)
    monkeypatch.setattr(run_parts, "run_capsule_step", lambda *args: result)
    outcome = run_parts._capsules(
        cast("Engine", None), lambda: NOW, lambda _: None, False, CapsuleStepPlan(), cast("Any", None)
    )
    step = outcome.record.json()
    assert step["demoted"] == [{"slug": "puka-nacua", "sentence": SENTENCE, "playerId": "c"}]
    assert "1 page demoted for a shared sentence: puka-nacua" in str(step["summary"])
    assert outcome.demoted == demoted


# The previous night's report as the run store keeps it (`nightly.run`, `DEMOTED_KEY`).
_PREVIOUS = {
    "runId": "2026-10-16T05",
    "demoted": [{"slug": "puka-nacua", "sentence": SENTENCE, "playerId": "c"}],
}


def test_last_nights_report_carries_its_demotions() -> None:
    assert carried_demotions(_PREVIOUS) == (Demotion("c", "puka-nacua", SENTENCE),)
    assert carried_demotions(None) == ()
    with pytest.raises(ValueError, match="demoted"):
        carried_demotions({"runId": "x", "demoted": [{"slug": "puka-nacua"}]})


def test_last_nights_demoted_pages_are_written_first_and_told_their_sentence(monkeypatch: pytest.MonkeyPatch) -> None:
    passes = _passes(CapsuleStepPlan(carried=carried_demotions(_PREVIOUS)), [])
    seen: list[SweepPlan] = []

    def sweep_capsules(*args: Any) -> SweepReport:
        seen.append(cast("SweepPlan", args[3]))
        return SweepReport(NOW, 4, 0)

    monkeypatch.setattr(capsule_step, "sweep_capsules", sweep_capsules)
    passes.sweep("capsule retries 1", SweepPlan(10, unwritten_only=True, avoid_by_page={"b": ("a span",)}))
    (plan,) = seen
    assert plan.first == ("c",)
    assert dict(plan.avoid_by_page) == {"b": ("a span",), "c": (SENTENCE,)}
    # In the sweep's order, c comes before b, an unwritten page earlier in board order, even after
    # another write took c's stamp.
    subjects = [cast("Subject", SimpleNamespace(universe_id=pid)) for pid in ORDER]
    stored = {
        "a": StoredCapsule("a", "real-hash", "x", "x", WRITTEN_SOURCE, None, None, NOW),
        "b": StoredCapsule("b", "real-hash", "x", "x", FACTS_SOURCE, None, None, NOW),
        "c": StoredCapsule("c", "real-hash", "x", "x", FACTS_SOURCE, None, None, NOW),
    }
    assert [s.universe_id for s in sweep._ordered(subjects, stored, plan)][:2] == ["c", "b"]


def _capsule_outcome(status: str, demoted: tuple[Demotion, ...]) -> run_parts.StepOutcome:
    record = StepRecord("capsules", status, "s", tuple(d.json() for d in demoted))
    return run_parts.StepOutcome(record, demoted=demoted)


def test_the_run_keeps_its_demotions_for_the_next_night(tmp_path: Path) -> None:
    store = LocalRunStore(tmp_path)
    demoted = (Demotion("c", "puka-nacua", SENTENCE),)
    keep_demotions(store, "2026-10-16T05", [_capsule_outcome("ran", demoted)])
    log: list[str] = []
    plan = carry_demotions(store, CapsuleStepPlan(), log.append)
    assert plan.carried == demoted
    assert log == ["capsules: 1 page demoted last night is written first tonight: puka-nacua"]
    # A night that demoted nothing clears the list; a night that did not write keeps the last one.
    keep_demotions(store, "2026-10-17T05", [_capsule_outcome("skipped", ())])
    assert carry_demotions(store, CapsuleStepPlan(), log.append).carried == demoted
    keep_demotions(store, "2026-10-17T05", [_capsule_outcome("ran", ())])
    assert carry_demotions(store, CapsuleStepPlan(), log.append).carried == ()


def test_a_malformed_demotion_list_is_named_and_carries_nothing(tmp_path: Path) -> None:
    store = LocalRunStore(tmp_path)
    store.put(DEMOTED_KEY, b'{"runId": "x", "demoted": "c"}', "application/json")
    log: list[str] = []
    assert carry_demotions(store, CapsuleStepPlan(), log.append).carried == ()
    assert log == [f"capsules: the last night's demotions were not read ({DEMOTED_KEY}: 'demoted' is not a list)"]
