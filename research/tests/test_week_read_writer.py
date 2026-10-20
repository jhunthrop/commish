"""Lane 72, the week-ahead read written: the prompt and its answer (the read and the writer's call), the
writer's loop within its ceiling, the facts block as its counted fallback, the cadence (nightly and
hourly, the retry limits), the step's dollar budget, and the demotion of a sentence shape on two pages.
The gateway is stubbed throughout."""

import copy
from collections.abc import Iterator, Sequence
from dataclasses import replace
from datetime import UTC, date, timedelta
from typing import Self

import pytest

from research.capsules.gateway import Completion, GenerationError
from research.capsules.gateway_ledger import ModelPrice, Usage
from research.capsules.run_budget import BudgetSpentError
from research.capsules.throttle_waits import AskWaits, RunWaits
from research.capsules.week.cadence import (
    FIRST,
    PROJECTION_MOVED,
    STATUS_CHANGED,
    UNWRITTEN,
    due_reason,
)
from research.capsules.week.prompt import WEEK_RULES, answer_json, length_move, parse_week_answer, week_prompt
from research.capsules.week.sheet import Status
from research.capsules.week.store import StoredWeekRead
from research.capsules.week.write import MAX_CALLS_PER_READ, write_week_read
from research.nightly.week_read_demotion import shared_week_sentences, stored_facts_block, week_demotions
from research.nightly.week_reads import (
    HOURLY_BUDGET_USD,
    HOURLY_DAY_USD,
    NIGHTLY_BUDGET_USD,
    step_budget,
    worst_read_usd,
)
from research.tests.test_week_read_rules import BYE_READ, STARTER_READ
from research.tests.week_read_fixtures import REPORT, WRITTEN_AT, on_bye, questionable, starter

_USAGE = Usage(2400, 150, 2550, 0.0004)
_A_DRAFT_AND_ONE_MORE = 2
_PRICE = ModelPrice("zai/glm-5.3-flash", 0.15, 0.50, "test", True)


def _answer(text: str, call: str = "start") -> Completion:
    return Completion(answer_json(text, call), _USAGE, "provider", "stop")


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

    def with_model(self, model: str) -> "Self":
        """The judge's view: the same script, its own call count (`GatewayClient.with_model`)."""
        view = copy.copy(self)
        view.model, view.calls = model, 0
        return view

    def sleep(self, seconds: float) -> None:
        self.slept.append(seconds)


def test_the_prompt_states_the_week_the_kickoff_and_that_the_number_is_published_never_ours() -> None:
    user = week_prompt(starter(), ())
    assert "week 6 of 2026" in user and "Sunday 3:05 pm Central" in user and "18.4 points" in user
    assert "published projection" in WEEK_RULES and "never ours" in WEEK_RULES
    assert "about 65 words" in WEEK_RULES and "never more than 80" in WEEK_RULES
    assert "quote at most 3 figures" in WEEK_RULES and "Never retell the cells" in WEEK_RULES
    assert '"in our preseason order" or "in our rest-of-season order"' in WEEK_RULES
    assert '"call"' in WEEK_RULES and '"hold" means no change' in WEEK_RULES and 'calls itself "hold"' in WEEK_RULES
    for word in ("odds", "underdog", "favoured", "line", "spread", "bet", "the books"):
        assert f'"{word}"' in WEEK_RULES


def test_the_prompt_quotes_the_sentences_other_pages_carry() -> None:
    assert '"Start him with confidence."' in week_prompt(starter(), ("Start him with confidence.",))


def test_the_answer_is_the_read_and_its_call() -> None:
    assert parse_week_answer(answer_json("A read.", "Sit")).call == "sit"
    plain = parse_week_answer("A read with no object.")
    assert plain.read == "A read with no object." and plain.call is None


def test_a_read_that_passes_is_written_in_one_call() -> None:
    gateway = _StubGateway([_answer(STARTER_READ)])
    result = write_week_read(starter(), gateway)  # type: ignore[arg-type]
    assert (result.source, result.text, result.call, result.calls) == ("llm", STARTER_READ, "start", 1)
    assert result.model == "m/x" and result.usage == _USAGE


def test_a_long_read_is_told_its_count_and_the_cut() -> None:
    long_read = " ".join([STARTER_READ, STARTER_READ])
    words = len(long_read.split())
    gateway = _StubGateway([_answer(long_read), _answer(STARTER_READ)])
    assert write_week_read(starter(), gateway).source == "llm"  # type: ignore[arg-type]
    correction = gateway.asked[1][-1]["content"]
    assert f"It is {words} words, {words - 80} over the 80-word cap. Cut about {words - 65} words" in correction
    assert length_move(80) is None


