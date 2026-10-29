"""Lane 52: a throttle is not a block. A gateway rate limit or a transport failure waits and asks
again with the same prompt; it never spends one of the page's six asks and never ends in a facts
block while the waits last. The run's budget (`write --budget`, calls or dollars) is a hard stop at
the gateway itself, so a re-ask never carries a run past it. The gateway is stubbed throughout."""

import json
from collections.abc import Callable, Iterator, Sequence
from datetime import UTC, datetime
from types import SimpleNamespace
from typing import Any, cast

import httpx
import pytest

from research.capsules import generate
from research.capsules import sweep as sweep_module
from research.capsules.config import CAPSULE_CONFIG, WriterSettings
from research.capsules.gateway import Completion, GatewayClient, GenerationError
from research.capsules.gateway_ledger import ModelPrice, Usage
from research.capsules.generate import CapsuleResult, ask, describe_fallback, generate_capsule
from research.capsules.narrative import NarrativeResult
from research.capsules.run_budget import BudgetSpentError, RunBudget, parse_budget
from research.capsules.throttle_waits import AskWaits, RunWaits, run_wait_cap_s
from research.capsules.validate import ValidationResult
from research.nightly import capsule_step
from research.nightly.capsule_gate import CapsuleGateResult
from research.nightly.capsule_step import CapsuleSpend

WAITS = CAPSULE_CONFIG.throttle_waits_ms
_WORDS = " ".join(["word"] * 30)
_BUNDLE = json.dumps({"compact": "A short note.", "full": "A long note.", "narrative": {}})
_PRICE = ModelPrice("m/x", 0.15, 0.50, "test")  # dollars per million tokens, in and out
_THROTTLES = 2
_CALL_CAP = 3
_A_CALL_AND_ITS_RETRY = 2
_DOLLAR_CAP = 0.0035
_CALL_COST = 0.001


def _transport() -> GenerationError:
    return GenerationError("Gateway request failed (ReadTimeout) after its retry.", True, transport=True)


class _StubGateway:
    """The gateway as `generate` sees it: each ask takes the next scripted answer or error."""

    model = "m/x"

    def __init__(self, script: Sequence[Completion | GenerationError]) -> None:
        self.script: Iterator[Completion | GenerationError] = iter(script)
        self.calls = 0
        self.slept: list[float] = []
        self.asked: list[str] = []
        self.waits = RunWaits()

    def ask_waits(self) -> AskWaits:
        return self.waits.ask()

    def complete(
        self, messages: list[dict[str, str]], max_tokens: int, min_words: int = 20, ask: AskWaits | None = None
    ) -> Completion:
        self.calls += 1
        self.asked.append(messages[-1]["content"])
        item = next(self.script)
        if isinstance(item, GenerationError):
            raise item
        return item

    def sleep(self, seconds: float) -> None:
        self.slept.append(seconds)


@pytest.fixture
def quiet_page(monkeypatch: pytest.MonkeyPatch) -> None:
    """Every collaborator that needs a real sheet stubbed: each read passes, no narrative slots."""
    monkeypatch.setattr(generate, "narrative_requests_for", lambda facts: ())
    monkeypatch.setattr(generate, "bundle_prompt_for", lambda facts, requests, worn: "the bundle prompt")
    monkeypatch.setattr(generate, "writer_rules_for", lambda facts: "the rules")
    monkeypatch.setattr(generate, "correction_prompt_for", lambda facts, size, prior: f"correct the {size} note")
    monkeypatch.setattr(generate, "render_facts_block", lambda facts: "his facts")
    monkeypatch.setattr(generate, "grounding_of", lambda facts: None)
    monkeypatch.setattr(generate, "settle_narrative", lambda raw, facts, requests, model: NarrativeResult())
    monkeypatch.setattr(
        generate, "validate_capsule", lambda body, facts, size, asked_shorter=False: ValidationResult(True, ())
    )


def _write(gateway: _StubGateway) -> CapsuleResult:
    return generate_capsule(cast("Any", None), cast("GatewayClient", gateway))


@pytest.mark.usefixtures("quiet_page")
def test_a_throttled_bundle_waits_and_asks_again_with_the_same_prompt() -> None:
    gateway = _StubGateway([*([_transport()] * _THROTTLES), Completion(_BUNDLE, Usage(cost_usd=_CALL_COST))])
    result = _write(gateway)
    assert result.source == "llm"
    assert gateway.slept == [w / 1000 for w in WAITS[:_THROTTLES]]
    assert gateway.asked == ["the bundle prompt"] * (_THROTTLES + 1)
    # Every ask the gateway saw is on the page's bill, the throttled ones included.
    assert result.calls == _THROTTLES + 1


