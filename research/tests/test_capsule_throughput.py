"""The writer's throughput (Lane 24), with the gateway stubbed (`httpx.MockTransport`) and a fake
clock: the token bucket, the bounded pool and its scoped views, the 429 handling per call and per
line, the ledger and the price list, the settings from the environment, and the wave gate."""

import json
import threading
import time
from collections.abc import Callable, Iterator
from contextlib import nullcontext
from datetime import UTC, datetime
from types import SimpleNamespace
from typing import Any, cast

import httpx
import pytest
from sqlalchemy import Engine

from research.capsules import sweep
from research.capsules.config import CAPSULE_CONFIG, CAPSULE_MODEL, WriterSettings, writer_settings
from research.capsules.gateway import GatewayClient, GenerationError, fetch_price
from research.capsules.pace import TokenBucket
from research.capsules.prompt import WornPhrases
from research.capsules.spans import SpanRules
from research.capsules.sweep import Subject, SweepPlan, sweep_capsules
from research.capsules.waves import wave_collisions, waves
from research.errors import ConfigurationError

NOW = datetime(2026, 10, 15, 5, tzinfo=UTC)
_WORDS = " ".join(["word"] * 30)
WIDTH = 3
SIZES = (1, 2, 3, 1, 2, 3, 1)
RETRY_AFTER = 3.0


class FakeClock:
    """A monotonic clock that only moves when something sleeps on it."""

    def __init__(self) -> None:
        self.now = 0.0
        self.slept: list[float] = []
        self._lock = threading.Lock()

    def __call__(self) -> float:
        with self._lock:
            return self.now

    def sleep(self, seconds: float) -> None:
        with self._lock:
            self.slept.append(seconds)
            self.now += seconds


def _ok(content: str = _WORDS, cost: float = 0.001, provider: str = "cerebras") -> httpx.Response:
    return httpx.Response(
        200,
        json={
            "choices": [
                {
                    "message": {
                        "content": content,
                        "provider_metadata": {"gateway": {"routing": {"finalProvider": provider}}},
                    }
                }
            ],
            "usage": {"prompt_tokens": 100, "completion_tokens": 50, "total_tokens": 150, "cost": cost},
        },
    )


def _client(
    responses: Callable[[httpx.Request], httpx.Response], clock: FakeClock, settings: WriterSettings | None = None
) -> GatewayClient:
    http = httpx.Client(transport=httpx.MockTransport(responses))
    return GatewayClient.for_run("test-key", http, settings or WriterSettings("m/x", 4, 60), clock, clock.sleep)


def _scripted(*answers: httpx.Response) -> Callable[[httpx.Request], httpx.Response]:
    queue: Iterator[httpx.Response] = iter(answers)
    return lambda request: next(queue)


# The bucket.


def test_the_bucket_lets_its_capacity_through_then_spaces_calls_at_its_rate() -> None:
    clock = FakeClock()
    bucket = TokenBucket(60, 2, clock, clock.sleep)
    waits = [bucket.acquire() for _ in range(4)]
    assert waits == [0.0, 0.0, pytest.approx(1.0), pytest.approx(1.0)]


def test_the_bucket_refills_while_idle_but_never_past_its_capacity() -> None:
    clock = FakeClock()
    bucket = TokenBucket(60, 2, clock, clock.sleep)
    bucket.acquire()
    bucket.acquire()
    clock.now += 100
    assert [bucket.acquire() for _ in range(3)] == [0.0, 0.0, pytest.approx(1.0)]


def test_a_paused_bucket_holds_every_caller_until_the_moment() -> None:
    clock = FakeClock()
    bucket = TokenBucket(600, 8, clock, clock.sleep)
    bucket.pause_for(5)
    assert bucket.acquire() == pytest.approx(5.0)
    assert bucket.acquire() == 0.0


def test_the_bucket_refuses_a_zero_rate() -> None:
    with pytest.raises(ValueError, match="at least 1"):
        TokenBucket(0, 1)


# The pool.


def test_the_pool_holds_at_most_its_width_in_flight_and_keeps_the_order() -> None:
    clock = FakeClock()
    in_flight = 0
    peak = 0
    lock = threading.Lock()

    def answer(request: httpx.Request) -> httpx.Response:
        nonlocal in_flight, peak
        with lock:
            in_flight += 1
            peak = max(peak, in_flight)
        time.sleep(0.02)
        with lock:
            in_flight -= 1
        return _ok()

    gateway = _client(answer, clock, WriterSettings("m/x", WIDTH, 100_000))

    def work(view: GatewayClient, n: int) -> tuple[int, int]:
        for _ in range(n):
            view.complete([{"role": "user", "content": "hi"}], 10)
        return n, view.calls

    results = gateway.in_parallel(work, list(SIZES))
    assert results == [(n, n) for n in SIZES]
    assert peak <= WIDTH
    assert gateway.calls == 0  # each page counted on its own view
    assert len(gateway.ledger.records) == sum(SIZES)