def test_a_read_asked_shorter_still_holds_to_the_cap() -> None:
    """Lane 100 (B44): the cap is 80 words with no overrun, even for a read already asked to be shorter (the
    season read's 10% allowance does not carry over)."""
    extra = (
        " Davante Adams is listed second behind him, the kind of steady pecking order that keeps the targets"
        " flowing his way for now, and nothing in the facts says that changes."
    )
    longer = STARTER_READ.replace(" Start him with confidence.", extra + " Start him with confidence.")
    assert 80 < len(longer.split()) <= 88  # noqa: PLR2004 - over the cap, inside the old 10%
    script = [_answer(" ".join([STARTER_READ, STARTER_READ])), _answer(longer), _answer(STARTER_READ)]
    result = write_week_read(starter(), _StubGateway(script))  # type: ignore[arg-type]
    assert result.source == "llm" and result.text == STARTER_READ, result.attempts
    assert any("Word count" in v for v in result.attempts[1].violations), result.attempts[1]


def test_a_broken_rule_is_handed_back_with_its_sentence_and_the_rewrite_lands() -> None:
    broken = f"{STARTER_READ.removesuffix(' Start him with confidence.')} It is a safe bet he scores."
    gateway = _StubGateway([_answer(broken), _answer(STARTER_READ)])
    result = write_week_read(starter(), gateway)  # type: ignore[arg-type]
    assert result.source == "llm" and result.calls == _A_DRAFT_AND_ONE_MORE
    correction = gateway.asked[1][-1]["content"]
    assert "It is a safe bet he scores." in correction and "betting word" in correction


def test_a_start_call_for_a_player_who_may_not_start_is_handed_back() -> None:
    sheet = replace(starter(), status=Status("doubtful", REPORT))
    gateway = _StubGateway([_answer(STARTER_READ, "start")] * MAX_CALLS_PER_READ)
    result = write_week_read(sheet, gateway)  # type: ignore[arg-type]
    assert result.source == "facts"
    assert "call is start" in gateway.asked[1][-1]["content"]


def test_a_read_that_never_passes_is_the_facts_block_within_the_ceiling() -> None:
    gateway = _StubGateway([_answer("Buy him. Buy him now. Buy him today.")] * (MAX_CALLS_PER_READ + 2))
    result = write_week_read(starter(), gateway)  # type: ignore[arg-type]
    assert result.source == "facts" and result.calls == MAX_CALLS_PER_READ
    assert result.text.startswith("Week: 6 of 2026")
    assert result.fallback is not None and result.fallback.startswith("failed validation")


def test_a_throttle_waits_and_asks_again_without_spending_an_ask() -> None:
    transport = GenerationError("Gateway returned HTTP 429 on attempt 4, not retried.", True, transport=True)
    gateway = _StubGateway([transport, _answer(STARTER_READ)])
    assert write_week_read(starter(), gateway).source == "llm"  # type: ignore[arg-type]
    assert gateway.slept and gateway.calls == _A_DRAFT_AND_ONE_MORE


def test_a_spent_budget_ends_the_read_at_its_facts_block_named_for_the_budget() -> None:
    gateway = _StubGateway([BudgetSpentError("the run's budget is spent")])
    result = write_week_read(starter(), gateway)  # type: ignore[arg-type]
    assert result.source == "facts" and result.fallback == "the run's budget is spent"


def test_a_bye_read_is_written_and_never_recommends_him() -> None:
    judged_no = Completion("No", _USAGE, "provider", "stop")
    result = write_week_read(on_bye(), _StubGateway([_answer(BYE_READ, "hold"), judged_no]))  # type: ignore[arg-type]
    assert result.source == "llm" and result.calls == _A_DRAFT_AND_ONE_MORE, result.attempts


def test_the_step_holds_a_dollar_budget_under_the_nightly_bound() -> None:
    """The review's M3: the pass's own hard stop, its worst read, and a day of week reads beside $4.15."""
    budget = step_budget(_PRICE, NIGHTLY_BUDGET_USD)
    assert budget.max_usd == NIGHTLY_BUDGET_USD and budget.price == _PRICE
    assert worst_read_usd(_PRICE) == pytest.approx(4 * (3700 * 0.15 + 600 * 0.50) / 1_000_000)
    assert step_budget(ModelPrice("m", None, None, "unread", None), HOURLY_BUDGET_USD).max_calls == int(0.05 / 0.00065)
    assert pytest.approx(2.00) == NIGHTLY_BUDGET_USD + HOURLY_DAY_USD


_NOW = WRITTEN_AT


