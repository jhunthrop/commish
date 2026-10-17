"""Lane 72, the week-ahead read written: the prompt, the writer's loop within its ceiling, the facts block
as its counted fallback, the cadence that writes it again, and the demotion of a sentence on two pages.
The gateway is stubbed throughout."""

from collections.abc import Iterator, Sequence
from dataclasses import replace
from datetime import UTC, datetime, timedelta

import pytest

from research.capsules.gateway import Completion, GenerationError
from research.capsules.gateway_ledger import Usage
from research.capsules.run_budget import BudgetSpentError
from research.capsules.throttle_waits import AskWaits, RunWaits
from research.capsules.week.cadence import (
    FIRST,
    PROJECTION_MOVED,
    STATUS_CHANGED,
    UNWRITTEN,
    due_reason,
)
from research.capsules.week.prompt import WEEK_RULES, length_move, week_prompt
from research.capsules.week.sheet import Status
from research.capsules.week.store import StoredWeekRead
from research.capsules.week.write import MAX_CALLS_PER_READ, write_week_read
from research.nightly.week_reads import shared_week_sentences, week_demotions
from research.tests.test_week_read_rules import BYE_READ, STARTER_READ
from research.tests.week_read_fixtures import REPORT, WRITTEN_AT, on_bye, questionable, starter

_USAGE = Usage(2400, 150, 2550, 0.0004)
_A_DRAFT_AND_ONE_MORE = 2


def _answer(text: str) -> Completion:
    return Completion(text, _USAGE, "provider", "stop")


class _StubGateway:
    """The gateway as the writer sees it: each ask takes the next scripted answer or error."""

    model = "m/x"

    def __init__(self, script: Sequence[Completion | GenerationError]) -> None:
        self.script: Iterator[Completion | GenerationError] = iter(script)
        self.calls = 0
        self.slept: list[float] = []
        self.asked: list[list[dict[str, str]]] = []
        self.waits = RunWaits()

    def ask_waits(self) -> AskWaits:
        return self.waits.ask()

    def complete(
        self, messages: list[dict[str, str]], max_tokens: int, min_words: int = 20, ask: AskWaits | None = None
    ) -> Completion:
        self.calls += 1
        self.asked.append(messages)
        item = next(self.script)
        if isinstance(item, GenerationError):
            raise item
        return item

    def sleep(self, seconds: float) -> None:
        self.slept.append(seconds)


def test_the_prompt_states_the_week_the_kickoff_and_that_the_number_is_published_never_ours() -> None:
    user = week_prompt(starter(), ())
    assert "week 6 of 2026" in user
    assert "Sunday 3:05 pm Central" in user
    assert "published projection" in WEEK_RULES and "never ours" in WEEK_RULES
    assert "18.4 points" in user
    for word in ("odds", "underdog", "favoured", "line", "spread", "bet", "the books"):
        assert f'"{word}"' in WEEK_RULES


def test_the_prompt_quotes_the_sentences_other_pages_carry() -> None:
    user = week_prompt(starter(), ("Start him with confidence.",))
    assert '"Start him with confidence."' in user


def test_a_long_read_is_told_its_count_and_the_cut() -> None:
    """The recorded run: a writer told only the band kept a 137-word read at 137 through three corrections."""
    long_read = " ".join([STARTER_READ, STARTER_READ])
    words = len(long_read.split())
    gateway = _StubGateway([_answer(long_read), _answer(STARTER_READ)])
    result = write_week_read(starter(), gateway)  # type: ignore[arg-type]
    assert result.source == "llm"
    correction = gateway.asked[1][-1]["content"]
    assert f"It is {words} words, {words - 120} over the 120-word cap. Cut about {words - 80} words" in correction
    assert length_move(80) is None


def test_a_read_that_passes_is_written_in_one_call() -> None:
    gateway = _StubGateway([_answer(STARTER_READ)])
    result = write_week_read(starter(), gateway)  # type: ignore[arg-type]
    assert result.source == "llm"
    assert result.text == STARTER_READ
    assert result.calls == 1
    assert result.model == "m/x"
    assert result.usage == _USAGE


