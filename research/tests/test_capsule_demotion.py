"""The demotion after the graced rewrite (the coordinator's Lane 62 ruling): a sentence still on two
pages keeps its first carrier in board order and demotes the others to the facts block, with no model
call; the gate counts them unwritten and the night passes under its line; the run report names them;
and the next night writes them first, each told the sentence it was demoted for."""

from contextlib import nullcontext
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
from research.nightly import capsule_demotion, capsule_step, gates, run_parts
from research.nightly.build.pages import Identity
from research.nightly.capsule_demotion import (
    DEMOTED_KEY,
    Demotion,
    Target,
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


def _named(targets: tuple[Target, ...]) -> tuple[tuple[str, str], ...]:
    return tuple((pid, sentence.sentence) for pid, sentence in targets)


def test_every_carrier_but_the_first_in_board_order_is_demoted() -> None:
    shared = (SharedSentence(SENTENCE, ("a", "c", "d")),)
    assert _named(demotion_targets(shared, ["d", "c", "b", "a"])) == (("c", SENTENCE), ("a", SENTENCE))


def test_a_page_demoted_for_one_sentence_is_never_the_keeper_of_another() -> None:
    shared = (SharedSentence(SENTENCE, ("a", "b")), SharedSentence(OTHER, ("b", "c")))
    # b goes for the first sentence; the second is then on c alone, which keeps it.
    assert _named(demotion_targets(shared, ORDER)) == (("b", SENTENCE),)


@pytest.mark.parametrize("swapped", [False, True])
def test_the_overlap_demotes_the_one_page_whatever_the_sentences_order(swapped: bool) -> None:
    """The review's M1: A on p2 and p3, B on p1 and p2, board order p1, p2, p3. Taken A first, the
    greedy pass demotes p3 then p2, and A is left on no page: p3 is restored."""
    first = SharedSentence("aaa is the first sentence here", ("p2", "p3"))
    second = SharedSentence("bbb is the second sentence here", ("p1", "p2"))
    shared = (second, first) if swapped else (first, second)
    targets = demotion_targets(shared, ["p1", "p2", "p3"])
    assert [pid for pid, _ in targets] == ["p2"]


def test_a_carrier_that_cannot_be_demoted_keeps_the_sentence() -> None:
    """The review's L3: a carrier with no sheet tonight is the keeper, so the sentence is still cured."""
    shared = (SharedSentence(SENTENCE, ("a", "b")),)
    assert _named(demotion_targets(shared, ORDER, frozenset({"b"}))) == (("a", SENTENCE),)


def test_a_demotion_is_the_facts_block_stamped_to_be_written_first() -> None:
    subjects = [_subject("a", "Ja'Marr Chase"), _subject("c", "Puka Nacua")]
    held = SharedSentence(SENTENCE, ("a", "c", "x"))
    writes, demoted, unserved = demotion_writes(subjects, (("c", held), ("x", held)), {"provider-c": "puka"})
    (write,) = writes
    assert write.player_id == "c"
    assert write.source == FACTS_SOURCE
    assert write.facts_hash == RETRY_FIRST_FACTS_HASH
    assert write.body_compact == write.body_full
    assert write.body_full.startswith("Projected points: 181 in 16.4 expected games")
    assert write.model is None
    assert not write.narrative
    assert demoted == (Demotion("c", "puka", SENTENCE, 3),)
    # A carrier with no sheet tonight cannot be given a facts block, so it is named rather than hidden.
    assert unserved == ("x",)


def test_a_page_with_no_served_slug_is_named_by_the_web_slug_rule() -> None:
    held = SharedSentence(SENTENCE, ("a", "c"))
    _, demoted, _ = demotion_writes([_subject("c", "Amon-Ra St. Brown")], (("c", held),), {})
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
    assert _named(targets) == (("p1", SENTENCE),)
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


class _Conn:
    """A writers' connection that keeps every capsule row upserted, for the fake engine below."""

    def __init__(self, rows: dict[str, StoredCapsule]) -> None:
        self.rows = rows


class _Engine:
    def __init__(self, rows: dict[str, StoredCapsule]) -> None:
        self.conn = _Conn(rows)

    def begin(self) -> Any:
        return nullcontext(self.conn)


def test_the_demotion_commits_facts_blocks_and_the_final_gate_reads_no_shared_sentence(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The review's L5: `_demote` over a fake engine, its rows judged as the final gate judges them."""
    ids = ["p0", "p1", "p2", "p3"]
    rows = _rows(4)
    engine = _Engine(rows)

    def upsert(conn: _Conn, write: Any, at: datetime) -> None:
        conn.rows[write.player_id] = StoredCapsule(
            write.player_id, write.facts_hash, write.body_compact, write.body_full, write.source, None, write.model, at
        )

    monkeypatch.setattr(capsule_demotion, "upsert_capsule", upsert)
    served = [Identity("provider-p1", "player-one", "Player One", "WR", "KC", None)]
    monkeypatch.setattr(capsule_step, "served_identities", lambda conn, at: served)
    subjects = tuple(_subject(pid, f"Player {pid}") for pid in ids)
    log: list[str] = []
    passes = _Passes(
        cast("Engine", engine),
        cast("Any", None),
        NOW,
        CapsuleStepPlan(),
        log.append,
        cast("FactsPassMemo", lambda conn, at: subjects),
        rules=SpanRules(frozenset()),
    )
    rules = SpanRules(frozenset())
    monkeypatch.setattr(passes, "_judged", lambda: (judge_capsules(ids, rows, rules, _LINE), ids, {}))
    passes.demote_shared_sentences()
    assert rows["p1"].source == FACTS_SOURCE
    assert rows["p1"].facts_hash == RETRY_FIRST_FACTS_HASH
    assert rows["p0"].source == WRITTEN_SOURCE
    final = judge_capsules(ids, rows, rules, _LINE)
    assert final.shared == ()
    assert final.facts_blocks == 1
    assert passes.demoted == [Demotion("p1", "player-one", SENTENCE, 2)]
    assert log == [f'capsules: 1 page demoted for 1 shared sentence ("{SENTENCE}" on 2 pages): player-one']


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
    held = SharedSentence(SENTENCE, ("a", "c", "d"))
    gate = CapsuleGateResult(4, 4, 0, 0, 0, (held,), _LINE)
    swept: list[str] = []
    asked: list[tuple[SharedSentence, ...]] = []

    def demote(shared: tuple[SharedSentence, ...], order: list[str]) -> tuple[Demotion, ...]:
        asked.append(shared)
        targets = demotion_targets(shared, order)
        return tuple(Demotion(pid, f"slug-{pid}", s.sentence, len(s.player_ids)) for pid, s in targets)

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
    assert asked == [(held,)]
    assert passes.demoted == [Demotion("c", "slug-c", SENTENCE, 3), Demotion("d", "slug-d", SENTENCE, 3)]
    assert log[-1] == f'capsules: 2 pages demoted for 1 shared sentence ("{SENTENCE}" on 3 pages): slug-c, slug-d'


def test_nothing_is_demoted_when_no_sentence_is_shared(monkeypatch: pytest.MonkeyPatch) -> None:
    passes = _passes(CapsuleStepPlan(), [])
    monkeypatch.setattr(passes, "_judged", lambda: (CapsuleGateResult(4, 4, 0, 0, 0, (), _LINE), ORDER, {}))
    monkeypatch.setattr(passes, "_demote", lambda shared, order: pytest.fail("nothing to demote"))
    passes.demote_shared_sentences()
    assert passes.demoted == []


def test_the_line_counts_the_sentences_and_quotes_each_with_its_carriers() -> None:
    """The review's L1: one stock sentence on 17 pages reads as one sentence, not 16 pairs."""
    stock = [Demotion(f"p{i}", f"s{i}", SENTENCE, 17) for i in range(16)]
    assert demotion_line(stock).startswith(f'16 pages demoted for 1 shared sentence ("{SENTENCE}" on 17 pages): s0, ')
    two = [Demotion("c", "puka-nacua", SENTENCE, 2), Demotion("d", "nico-collins", OTHER, 2)]
    assert demotion_line(two) == (
        f'2 pages demoted for 2 shared sentences ("{SENTENCE}" on 2 pages, "{OTHER}" on 2 pages): '
        "puka-nacua, nico-collins"
    )


def test_the_run_report_carries_the_demoted_list_beside_the_summary(monkeypatch: pytest.MonkeyPatch) -> None:
    gate = CapsuleGateResult(4, 3, 1, 0, 0, (), _LINE, demoted=1)
    demoted = (Demotion("c", "puka-nacua", SENTENCE, 2),)
    result = CapsuleStepResult(gate, PageFindings({}), CapsuleSpend(), True, demoted)
    monkeypatch.setattr(run_parts, "run_capsule_step", lambda *args: result)
    outcome = run_parts._capsules(
        cast("Engine", None), lambda: NOW, lambda _: None, False, CapsuleStepPlan(), cast("Any", None)
    )
    step = outcome.record.json()
    assert step["demoted"] == [{"slug": "puka-nacua", "sentence": SENTENCE, "playerId": "c", "carriers": 2}]
    assert f'1 page demoted for 1 shared sentence ("{SENTENCE}" on 2 pages): puka-nacua' in str(step["summary"])
    assert outcome.demoted == demoted


# The previous night's report as the run store keeps it (`nightly.run`, `DEMOTED_KEY`).
_PREVIOUS = {
    "runId": "2026-10-16T05",
    "demoted": [{"slug": "puka-nacua", "sentence": SENTENCE, "playerId": "c", "carriers": 2}],
}


def test_last_nights_report_carries_its_demotions() -> None:
    assert carried_demotions(_PREVIOUS) == (Demotion("c", "puka-nacua", SENTENCE, 2),)
    assert carried_demotions(None) == ()
    with pytest.raises(ValueError, match="demoted"):
        carried_demotions({"runId": "x", "demoted": [{"slug": "puka-nacua"}]})
    # The review's L2: a list where the object belongs is a ValueError, not an AttributeError.
    with pytest.raises(ValueError, match="not an object"):
        carried_demotions([])


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
    demoted = (Demotion("c", "puka-nacua", SENTENCE, 2),)
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


@pytest.mark.parametrize(
    ("body", "reason"),
    [
        (b'{"runId": "x", "demoted": "c"}', f"{DEMOTED_KEY}: 'demoted' is not a list"),
        (b"[]", f"{DEMOTED_KEY}: not an object"),
    ],
)
def test_a_malformed_demotion_list_is_named_and_carries_nothing(tmp_path: Path, body: bytes, reason: str) -> None:
    store = LocalRunStore(tmp_path)
    store.put(DEMOTED_KEY, body, "application/json")
    log: list[str] = []
    assert carry_demotions(store, CapsuleStepPlan(), log.append).carried == ()
    assert log == [f"capsules: the last night's demotions were not read ({reason})"]


class _UnreadableStore(LocalRunStore):
    def get(self, key: str) -> bytes | None:
        raise OSError(f"the bucket refused {key}")


def test_a_store_read_that_fails_never_fails_the_night(tmp_path: Path) -> None:
    """The review's L2: a transient read error is named and the night carries nothing."""
    log: list[str] = []
    plan = CapsuleStepPlan()
    assert carry_demotions(_UnreadableStore(tmp_path), plan, log.append) is plan
    assert log == [f"capsules: the last night's demotions were not read (the bucket refused {DEMOTED_KEY})"]