def test_a_pool_one_wide_runs_in_line() -> None:
    clock = FakeClock()
    gateway = _client(lambda r: _ok(), clock, WriterSettings("m/x", 1, 60))
    seen: list[str] = []
    gateway.in_parallel(lambda view, item: seen.append(threading.current_thread().name), ["a", "b"])
    assert len(set(seen)) == 1


# The 429s.


def test_a_429_backs_off_only_the_call_that_met_it_honouring_retry_after() -> None:
    clock = FakeClock()
    gateway = _client(_scripted(httpx.Response(429, headers={"retry-after": "3"}), _ok()), clock)
    answer = gateway.complete([{"role": "user", "content": "hi"}], 10)
    assert answer.content == _WORDS
    assert RETRY_AFTER in clock.slept
    # The line is not paused: the next caller's token is not held for the backoff.
    clock.slept.clear()
    assert gateway.bucket.acquire() == 0.0
    assert gateway.ledger.rate_limited == 1


def test_a_429_without_retry_after_takes_the_configured_backoff() -> None:
    clock = FakeClock()
    gateway = _client(_scripted(httpx.Response(429), _ok()), clock)
    gateway.complete([{"role": "user", "content": "hi"}], 10)
    assert CAPSULE_CONFIG.gateway.retry.rate_limit_backoff_ms[0] / 1000 in clock.slept


def test_rate_limit_headers_that_say_the_limit_is_spent_pause_the_whole_line() -> None:
    clock = FakeClock()
    spent = httpx.Response(
        429, headers={"x-ratelimit-limit": "600", "x-ratelimit-remaining": "0", "x-ratelimit-reset": "7"}
    )
    gateway = _client(_scripted(spent, _ok()), clock)
    other = gateway.scoped()
    gateway.complete([{"role": "user", "content": "hi"}], 10)
    # The retry waited out the reset through the bucket, not a private sleep of the backoff.
    assert CAPSULE_CONFIG.gateway.retry.rate_limit_backoff_ms[0] / 1000 not in clock.slept
    assert pytest.approx(7.0) in clock.slept
    assert gateway.ledger.stated_limits == ("600",)
    assert other.bucket is gateway.bucket


def test_x_should_retry_false_ends_the_call() -> None:
    clock = FakeClock()
    gateway = _client(_scripted(httpx.Response(429, headers={"x-should-retry": "false"})), clock)
    with pytest.raises(GenerationError, match="429"):
        gateway.complete([{"role": "user", "content": "hi"}], 10)
    assert gateway.calls == 1


def test_429s_past_the_backoffs_fail_the_call_retryable() -> None:
    clock = FakeClock()
    gateway = _client(lambda r: httpx.Response(429), clock)
    with pytest.raises(GenerationError) as caught:
        gateway.complete([{"role": "user", "content": "hi"}], 10)
    assert caught.value.retryable
    assert gateway.calls == len(CAPSULE_CONFIG.gateway.retry.rate_limit_backoff_ms) + 1


# The request, the ledger and the price.


def test_the_request_names_the_settings_model_and_pins_its_providers() -> None:
    clock = FakeClock()
    bodies: list[dict[str, Any]] = []

    def answer(request: httpx.Request) -> httpx.Response:

        bodies.append(json.loads(request.content))
        return _ok()

    gateway = _client(answer, clock, WriterSettings("openai/gpt-oss-120b", 2, 60, ("cerebras",)))
    gateway.complete([{"role": "user", "content": "hi"}], 10)
    assert bodies[0]["model"] == "openai/gpt-oss-120b"
    assert bodies[0]["providerOptions"] == {"gateway": {"only": ["cerebras"]}}


def test_the_ledger_records_each_calls_model_provider_and_stated_cost() -> None:
    clock = FakeClock()
    gateway = _client(_scripted(httpx.Response(429), _ok(cost=0.002), _ok(cost=0.003)), clock)
    gateway.complete([{"role": "user", "content": "hi"}], 10)
    gateway.complete([{"role": "user", "content": "hi"}], 10)
    spend = gateway.ledger.by_model()["m/x"]
    assert (spend.calls, spend.rate_limited) == (3, 1)
    assert spend.cost_usd == pytest.approx(0.005)
    assert spend.providers == {"cerebras": 2}
    assert (spend.prompt_tokens, spend.completion_tokens) == (200, 100)


def test_the_price_is_read_from_the_gateways_model_list() -> None:
    listed = {"data": [{"id": "m/x", "pricing": {"input": "0.00000015", "output": "0.0000005"}}]}
    http = httpx.Client(transport=httpx.MockTransport(lambda r: httpx.Response(200, json=listed)))
    price = fetch_price(http, "test-key", "m/x")
    assert price.input_usd_per_million == pytest.approx(0.15)
    assert price.output_usd_per_million == pytest.approx(0.5)
    missing = fetch_price(http, "test-key", "m/y")
    assert missing.input_usd_per_million is None
    assert "does not carry m/y" in missing.basis