@pytest.mark.usefixtures("quiet_page")
def test_a_throttle_never_spends_one_of_the_pages_six_asks(monkeypatch: pytest.MonkeyPatch) -> None:
    """Each read fails its draft and needs every correction it is allowed: the throttles in between
    leave the page the same corrections it would have had without them."""
    verdicts = iter([False, False, True, True])  # compact draft, full draft, then each correction passes
    monkeypatch.setattr(
        generate,
        "validate_capsule",
        lambda body, facts, size, asked_shorter=False: (
            ValidationResult(True, ()) if next(verdicts) else ValidationResult(False, ("The completion was empty.",))
        ),
    )
    answer = Completion(_WORDS, Usage(cost_usd=0.001))
    gateway = _StubGateway([Completion(_BUNDLE, None), _transport(), answer, _transport(), _transport(), answer])
    result = _write(gateway)
    assert result.source == "llm"
    assert [len(r.attempts) for r in (result.compact, result.full)] == [2, 2]


@pytest.mark.usefixtures("quiet_page")
def test_a_gateway_down_through_every_wait_is_the_facts_block_named_throttled() -> None:
    gateway = _StubGateway([_transport()] * (len(WAITS) + 1))
    result = _write(gateway)
    assert result.source == "facts"
    assert describe_fallback(result.compact, result.full) == "facts (throttled)"
    assert gateway.slept == [w / 1000 for w in WAITS]


@pytest.mark.usefixtures("quiet_page")
def test_a_generation_the_gateway_lost_is_charged_a_whole_generations_asks() -> None:
    """Review 73 item 5: a bundle lost to a throttle, a refusal or an empty answer is one or two asks,
    which under the asks ceiling would let a page under a 429 storm start up to seven ordinary
    generations; charged the whole six, it starts two and the grace, the ceiling's three drafts."""
    whole = CAPSULE_CONFIG.max_gateway_calls_per_player
    throttled = _write(_StubGateway([_transport()] * (len(WAITS) + 1)))
    refused = _write(_StubGateway([GenerationError("Gateway refused the request: HTTP 400.", False)] * 2))
    assert (throttled.asks, refused.asks) == (whole, whole)
    clean = _write(_StubGateway([Completion(_BUNDLE, None)]))
    assert clean.asks == 1


@pytest.mark.usefixtures("quiet_page")
def test_any_generation_that_ends_in_its_facts_block_is_charged_a_whole_generations_asks() -> None:
    """Re-review 73 N1, ruled: a bundle answered twice with no JSON object (two empty answers) falls to
    its facts block on two asks; whatever ended it, a generation ending in its facts block is charged
    the whole six, so a page starts at most two ordinary generations and the grace."""
    result = _write(_StubGateway([Completion("", None), Completion("", None)]))
    assert result.source == "facts"
    assert result.asks == CAPSULE_CONFIG.max_gateway_calls_per_player


def test_a_page_whose_generations_the_gateway_loses_starts_three_drafts_a_night() -> None:
    whole = CAPSULE_CONFIG.max_gateway_calls_per_player
    assert capsule_step.spent_out_for({"p": whole}, frozenset(), grace=False) == frozenset()
    assert capsule_step.spent_out_for({"p": 2 * whole}, frozenset(), grace=False) == {"p"}
    assert capsule_step.spent_out_for({"p": 2 * whole}, frozenset(), grace=True) == frozenset()
    assert capsule_step.spent_out_for({"p": 3 * whole}, frozenset({"p"}), grace=True) == {"p"}


@pytest.mark.usefixtures("quiet_page")
def test_a_refused_request_or_a_degenerate_completion_is_not_waited_out() -> None:
    """Only a rate limit or a transport failure waits: a 4xx is ours to fix, and a cut or empty
    completion is the writer's answer, an ask like any other."""
    for error in (
        GenerationError("Gateway refused the request: HTTP 400.", False),
        GenerationError("Gateway returned an empty completion after its retry.", True),
    ):
        gateway = _StubGateway([error, error])
        result = _write(gateway)
        assert result.source == "facts"
        assert gateway.slept == []
        assert (
            describe_fallback(result.compact, result.full) == "facts (the gateway's answer was refused, empty or cut)"
        )


