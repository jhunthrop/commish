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

from research.capsules.config import RETRY_WRITER_MODEL, writer_settings
from research.capsules.gateway import Completion, GenerationError
from research.capsules.gateway_ledger import ModelPrice, Usage
from research.capsules.narrative import ShapeMasks
from research.capsules.rule_notes import notes_of
from research.capsules.run_budget import BudgetSpentError
from research.capsules.throttle_waits import AskWaits, RunWaits
from research.capsules.week.cadence import (
    FIRST,
    PROJECTION_MOVED,
    RETRIES_A_DAY,
    STATUS_CHANGED,
    UNWRITTEN,
    due_reason,
)
from research.capsules.week.prompt import (
    WEEK_RULES,
    answer_json,
    length_move,
    parse_week_answer,
    week_correction,
    week_prompt,
)
from research.capsules.week.sheet import Status
from research.capsules.week.store import StoredWeekRead
from research.capsules.week.validate import validate_week_read
from research.capsules.week.write import (
    MAX_ASKS_PER_READ,
    MAX_ASKS_WITH_RETRY,
    MAX_CALLS_PER_READ,
    OVER_CAP_FALL,
    write_week_read,
)
from research.nightly.week_read_demotion import shared_week_sentences, stored_facts_block, week_demotions
from research.nightly.week_reads import (
    HOURLY_BUDGET_USD,
    HOURLY_DAY_USD,
    MIN_CHARS_PER_TOKEN,
    NIGHTLY_BUDGET_USD,
    WORST_PROMPT_TOKENS,
    WeekReadSpend,
    dearest_price,
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
        # The model each ask went to, shared with every view (`with_model`), in the order asked.
        self.models: list[str] = []
        self.waits = RunWaits()

    def ask_waits(self) -> AskWaits:
        return self.waits.ask()

    def complete(
        self, messages: list[dict[str, str]], max_tokens: int, min_words: int = 20, ask: AskWaits | None = None
    ) -> Completion:
        self.calls += 1
        self.asked.append(messages)
        self.models.append(self.model)
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
    assert "45 to 70 words in all, about 60" in WEEK_RULES and "never more than 95" in WEEK_RULES
    # Lane 117 (B95): the four rules the first nightly broke most, in the writer's words.
    assert "One figure to a sentence." in WEEK_RULES
    assert "The published projection is a cell you place inside a sentence about this player's week" in WEEK_RULES
    # Review H1 and M1: no stock projection sentence to copy, no trading word, no report name the facts never give.
    for primed in ("has him at", "the stock", "Tuesday-night"):
        assert primed not in WEEK_RULES, primed
    assert "The season once, with the first week you name" in WEEK_RULES
    assert "The injury list in the facts' own words for it" in WEEK_RULES
    assert "Pick the two or three facts that decide his week" in WEEK_RULES
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
    assert f"Your read ran {words} words, over the 95-word cap. Write it again at 60 words" in correction
    assert length_move(95) is None


def test_a_read_asked_shorter_still_holds_to_the_cap() -> None:
    """Lane 100 (B44): the cap is the cap with no overrun, even for a read already asked to be shorter (the
    season read's 10% allowance does not carry over); Lane 117 (B95, fix round 3): the cap is 95, one read
    over it is handed back, and a second over it is the facts block, never trimmed."""
    longer = _over_the_cap()
    assert 95 < len(longer.split()) <= 104  # noqa: PLR2004 - over the cap, inside the old 10%
    script = [_answer(" ".join([STARTER_READ, STARTER_READ])), _answer(longer), _answer(STARTER_READ)]
    result = write_week_read(starter(), _StubGateway(script))  # type: ignore[arg-type]
    assert (result.source, result.calls, result.fallback) == ("facts", _A_DRAFT_AND_ONE_MORE, OVER_CAP_FALL)
    assert any("Word count" in v for v in result.attempts[1].violations), result.attempts[1]


# A draft within the band that breaks another rule (a betting word): the asks it spends are not the cap's.
_BROKEN = f"{STARTER_READ.removesuffix(' Start him with confidence.')} It is a safe bet he scores."


def _over_the_cap() -> str:
    """The starter read with two sentences of plain words before its call, no figure among them: 102 words."""
    extra = (
        " Davante Adams is listed second behind him, the kind of steady pecking order that keeps the targets"
        " flowing his way for now, and nothing in the facts says that changes in this game at home, where the Rams"
        " keep turning to him whenever they need the ball moved."
    )
    return STARTER_READ.replace(" Start him with confidence.", extra + " Start him with confidence.")


def test_a_last_draft_over_the_cap_alone_is_asked_once_more_with_its_overrun_named() -> None:
    """Lane 100: the fourth draft, the first over the cap, broke only the 40 to 95 band, so the writer asks a
    fifth time, the overrun counted for it, and that read lands."""
    long_read = _over_the_cap()
    assert len(long_read.split()) > 95  # noqa: PLR2004 - the cap
    script = [*[_answer(_BROKEN)] * (MAX_CALLS_PER_READ - 1), _answer(long_read), _answer(STARTER_READ)]
    gateway = _StubGateway(script)
    result = write_week_read(starter(), gateway)  # type: ignore[arg-type]
    assert (result.source, result.text, result.calls) == ("llm", STARTER_READ, MAX_CALLS_PER_READ + 1)
    assert "Your read ran" in gateway.asked[-1][-1]["content"]


def test_the_overrun_retry_is_one_and_only_for_the_cap() -> None:
    """Lane 117 (B95, fix round 3): a draft over the cap is handed back once, naming its count and asking for
    60 words; the second over it is the facts block at once. A last draft that broke another rule gets no
    retry."""
    long_read = _over_the_cap()
    gateway = _StubGateway([_answer(long_read)] * (MAX_CALLS_PER_READ + 2))
    result = write_week_read(starter(), gateway)  # type: ignore[arg-type]
    assert (result.source, result.calls, result.fallback) == ("facts", _A_DRAFT_AND_ONE_MORE, OVER_CAP_FALL)
    assert (
        "Your read ran 102 words, over the 95-word cap. Write it again at 60 words" in gateway.asked[1][-1]["content"]
    )
    broken = f"{long_read.removesuffix(' Start him with confidence.')} It is a safe bet he scores."
    gateway = _StubGateway([_answer(_BROKEN)] * (MAX_CALLS_PER_READ - 1) + [_answer(broken)] * 3)
    result = write_week_read(starter(), gateway)  # type: ignore[arg-type]
    assert result.source == "facts" and result.calls == MAX_CALLS_PER_READ


OUT_READ = (
    "Puka Nacua is Out on Friday's report, so he does not play against Arizona in week 6 of 2026. "
    "The published projection has him at 18.4 points, but that figure does not count for a player who sits. "
    "Bench him this week and pick up a receiver who has a game."
)
# Plain words, no figure among them, that take a read over the 95-word cap.
_PLAIN_WORDS = (
    " The rest of the room is listed behind him and takes the work this week, which is the usual shape of a"
    " week off for this group, and nothing in the facts says the shape changes once he is back, since the"
    " others behind him have carried the load before and know the plays."
)


def _bye_over_the_cap() -> str:
    """The honest bye read with the plain words: over 95 words."""
    return BYE_READ.replace(" Fill his spot", _PLAIN_WORDS + " Fill his spot")


@pytest.mark.parametrize("sheet_of", [on_bye, lambda: replace(starter(), status=Status("out", REPORT))])
def test_a_bye_or_out_players_overrun_retry_carries_the_judges_ask(sheet_of: object) -> None:
    """Lane 117 (B80): the fourth draft broke only the cap; the fifth lands within it and the judge still has
    its ask, as a playing player's fifth draft needs none. A judge's yes on it ends the read with no sixth
    draft."""
    sheet = sheet_of()  # type: ignore[operator]
    honest = BYE_READ if sheet.bye else OUT_READ
    long_read = _bye_over_the_cap() if sheet.bye else OUT_READ.replace(" Bench him", _PLAIN_WORDS + " Bench him")
    assert len(long_read.split()) > 95  # noqa: PLR2004 - the cap
    judged_no = Completion("No", _USAGE, "provider", "stop")
    broken = honest.replace(" this week", " this week, a safe bet", 1)
    drafts = [*[_answer(broken, "sit")] * (MAX_CALLS_PER_READ - 1), _answer(long_read, "sit")]
    script = [*drafts, _answer(honest, "sit"), judged_no]
    result = write_week_read(sheet, _StubGateway(script))  # type: ignore[arg-type]
    assert (result.source, result.calls) == ("llm", MAX_ASKS_PER_READ), result.attempts
    judged_yes = Completion("Yes", _USAGE, "provider", "stop")
    script = [*script[:-1], judged_yes, _answer(honest, "sit")]
    result = write_week_read(sheet, _StubGateway(script))  # type: ignore[arg-type]
    assert (result.source, result.calls) == ("facts", MAX_ASKS_PER_READ)


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
    """The review's M3: the pass's own hard stop, its worst read, and a day of week reads beside $4.15 (Lane
    256: the roll-over's $2.50 with the hourly $0.60)."""
    budget = step_budget(_PRICE, NIGHTLY_BUDGET_USD)
    assert budget.max_usd == NIGHTLY_BUDGET_USD and budget.price == _PRICE
    # Four asks, Lane 100's one overrun retry and the judge's ask that rides with it (Lane 117, B80).
    # The budget's check prices a read at two asks at the heaviest prompt (Lane 117 fix round 3).
    assert worst_read_usd(_PRICE) == pytest.approx(2 * (9000 * 0.15 + 600 * 0.50) / 1_000_000)


def test_the_worst_prompt_bound_holds_the_heaviest_correction() -> None:
    """Review M4: the last correction a read can get (every rule broken so far, each with its sentence) on the
    fullest fixture sheet, counted at the fewest characters a token took, fits WORST_PROMPT_TOKENS."""
    long_read = _over_the_cap()
    broken = [long_read, _BROKEN, STARTER_READ.replace("18.4 points", "18.7 points"), "Buy him. Buy him now."]
    ledger = notes_of([(text, validate_week_read(text, starter()).violations) for text in broken])
    user = week_correction(starter(), long_read, ledger, ("Start him with confidence.",) * 12)
    chars = len(WEEK_RULES) + len(user)
    assert chars / MIN_CHARS_PER_TOKEN <= WORST_PROMPT_TOKENS, chars
    assert step_budget(ModelPrice("m", None, None, "unread", None), HOURLY_BUDGET_USD).max_calls == int(0.05 / 0.00065)
    assert pytest.approx(4.00) == NIGHTLY_BUDGET_USD + HOURLY_DAY_USD


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


def test_the_cadence_writes_a_first_read_a_status_change_and_a_projection_past_the_proj_change_threshold() -> None:
    """Lane 256: after the roll-over a read is rewritten for a published projection that moved past the Proj
    change tile's threshold (the page's serve rule), never for a smaller move, which rewrote the whole board
    mid-week (330 reads on the night of 2026-10-21)."""
    sheet = questionable()  # the card prints 15.2
    assert due_reason(sheet, None, _NOW) == FIRST
    assert due_reason(sheet, _stored(sheet_week=5), _NOW) == FIRST
    assert due_reason(sheet, _stored(), _NOW) is None
    assert due_reason(replace(sheet, status=Status("out", REPORT)), _stored(), _NOW) == STATUS_CHANGED
    assert due_reason(sheet, _stored(projection_points=15.7), _NOW) == PROJECTION_MOVED
    assert due_reason(sheet, _stored(projection_points=14.7), _NOW) == PROJECTION_MOVED
    assert due_reason(sheet, _stored(projection_points=15.6), _NOW) is None
    assert due_reason(sheet, _stored(projection_points=15.1), _NOW) is None
    assert due_reason(sheet, _stored(projection_points=None), _NOW) == PROJECTION_MOVED
    # A row kept before the card's tenth was stored reads as the tenth it printed.
    assert due_reason(sheet, _stored(projection_points=15.24), _NOW) is None
    assert due_reason(sheet, _stored(source="facts"), _NOW) == UNWRITTEN


def test_a_failed_read_is_retried_at_most_once_an_hour_and_every_hour_of_a_central_day() -> None:
    """Lane 276: the day's count is the day's hours, so after the roll-over's rounds a fallen read is still
    asked every hour; the gap holds it to one ask an hour."""
    sheet, today = questionable(), date(2026, 10, 16)  # 9:00 pm Central on Friday the 16th
    assert RETRIES_A_DAY == 24  # noqa: PLR2004 - the hours of a Central day
    assert due_reason(sheet, _stored(source="facts", written_at=_NOW - timedelta(minutes=30)), _NOW) is None
    assert due_reason(sheet, _stored(source="facts", attempt_day=today, attempts=RETRIES_A_DAY), _NOW) is None
    late = _stored(source="facts", attempt_day=today, attempts=RETRIES_A_DAY - 1)
    assert due_reason(sheet, late, _NOW) == UNWRITTEN
    assert due_reason(sheet, late, _NOW, hourly=True) == UNWRITTEN
    yesterday = _stored(source="facts", attempt_day=today - timedelta(days=1), attempts=RETRIES_A_DAY)
    assert due_reason(sheet, yesterday, _NOW, hourly=True) == UNWRITTEN


def test_the_hourly_pass_writes_a_status_that_moved_and_a_read_still_unwritten() -> None:
    """The coordinator's ruling (Lane 66v review, finding 1): the page is prerendered, so a projection move is
    the nightly's to rewrite, never the hourly pass's. Lane 276: a fallen read is the hourly pass's too."""
    sheet = questionable()
    assert due_reason(sheet, None, _NOW, hourly=True) is None
    assert due_reason(sheet, _stored(source="facts"), _NOW, hourly=True) == UNWRITTEN
    assert due_reason(replace(sheet, status=Status("out", REPORT)), _stored(), _NOW, hourly=True) == STATUS_CHANGED
    assert due_reason(sheet, _stored(projection_points=13.0), _NOW, hourly=True) is None
    assert due_reason(sheet, _stored(projection_points=15.8), _NOW, hourly=True) is None
    assert due_reason(sheet, _stored(projection_points=15.8), _NOW) == PROJECTION_MOVED


def test_a_sentence_shape_on_two_pages_keeps_its_first_carrier_in_board_order() -> None:
    reads = {
        "a": _stored(player_id="a", body="One read. The Rams lean on Puka Nacua every single week."),
        "b": _stored(player_id="b", body="Another read entirely. The Bears lean on Rome Odunze every single week."),
        "c": _stored(player_id="c", body="A third read with its own words."),
        "d": _stored(
            player_id="d", body="A facts block. The Lions lean on Jahmyr Gibbs every single week.", source="facts"
        ),
    }
    sentences = shared_week_sentences(reads, ShapeMasks.of(("Puka Nacua", "Rome Odunze", "Jahmyr Gibbs")))
    # Both shapes of the sentence (the placeholder and the word shape) name the same two pages.
    assert {s.player_ids for s in sentences} == {("a", "b")}
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


# THE RETRY WRITER (Lane 276): one more draft of a read the writer's asks could not write.

_RETRY = "r/retry"
_JUDGED_NO = Completion("No", _USAGE, "provider", "stop")
_JUDGED_YES = Completion("Yes", _USAGE, "provider", "stop")
_BROKEN_BYE = BYE_READ.replace(" this week", " this week, a safe bet", 1)


def test_the_retry_writer_is_asked_only_after_the_writers_asks_are_spent_and_its_rescue_is_written() -> None:
    gateway = _StubGateway([*[_answer(_BROKEN)] * MAX_CALLS_PER_READ, _answer(STARTER_READ)])
    result = write_week_read(starter(), gateway, retry_model=_RETRY)  # type: ignore[arg-type]
    assert gateway.models == ["m/x"] * MAX_CALLS_PER_READ + [_RETRY]
    assert (result.source, result.text, result.model, result.fallback) == ("llm", STARTER_READ, _RETRY, None)
    assert (result.calls, result.retry_asks, result.rescued) == (MAX_CALLS_PER_READ + 1, 1, True)
    # The retry writer is handed the correction of the writer's last draft, every rule broken so far named.
    correction = gateway.asked[-1][-1]["content"]
    assert "It is a safe bet he scores." in correction and "betting word" in correction
    assert gateway.asked[-1][0]["content"] == WEEK_RULES


def test_a_read_the_writer_writes_never_asks_the_retry_writer() -> None:
    gateway = _StubGateway([_answer(_BROKEN), _answer(STARTER_READ)])
    result = write_week_read(starter(), gateway, retry_model=_RETRY)  # type: ignore[arg-type]
    assert _RETRY not in gateway.models
    assert (result.source, result.retry_asks, result.rescued) == ("llm", 0, False)


def test_a_gateway_fall_never_asks_the_retry_writer() -> None:
    """A spent budget ends the read at once, retry writer and all (a read the budget stopped writes nothing)."""
    gateway = _StubGateway([BudgetSpentError("the run's budget is spent")])
    result = write_week_read(starter(), gateway, retry_model=_RETRY)  # type: ignore[arg-type]
    assert gateway.models == ["m/x"] and result.retry_asks == 0
    assert result.fallback == "the run's budget is spent"


def test_with_no_retry_writer_the_read_falls_within_the_writers_ceiling() -> None:
    gateway = _StubGateway([_answer(_BROKEN)] * (MAX_CALLS_PER_READ + 1))
    result = write_week_read(starter(), gateway)  # type: ignore[arg-type]
    assert (result.source, result.calls, result.retry_asks) == ("facts", MAX_CALLS_PER_READ, 0)


def test_the_retry_writer_is_a_setting_its_default_the_measured_build_and_empty_turns_it_off() -> None:
    assert writer_settings({}).retry_model == RETRY_WRITER_MODEL == "deepseek/deepseek-v4.1-flash-1017"
    assert writer_settings({"RETRY_WRITER_MODEL": ""}).retry_model is None
    assert writer_settings({"RETRY_WRITER_MODEL": "  "}).retry_model is None
    assert writer_settings({"RETRY_WRITER_MODEL": " a/b "}).retry_model == "a/b"


def test_a_retry_draft_that_breaks_a_rule_is_the_facts_block_named_for_it() -> None:
    gateway = _StubGateway([_answer(_BROKEN)] * (MAX_CALLS_PER_READ + 1))
    result = write_week_read(starter(), gateway, retry_model=_RETRY)  # type: ignore[arg-type]
    assert (result.source, result.model, result.retry_asks, result.rescued) == ("facts", None, 1, False)
    assert result.calls == MAX_CALLS_PER_READ + 1 and len(result.attempts) == MAX_CALLS_PER_READ + 1
    assert result.fallback is not None and result.fallback.startswith("failed validation")
    assert result.text.startswith("Week: 6 of 2026")


def test_a_bye_players_rescue_goes_to_the_same_judge() -> None:
    """The writer's four drafts break a rule; the retry writer's honest bye read is judged by the judge's model
    (no: written as the retry writer's; yes: the facts block), its ask beyond the writer's ceiling."""
    drafts = [_answer(_BROKEN_BYE, "sit")] * MAX_CALLS_PER_READ
    gateway = _StubGateway([*drafts, _answer(BYE_READ, "sit"), _JUDGED_NO])
    result = write_week_read(on_bye(), gateway, judge_model="j/judge", retry_model=_RETRY)  # type: ignore[arg-type]
    assert gateway.models[-2:] == [_RETRY, "j/judge"]
    assert (result.source, result.model, result.rescued) == ("llm", _RETRY, True)
    assert result.calls == MAX_CALLS_PER_READ + 2
    refused_gateway = _StubGateway([*drafts, _answer(BYE_READ, "sit"), _JUDGED_YES])
    refused = write_week_read(on_bye(), refused_gateway, retry_model=_RETRY)  # type: ignore[arg-type]
    assert (refused.source, refused.rescued) == ("facts", False)
    assert refused.fallback is not None and refused.fallback.startswith("failed validation")


def test_a_reads_worst_case_with_the_retry_writer_is_its_ceiling_and_two_asks() -> None:
    """The overrun's draft and its judge, then the retry writer's draft and the judge on it: never more."""
    drafts = [*[_answer(_BROKEN_BYE, "sit")] * (MAX_CALLS_PER_READ - 1), _answer(_bye_over_the_cap(), "sit")]
    script = [*drafts, _answer(BYE_READ, "sit"), _JUDGED_YES, _answer(BYE_READ, "sit"), _JUDGED_NO]
    result = write_week_read(on_bye(), _StubGateway(script), retry_model=_RETRY)  # type: ignore[arg-type]
    assert (result.source, result.calls, result.rescued) == ("llm", MAX_ASKS_WITH_RETRY, True)


def test_the_pass_line_counts_the_retry_writers_asks_and_rescues() -> None:
    spend = WeekReadSpend(retry_model=_RETRY)
    rescued = _StubGateway([*[_answer(_BROKEN)] * MAX_CALLS_PER_READ, _answer(STARTER_READ)])
    spend.add(write_week_read(starter(), rescued, retry_model=_RETRY))  # type: ignore[arg-type]
    fallen = _StubGateway([_answer(_BROKEN)] * (MAX_CALLS_PER_READ + 1))
    spend.add(write_week_read(starter(), fallen, retry_model=_RETRY))  # type: ignore[arg-type]
    assert "2 asked of the retry writer r/retry, 1 rescued" in spend.line()
    assert "the retry writer off" in WeekReadSpend().line()


def test_the_pass_budget_reserves_at_the_dearest_models_price() -> None:
    cheaper = ModelPrice(_RETRY, 0.075, 0.30, "test", True)
    dearest = dearest_price([cheaper, _PRICE])
    assert (dearest.input_usd_per_million, dearest.output_usd_per_million) == (0.15, 0.50)
    unread = dearest_price([_PRICE, ModelPrice(_RETRY, None, None, "unread", None)])
    assert step_budget(unread, HOURLY_BUDGET_USD).max_usd is None