def test_a_broken_rule_is_handed_back_with_its_sentence_and_the_rewrite_lands() -> None:
    broken = f"{STARTER_READ.removesuffix(' Start him with confidence.')} It is a safe bet he scores."
    gateway = _StubGateway([_answer(broken), _answer(STARTER_READ)])
    result = write_week_read(starter(), gateway)  # type: ignore[arg-type]
    assert result.source == "llm"
    assert result.calls == _A_DRAFT_AND_ONE_MORE
    correction = gateway.asked[1][-1]["content"]
    assert "It is a safe bet he scores." in correction
    assert "betting word" in correction


def test_a_read_that_never_passes_is_the_facts_block_within_the_ceiling() -> None:
    never = "Buy him. Buy him now. Buy him today."
    gateway = _StubGateway([_answer(never)] * (MAX_CALLS_PER_READ + 2))
    result = write_week_read(starter(), gateway)  # type: ignore[arg-type]
    assert result.source == "facts"
    assert result.calls == MAX_CALLS_PER_READ
    assert result.text.startswith("Week: 6 of 2026")
    assert result.fallback is not None and result.fallback.startswith("failed validation")


def test_a_throttle_waits_and_asks_again_without_spending_an_ask() -> None:
    transport = GenerationError("Gateway returned HTTP 429 on attempt 4, not retried.", True, transport=True)
    gateway = _StubGateway([transport, _answer(STARTER_READ)])
    result = write_week_read(starter(), gateway)  # type: ignore[arg-type]
    assert result.source == "llm"
    assert gateway.slept and gateway.calls == _A_DRAFT_AND_ONE_MORE


def test_a_spent_budget_ends_the_read_at_its_facts_block_named_for_the_budget() -> None:
    gateway = _StubGateway([BudgetSpentError("the run's budget is spent")])
    result = write_week_read(starter(), gateway)  # type: ignore[arg-type]
    assert result.source == "facts"
    assert result.fallback == "the run's budget is spent"


def test_a_bye_read_is_written_and_never_recommends_him() -> None:
    gateway = _StubGateway([_answer(BYE_READ)])
    result = write_week_read(on_bye(), gateway)  # type: ignore[arg-type]
    assert result.source == "llm", result.attempts


def _stored(sheet_week: int = 6, **changes: object) -> StoredWeekRead:
    row = StoredWeekRead(
        player_id="00-0038542",
        season=2026,
        week=sheet_week,
        source="llm",
        body="A read.",
        model="m/x",
        written_at=datetime(2026, 10, 16, 2, 0, tzinfo=UTC),
        facts_at=REPORT - timedelta(days=1),
        stamps={},
        projection_points=15.2,
        status="questionable",
        reason=FIRST,
    )
    return replace(row, **changes)  # type: ignore[arg-type]


def test_the_cadence_writes_a_first_read_a_status_change_and_a_projection_move_past_a_point() -> None:
    sheet = questionable()
    assert due_reason(sheet, None) == FIRST
    assert due_reason(sheet, _stored(sheet_week=5)) == FIRST
    assert due_reason(sheet, _stored()) is None
    assert due_reason(replace(sheet, status=Status("out", REPORT)), _stored()) == STATUS_CHANGED
    assert due_reason(sheet, _stored(projection_points=16.3)) == PROJECTION_MOVED
    assert due_reason(sheet, _stored(projection_points=16.2)) is None
    assert due_reason(sheet, _stored(source="facts")) == UNWRITTEN


def test_a_sentence_on_two_pages_keeps_its_first_carrier_in_board_order() -> None:
    shared = "Start him with confidence this week."
    reads = {
        "a": _stored(player_id="a", body=f"One read. {shared}"),
        "b": _stored(player_id="b", body=f"Another read entirely. {shared}"),
        "c": _stored(player_id="c", body="A third read with its own words."),
        "d": _stored(player_id="d", body=f"A facts block. {shared}", source="facts"),
    }
    sentences = shared_week_sentences(reads)
    assert [s.player_ids for s in sentences] == [("a", "b")]
    assert [pid for pid, _ in week_demotions(sentences, ["b", "a", "c"])] == ["a"]


def test_a_sheet_written_now_takes_the_written_instant() -> None:
    assert starter().written_at == WRITTEN_AT


@pytest.mark.parametrize("status", ["out", "injured_reserve", "suspended"])
def test_a_status_that_keeps_him_out_means_he_cannot_play(status: str) -> None:
    assert not replace(starter(), status=Status(status, REPORT)).can_play
    assert replace(starter(), status=Status("questionable", REPORT)).can_play