@pytest.mark.usefixtures("quiet_page")
def test_an_empty_correction_is_an_ask_spent_and_the_read_asks_again(monkeypatch: pytest.MonkeyPatch) -> None:
    """Lane 52's sample: Hockenson's short note fell to the facts block on one empty answer with asks
    left. The empty answer spends its ask, and the read asks again while asks remain."""
    verdicts = iter([True, False, True])  # the full draft passes, the short draft fails, its correction passes
    monkeypatch.setattr(
        generate,
        "validate_capsule",
        lambda body, facts, size, asked_shorter=False: (
            ValidationResult(True, ()) if next(verdicts) else ValidationResult(False, ("The completion was empty.",))
        ),
    )
    empty = GenerationError("Gateway returned an empty completion after its retry.", True)
    answer = Completion(_WORDS, Usage(cost_usd=_CALL_COST))
    gateway = _StubGateway([Completion(_BUNDLE, None), empty, answer])
    result = _write(gateway)
    assert result.source == "llm"
    assert gateway.slept == []
    assert len(result.compact.attempts) == _THROTTLES  # the draft and the correction that passed


class _ReAskingGateway(_StubGateway):
    """Each ask costs the gateway two HTTP calls: its own re-ask of an empty or cut completion."""

    def complete(
        self, messages: list[dict[str, str]], max_tokens: int, min_words: int = 20, ask: AskWaits | None = None
    ) -> Completion:
        self.calls += 1
        return super().complete(messages, max_tokens, min_words, ask)


@pytest.mark.usefixtures("quiet_page")
def test_a_page_counts_its_writers_asks_apart_from_the_gateways_http_calls(monkeypatch: pytest.MonkeyPatch) -> None:
    """Lane 73 ruling 1: the night's ceiling counts the writer's own asks; the gateway's HTTP re-asks
    and the throttle's waits are on the bill (`calls`) but never an ask (`asks`)."""
    verdicts = iter([True, False, True])  # the full draft passes, the short draft fails, its correction passes
    monkeypatch.setattr(
        generate,
        "validate_capsule",
        lambda body, facts, size, asked_shorter=False: (
            ValidationResult(True, ()) if next(verdicts) else ValidationResult(False, ("The completion was empty.",))
        ),
    )
    answer = Completion(_WORDS, Usage(cost_usd=_CALL_COST))
    gateway = _ReAskingGateway([_transport(), Completion(_BUNDLE, None), answer])
    result = _write(gateway)
    assert result.source == "llm"
    assert result.asks == _A_CALL_AND_ITS_RETRY  # the bundle and the short note's correction
    assert result.calls == gateway.calls == 6  # noqa: PLR2004 - three asks to the stub, two HTTP calls each


def test_the_nights_calls_per_player_are_the_writers_asks() -> None:
    report = sweep_module.SweepReport(datetime(2026, 10, 17, 5, tzinfo=UTC), 1, 1)
    result = cast("CapsuleResult", SimpleNamespace(calls=9, asks=6, retry_asks=0, usage=None))
    sweep_module._count_spend(report, cast("Any", SimpleNamespace(universe_id="u1")), result)
    assert report.calls == 9  # noqa: PLR2004 - the bill counts every HTTP call
    assert report.asks_by_player == {"u1": 6}


@pytest.mark.usefixtures("quiet_page")
def test_a_spent_run_budget_stops_the_page_and_says_so() -> None:
    gateway = _StubGateway([BudgetSpentError("the run's budget is spent")])
    result = _write(gateway)
    assert result.source == "facts"
    assert gateway.slept == []
    assert describe_fallback(result.compact, result.full) == "facts (the run's budget is spent)"


# The gateway's own reading of a failure.


def _client(answer: Callable[[httpx.Request], httpx.Response], budget: RunBudget | None = None) -> GatewayClient:
    http = httpx.Client(transport=httpx.MockTransport(answer))
    client = GatewayClient.for_run("k", http, WriterSettings("m/x", 2, 600), sleep=lambda _: None)
    return client if budget is None else client.with_budget(budget)


def _ok(content: str = _WORDS, cost: float = 0.001) -> httpx.Response:
    return httpx.Response(
        200,
        json={
            "choices": [{"message": {"content": content}, "finish_reason": "stop"}],
            "usage": {"prompt_tokens": 100, "completion_tokens": 50, "total_tokens": 150, "cost": cost},
        },
    )