def _stored(sheet_week: int = 6, **changes: object) -> StoredWeekRead:
    row = StoredWeekRead(
        player_id="00-0038542",
        season=2026,
        week=sheet_week,
        source="llm",
        body="A read.",
        model="m/x",
        written_at=_NOW - timedelta(hours=2),
        facts_at=REPORT - timedelta(days=1),
        stamps={},
        projection_points=15.2,
        status="questionable",
        reason=FIRST,
        call="hold",
        attempt_day=date(2026, 10, 16),
        attempts=1,
    )
    return replace(row, **changes)  # type: ignore[arg-type]


def test_the_cadence_writes_a_first_read_a_status_change_and_a_projection_the_card_prints_otherwise() -> None:
    """Lane 66v: a read quotes the card's projection, so any move of the printed tenth makes it due (Josh
    Allen's read said 26.6 a day after his card moved to 26.4, under the old one-point threshold)."""
    sheet = questionable()
    assert due_reason(sheet, None, _NOW) == FIRST
    assert due_reason(sheet, _stored(sheet_week=5), _NOW) == FIRST
    assert due_reason(sheet, _stored(), _NOW) is None
    assert due_reason(replace(sheet, status=Status("out", REPORT)), _stored(), _NOW) == STATUS_CHANGED
    assert due_reason(sheet, _stored(projection_points=15.4), _NOW) == PROJECTION_MOVED
    assert due_reason(sheet, _stored(projection_points=15.1), _NOW) == PROJECTION_MOVED
    # A row kept before the card's tenth was stored reads as the tenth it printed.
    assert due_reason(sheet, _stored(projection_points=15.24), _NOW) is None
    assert due_reason(sheet, _stored(source="facts"), _NOW) == UNWRITTEN


def test_a_failed_read_is_retried_at_most_once_an_hour_and_three_times_a_day() -> None:
    sheet, today = questionable(), date(2026, 10, 16)  # 9:00 pm Central on Friday the 16th
    assert due_reason(sheet, _stored(source="facts", written_at=_NOW - timedelta(minutes=30)), _NOW) is None
    assert due_reason(sheet, _stored(source="facts", attempt_day=today, attempts=3), _NOW) is None
    assert due_reason(sheet, _stored(source="facts", attempt_day=today, attempts=2), _NOW) == UNWRITTEN


def test_the_hourly_pass_writes_only_a_status_that_moved() -> None:
    """The coordinator's ruling (Lane 66v review, finding 1): the page is prerendered, so a projection move is
    the nightly's to rewrite, never the hourly pass's."""
    sheet = questionable()
    assert due_reason(sheet, None, _NOW, hourly=True) is None
    assert due_reason(sheet, _stored(source="facts"), _NOW, hourly=True) is None
    assert due_reason(replace(sheet, status=Status("out", REPORT)), _stored(), _NOW, hourly=True) == STATUS_CHANGED
    assert due_reason(sheet, _stored(projection_points=13.0), _NOW, hourly=True) is None
    assert due_reason(sheet, _stored(projection_points=15.4), _NOW, hourly=True) is None
    assert due_reason(sheet, _stored(projection_points=15.4), _NOW) == PROJECTION_MOVED


def test_a_sentence_shape_on_two_pages_keeps_its_first_carrier_in_board_order() -> None:
    reads = {
        "a": _stored(player_id="a", body="One read. The Rams lean on Puka Nacua every single week."),
        "b": _stored(player_id="b", body="Another read entirely. The Bears lean on Rome Odunze every single week."),
        "c": _stored(player_id="c", body="A third read with its own words."),
        "d": _stored(
            player_id="d", body="A facts block. The Lions lean on Jahmyr Gibbs every single week.", source="facts"
        ),
    }
    sentences = shared_week_sentences(reads)
    assert [s.player_ids for s in sentences] == [("a", "b")]
    assert [pid for pid, _ in week_demotions(sentences, ["b", "a", "c"])] == ["a"]


def test_a_read_with_no_sheet_tonight_is_demoted_to_the_facts_its_row_states() -> None:
    assert (
        stored_facts_block(_stored())
        == "Week: 6 of 2026\nStatus: Questionable\nPublished projection: 15.2 points (PPR)"
    )


@pytest.mark.parametrize("status", ["out", "injured_reserve", "suspended"])
def test_a_status_that_keeps_him_out_means_he_cannot_play(status: str) -> None:
    assert not replace(starter(), status=Status(status, REPORT)).can_play
    assert replace(starter(), status=Status("questionable", REPORT)).can_play
    assert not replace(starter(), status=Status("doubtful", REPORT)).may_start


def test_the_written_instant_is_utc_aware() -> None:
    assert starter().written_at.tzinfo is UTC