def test_a_price_list_that_cannot_be_read_is_stated_not_raised() -> None:
    http = httpx.Client(transport=httpx.MockTransport(lambda r: httpx.Response(503)))
    assert "not read" in fetch_price(http, "test-key", "m/x").basis


# The settings.


def test_the_settings_default_from_the_config() -> None:
    settings = writer_settings({})
    gateway = CAPSULE_CONFIG.gateway
    assert settings == WriterSettings(CAPSULE_MODEL, gateway.concurrency, gateway.calls_per_minute, ())


def test_the_environment_overrides_each_setting() -> None:
    settings = writer_settings(
        {
            "CAPSULE_MODEL": "anthropic/claude-haiku-5.5",
            "CAPSULE_CONCURRENCY": "16",
            "CAPSULE_CALLS_PER_MINUTE": "300",
            "CAPSULE_PROVIDERS": "cerebras, groq",
        }
    )
    assert settings == WriterSettings("anthropic/claude-haiku-5.5", 16, 300, ("cerebras", "groq"))


@pytest.mark.parametrize("raw", ["0", "-2", "eight"])
def test_a_malformed_setting_fails_before_any_call(raw: str) -> None:
    with pytest.raises(ConfigurationError, match="CAPSULE_CONCURRENCY"):
        writer_settings({"CAPSULE_CONCURRENCY": raw})


# The wave gate.


def test_waves_cut_in_order() -> None:
    assert waves([1, 2, 3, 4, 5], 2) == [[1, 2], [3, 4], [5]]
    with pytest.raises(ValueError, match="one page wide"):
        waves([1], 0)


_SHARED = "the volume is real and the role is growing every single week"


def test_wave_collisions_count_what_a_waves_own_pages_share() -> None:
    rules = SpanRules(frozenset())
    pages = {
        "a": (f"{_SHARED}.",),
        "b": (f"Draft him because {_SHARED}.",),
        "c": ("nothing alike here at all today friend",),
    }
    reads = {"a": (f"{_SHARED}.",), "b": (f"{_SHARED}.",), "c": ("Something else entirely here.",)}
    found = wave_collisions(pages, reads, rules, 4)
    assert found.sentences == 1
    assert found.spans > 0
    assert found.carriers == ("a", "b")


def _subject(pid: str) -> Subject:
    facts = SimpleNamespace(identity=SimpleNamespace(name=pid.upper(), id=pid), facts_hash="h")
    return Subject(cast("Any", facts), pid)


def _result(text: str) -> Any:
    read = SimpleNamespace(text=text, fallback=None)
    narrative = SimpleNamespace(slots={}, rejected=())
    return SimpleNamespace(compact=read, full=read, narrative=narrative, source="llm", usage=None, calls=1)


def test_a_wave_sees_every_page_landed_before_it_and_its_own_collisions_are_counted(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Width 2: a and b share a span inside the first wave (neither could see the other); c and d,
    the next wave, are told it; the wave's collision is counted for the repair."""
    subjects = [_subject(pid) for pid in "abcd"]
    texts = {"a": _SHARED, "b": f"Yes {_SHARED}", "c": "a page of its own words entirely", "d": "and another one alone"}
    told: dict[str, tuple[str, ...]] = {}

    def write_one(engine: Any, subject: Subject, stored: Any, view: GatewayClient, worn: WornPhrases, **_: Any) -> Any:
        told[subject.universe_id] = worn.sentences
        return _result(texts[subject.universe_id]), False, False

    monkeypatch.setattr(sweep, "write_one", write_one)
    monkeypatch.setattr(sweep, "stored_capsules_for", lambda conn, ids: {})
    monkeypatch.setattr(sweep, "queue_regeneration", lambda conn, ids: 0)
    engine = cast("Engine", SimpleNamespace(connect=lambda: nullcontext(None), begin=lambda: nullcontext(None)))
    gateway = _client(lambda r: _ok(), FakeClock(), WriterSettings("m/x", 2, 60))
    plan = SweepPlan(10, span_rules=SpanRules(frozenset()))
    report = sweep_capsules(engine, gateway, NOW, plan, lambda conn, at: subjects)
    first_span = " ".join(_SHARED.split()[:6])
    assert not any(first_span in s for s in told["a"] + told["b"])
    assert first_span in told["c"]
    assert first_span in told["d"]
    assert report.processed == ["a", "b", "c", "d"]
    assert report.waves == len(subjects) // 2
    assert report.wave_spans > 0
    assert report.wave_carriers == ["a", "b"]