def test_a_rate_limit_a_server_error_and_a_network_error_are_transport_failures() -> None:
    def network(request: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("slow", request=request)

    for answer in (lambda r: httpx.Response(429), lambda r: httpx.Response(503), network):
        with pytest.raises(GenerationError) as caught:
            _client(answer).complete([{"role": "user", "content": "hi"}], 10)
        assert caught.value.transport


def test_a_refusal_and_a_degenerate_completion_are_not_transport_failures() -> None:
    for answer in (lambda r: httpx.Response(400), lambda r: _ok("")):
        with pytest.raises(GenerationError) as caught:
            _client(answer).complete([{"role": "user", "content": "hi"}], 10)
        assert not caught.value.transport


# The run's budget.


def test_the_budget_reads_calls_or_dollars() -> None:
    assert parse_budget("120") == RunBudget.of(calls=120)
    assert parse_budget("$0.20") == RunBudget.of(usd=0.20)
    for bad in ("", "-3", "0", "$", "$-1", "twenty"):
        with pytest.raises(ValueError, match="budget"):
            parse_budget(bad)


def test_a_call_budget_stops_the_gateway_at_its_last_call_retries_included() -> None:
    budget = RunBudget.of(calls=_CALL_CAP)
    client = _client(lambda r: httpx.Response(503), budget)
    with pytest.raises(GenerationError):
        client.complete([{"role": "user", "content": "hi"}], 10)  # a call and its retry: 2 of 3
    assert client.calls == _A_CALL_AND_ITS_RETRY
    with pytest.raises(BudgetSpentError):
        client.complete([{"role": "user", "content": "hi"}], 10)  # its third call fails, the retry is refused
    assert client.calls == budget.calls_made == _CALL_CAP


def test_a_dollar_budget_never_starts_a_call_whose_worst_case_could_pass_it() -> None:
    """The worst case of a call is its prompt's characters (never fewer than its tokens) at the input
    price plus its whole completion allowance at the output price; a call settles at the cost the
    gateway states."""
    prompt = "x" * 1_000
    worst = (1_000 + RunBudget.MESSAGE_OVERHEAD_TOKENS) * 0.15 / 1e6 + 1_000 * 0.50 / 1e6
    budget = RunBudget.of(usd=_DOLLAR_CAP, price=_PRICE)
    client = _client(lambda r: _ok(cost=_CALL_COST), budget)
    started = 3
    assert (started - 1) * _CALL_COST + worst <= _DOLLAR_CAP < started * _CALL_COST + worst  # the fourth may not
    for _ in range(started):
        client.complete([{"role": "user", "content": prompt}], 1_000)
    assert budget.spent_usd == pytest.approx(started * _CALL_COST)
    with pytest.raises(BudgetSpentError):
        client.complete([{"role": "user", "content": prompt}], 1_000)
    assert client.calls == started


def test_a_dollar_budget_needs_a_price() -> None:
    with pytest.raises(ValueError, match="price"):
        RunBudget.of(usd=0.20).reserve(100, 100)


def test_a_page_starts_only_when_its_worst_case_fits_the_budget() -> None:
    worst_calls = CAPSULE_CONFIG.max_gateway_calls_per_player
    calls = RunBudget.of(calls=2 * worst_calls)
    assert calls.room_for_page()
    calls.calls_made = worst_calls + 1
    assert not calls.room_for_page()
    dollars = RunBudget.of(usd=0.20, price=_PRICE)
    assert dollars.room_for_page()
    dollars.spent_usd = 0.20 - dollars.worst_page_usd() + 1e-9
    assert not dollars.room_for_page()
    assert RunBudget.of().room_for_page()


# One allowance for every throttle wait (the review's M1).

_LONG_RETRY_AFTER_S = 200  # under the gateway's 300 s retry-after cap, over an ask's 150 s


def _sleeps(client: GatewayClient) -> list[float]:
    slept: list[float] = []
    client.sleep = slept.append
    return slept


@pytest.mark.usefixtures("quiet_page")
def test_a_long_retry_after_never_holds_an_ask_past_its_cap_and_the_page_says_throttled() -> None:
    client = _client(lambda r: httpx.Response(429, headers={"retry-after": str(_LONG_RETRY_AFTER_S)}))
    slept = _sleeps(client)
    result = generate_capsule(cast("Any", None), client)
    assert result.source == "facts"
    assert describe_fallback(result.compact, result.full) == "facts (throttled)"
    assert result.compact.fallback is not None
    assert "throttle wait cap" in str(result.compact.fallback.first_violation)
    assert sum(slept) <= CAPSULE_CONFIG.throttle_ask_wait_cap_ms / 1000
    assert _LONG_RETRY_AFTER_S not in slept


def test_the_gateways_own_429_backoffs_draw_on_the_asks_allowance() -> None:
    client = _client(lambda r: httpx.Response(429))
    slept = _sleeps(client)
    ask = client.ask_waits()
    with pytest.raises(GenerationError):
        client.complete([{"role": "user", "content": "hi"}], 10, ask=ask)
    backoffs = sum(CAPSULE_CONFIG.gateway.retry.rate_limit_backoff_ms) / 1000
    assert sum(slept) == pytest.approx(backoffs)
    assert ask.left_s == pytest.approx(CAPSULE_CONFIG.throttle_ask_wait_cap_ms / 1000 - backoffs)


def test_a_runs_throttle_waits_are_bounded_across_its_asks() -> None:
    pool = RunWaits(cap_s=20)
    first, second = pool.ask(), pool.ask()
    assert first.take(15)
    assert not second.take(15)
    assert second.take(5)
    assert not first.take(1)


# The re-review's N2: the run's pool sized to the run, said loudly when dry, and re-asks that fit.

_ASK_CAP_S = CAPSULE_CONFIG.throttle_ask_wait_cap_ms / 1000
_SLOTS = 16
_POOL_AT_16_S = 4_800


def _answers(*responses: httpx.Response) -> Callable[[httpx.Request], httpx.Response]:
    queue = iter(responses)
    return lambda request: next(queue)


def test_the_runs_pool_is_an_asks_cap_per_slot_twice_over() -> None:
    assert run_wait_cap_s(_SLOTS) == _POOL_AT_16_S
    http = httpx.Client(transport=httpx.MockTransport(lambda r: _ok()))
    client = GatewayClient.for_run("k", http, WriterSettings("m/x", _SLOTS, 600))
    assert client.waits.cap_s == _POOL_AT_16_S


def test_an_ask_that_meets_429s_on_every_call_still_makes_all_its_re_asks_inside_the_cap() -> None:
    client = _client(lambda r: httpx.Response(429))
    slept = _sleeps(client)
    with pytest.raises(GenerationError, match="429"):
        ask(client, [{"role": "user", "content": "hi"}], 10)
    posts_per_call = len(CAPSULE_CONFIG.gateway.retry.rate_limit_backoff_ms) + 1
    assert client.calls == posts_per_call * (len(WAITS) + 1)  # the first call and every re-ask were made
    assert sum(slept) <= _ASK_CAP_S


def test_an_ask_with_two_429s_on_its_re_ask_completes_inside_the_cap() -> None:
    posts_per_call = len(CAPSULE_CONFIG.gateway.retry.rate_limit_backoff_ms) + 1
    client = _client(_answers(*[httpx.Response(429)] * (posts_per_call + 2), _ok()))
    slept = _sleeps(client)
    answer = ask(client, [{"role": "user", "content": "hi"}], 10)
    assert answer.content == _WORDS
    assert sum(slept) <= _ASK_CAP_S


@pytest.mark.usefixtures("quiet_page")
def test_a_dry_pool_is_one_loud_line_naming_the_asks_and_the_pages_it_cost() -> None:
    client = _client(lambda r: httpx.Response(429))
    client.waits = RunWaits(cap_s=1)
    _sleeps(client)
    result = generate_capsule(cast("Any", None), client)
    assert result.source == "facts"
    line = client.waits.line()
    assert line is not None
    assert line.startswith("THROTTLE ALLOWANCE SPENT after 1 asks, 1 page fell to facts")
    assert RunWaits().line() is None


def test_the_publish_gate_summary_and_the_spend_line_carry_the_alarm() -> None:
    alarm = "THROTTLE ALLOWANCE SPENT after 40 asks, 12 pages fell to facts (the run's 4800 s of throttle waits)"
    gate = CapsuleGateResult(40, 28, 12, 0, 0, (), CAPSULE_CONFIG.unwritten_line(in_season=True), throttle_alarm=alarm)
    assert gate.summary().startswith(alarm)
    assert CapsuleSpend(throttle_alarm=alarm).line().endswith(alarm)
