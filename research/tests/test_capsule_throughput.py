"""The writer's throughput (Lane 24), with the gateway stubbed (`httpx.MockTransport`) and a fake
clock: the token bucket, the bounded pool and its scoped views, the 429 handling per call and per
line, the ledger and the price list, the settings from the environment, the landing gate and the sentence claim."""

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
from sqlalchemy.exc import OperationalError

from research.capsules import sweep
from research.capsules.config import CAPSULE_CONFIG, CAPSULE_MODEL, WriterSettings, writer_settings
from research.capsules.gateway import GatewayClient, GenerationError
from research.capsules.gateway_ledger import fetch_price
from research.capsules.landing import BoardSentences, TonightWindow
from research.capsules.narrative import held_sentences
from research.capsules.pace import TokenBucket
from research.capsules.prompt import WornPhrases
from research.capsules.spans import SpanRules
from research.capsules.sweep import Subject, SweepPlan, sweep_capsules
from research.db.engine import POOL_HEADROOM, connection_lost, make_engine, once_more_on_disconnect, pooled_like
from research.errors import ConfigurationError

NOW = datetime(2026, 10, 15, 5, tzinfo=UTC)
_WORDS = " ".join(["word"] * 30)
WIDTH = 3
SIZES = (1, 2, 3, 1, 2, 3, 1)
RETRY_AFTER = 3.0
# Twelve tokens at ten a second with a burst of four: at least 0.8 s, read with a little slack.
CONTENDED_FLOOR_S = 0.75


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


def test_the_rolling_pool_holds_at_most_its_width_in_flight_and_counts_each_page_on_its_own_view() -> None:
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
    landed: list[tuple[int, int]] = []

    def start(n: int) -> Callable[[GatewayClient], tuple[int, int]]:
        def work(view: GatewayClient) -> tuple[int, int]:
            for _ in range(n):
                view.complete([{"role": "user", "content": "hi"}], 10)
            return n, view.calls

        return work

    stopped = gateway.rolling(list(SIZES), start, lambda n, result: landed.append(result))
    assert not stopped
    assert sorted(landed) == sorted((n, n) for n in SIZES)
    assert peak <= WIDTH
    assert gateway.calls == 0  # each page counted on its own view
    assert len(gateway.ledger.records) == sum(SIZES)


def test_a_slot_is_refilled_the_moment_its_page_lands_and_the_next_start_sees_it() -> None:
    """Width 2: a slow page and a quick one start; the quick one lands, and the third page starts
    (seeing it landed) while the slow one is still in flight."""
    gateway = _client(lambda r: _ok(), FakeClock(), WriterSettings("m/x", 2, 60))
    slow_may_finish = threading.Event()
    landed: list[str] = []
    seen_at_start: dict[str, tuple[str, ...]] = {}

    def start(item: str) -> Callable[[GatewayClient], str]:
        seen_at_start[item] = tuple(landed)

        def work(view: GatewayClient) -> str:
            if item == "slow":
                assert slow_may_finish.wait(5)
            if item == "third":
                slow_may_finish.set()
            return item

        return work

    gateway.rolling(["slow", "quick", "third"], start, lambda item, result: landed.append(result))
    assert seen_at_start["third"] == ("quick",)
    assert landed.index("quick") < landed.index("slow")


def test_the_rolling_pool_stops_starting_when_asked_and_lands_what_is_in_flight() -> None:
    gateway = _client(lambda r: _ok(), FakeClock(), WriterSettings("m/x", 2, 60))
    landed: list[int] = []
    stopped = gateway.rolling(
        [1, 2, 3, 4], lambda n: lambda view: n, lambda n, result: landed.append(result), lambda: len(landed) >= 1
    )
    assert stopped
    assert 1 <= len(landed) < len([1, 2, 3, 4])


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


# The landing gate.


_SHARED = "the volume is real and the role is growing every single week"


def test_a_landing_page_counts_what_it_shares_with_the_pages_landed_before_it() -> None:
    window = TonightWindow(SpanRules(frozenset()), 60, 4)
    assert not window.land((f"{_SHARED}.",), (f"{_SHARED}.",)).carrier
    second = window.land((f"Draft him because {_SHARED}.",), (f"{_SHARED}.",))
    assert second.sentences == 1
    assert second.spans > 0
    assert not window.land(("nothing alike here at all today friend",), ("Something else entirely.",)).carrier
    first_span = " ".join(_SHARED.split()[:6])
    assert first_span in window.repeated(12)


def test_a_sentence_the_facts_print_is_never_counted_as_shared_as_pages_land() -> None:
    """Review 73 item 3: the landing count reads the same exemption as the gate and the claim."""
    printed = "He missed two games to injury in 2025."
    rules = SpanRules(frozenset(), exempt_sentences=frozenset(held_sentences([printed], 4)))
    window = TonightWindow(rules, 60, 4)
    window.land(("first",), (printed,))
    assert window.land(("second",), (printed,)).sentences == 0


def test_the_window_forgets_pages_past_its_width() -> None:
    window = TonightWindow(SpanRules(frozenset()), 1, 4)
    window.land((f"{_SHARED}.",), (f"{_SHARED}.",))
    window.land(("nothing alike here at all today friend",), ("Something else entirely.",))
    assert not window.land((f"{_SHARED}.",), (f"{_SHARED}.",)).carrier


def _subject(pid: str) -> Subject:
    facts = SimpleNamespace(identity=SimpleNamespace(name=pid.upper(), id=pid), facts_hash="h")
    return Subject(cast("Any", facts), pid)


def _result(text: str) -> Any:
    read = SimpleNamespace(text=text, fallback=None)
    narrative = SimpleNamespace(slots={}, rejected=())
    return SimpleNamespace(
        compact=read,
        full=read,
        narrative=narrative,
        source="llm",
        usage=None,
        calls=1,
        asks=1,
        retry_asks=0,
        rescued=False,
        model="m/x",
    )


def _stub_store(monkeypatch: pytest.MonkeyPatch) -> Engine:
    monkeypatch.setattr(sweep, "stored_capsules_for", lambda conn, ids: {})
    monkeypatch.setattr(sweep, "queue_regeneration", lambda conn, ids: 0)
    return cast("Engine", SimpleNamespace(connect=lambda: nullcontext(None), begin=lambda: nullcontext(None)))


def test_each_page_is_told_what_the_pages_landed_before_it_started_repeat_and_carriers_are_counted(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Width 1 makes the landing order the board order: a and b share a span (b, landing second, is
    the carrier); c starts after both landed and is told it."""
    subjects = [_subject(pid) for pid in "abc"]
    texts = {"a": _SHARED, "b": f"Yes {_SHARED}", "c": "a page of its own words entirely"}
    told: dict[str, tuple[str, ...]] = {}

    def write_one(engine: Any, subject: Subject, stored: Any, view: GatewayClient, worn: WornPhrases, **_: Any) -> Any:
        told[subject.universe_id] = worn.sentences
        return _result(texts[subject.universe_id]), False

    monkeypatch.setattr(sweep, "write_one", write_one)
    engine = _stub_store(monkeypatch)
    gateway = _client(lambda r: _ok(), FakeClock(), WriterSettings("m/x", 1, 60))
    report = sweep_capsules(
        engine, gateway, NOW, SweepPlan(10, span_rules=SpanRules(frozenset())), lambda c, a: subjects
    )
    first_span = " ".join(_SHARED.split()[:6])
    assert not any(first_span in s for s in told["a"] + told["b"])
    assert first_span in told["c"]
    assert report.processed == ["a", "b", "c"]
    assert report.landed_spans > 0
    assert report.landed_carriers == ["b"]


# A dropped connection.


class _FlakyEngine:
    """`begin` loses its connection on the first `failures` calls, then commits."""

    def __init__(self, failures: int) -> None:
        self.failures = failures
        self.begun = 0

    def begin(self) -> Any:
        self.begun += 1
        if self.begun <= self.failures:
            raise OperationalError("upsert", {}, Exception("server closed the connection unexpectedly"))
        return nullcontext(None)


def test_a_commit_that_loses_its_connection_is_tried_once_more_on_a_fresh_one(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(sweep, "generate_capsule", lambda facts, gateway, worn, **_: _result(_SHARED))
    monkeypatch.setattr(sweep, "upsert_capsule", lambda conn, row, at: None)
    monkeypatch.setattr(sweep, "CapsuleWrite", lambda *args: args)
    engine = _FlakyEngine(1)
    gateway = _client(lambda r: _ok(), FakeClock())
    result, _ = sweep.write_one(cast("Engine", engine), _subject("a"), None, gateway, WornPhrases((), ()))
    assert result.source == "llm"
    assert engine.begun == 1 + 1


def test_a_second_loss_or_another_error_is_raised() -> None:
    engine = _FlakyEngine(2)
    with pytest.raises(OperationalError):
        once_more_on_disconnect(engine.begin)
    calls: list[int] = []

    def refused() -> None:
        calls.append(1)
        raise ValueError("not a connection")

    with pytest.raises(ValueError, match="not a connection"):
        once_more_on_disconnect(refused)
    assert calls == [1]


def test_the_writers_share_one_pool_sized_to_the_concurrency() -> None:
    writers = pooled_like(make_engine("postgresql+psycopg://user:secret@db.invalid/commish"), 16)
    held = cast("Any", writers.pool)
    assert (held.size(), held._max_overflow, held._pre_ping) == (16, POOL_HEADROOM, True)
    assert writers.url.password == "secret"
    writers.dispose()


# No rewrite lands a sentence another page carries.

_CLOSER = "Drop him and spend the roster spot on a live body."


def test_an_exclusive_claim_is_refused_when_another_page_carries_the_sentence() -> None:
    board = BoardSentences({"x": (_CLOSER, "Something of its own.")}, 4)
    assert not board.claim("a", (f"He is done. {_CLOSER}",), exclusive=True)
    # The page's own sentence never blocks it, and a fresh sentence lands.
    assert board.claim("x", (_CLOSER,), exclusive=True)
    assert board.claim("a", ("A new and unshared closing line here.",), exclusive=True)
    # The sweep's own write records without asking; a facts block releases the page's sentences.
    assert board.claim("b", (_CLOSER,), exclusive=False)
    assert board.claim("b", (), exclusive=False)
    assert board.claim("x", (), exclusive=False)
    assert board.claim("a", (_CLOSER,), exclusive=True)


def _stored(pid: str, full: str) -> Any:
    return SimpleNamespace(
        player_id=pid, source="llm", body_compact="Short note.", body_full=full, facts_hash="h", narrative=None
    )


@pytest.mark.parametrize(
    ("plan", "lands"),
    [
        (SweepPlan(10, span_rules=SpanRules(frozenset())), True),
        (SweepPlan(10, span_rules=SpanRules(frozenset()), only=("a",)), False),
        (SweepPlan(10, span_rules=SpanRules(frozenset()), only=("a",), grace=True), False),
    ],
    ids=["the sweep", "the repair", "the graced rewrite"],
)
def test_a_rewrite_that_would_land_another_pages_sentence_is_refused_and_keeps_the_written_read(
    monkeypatch: pytest.MonkeyPatch, plan: SweepPlan, lands: bool
) -> None:
    subjects = [_subject(pid) for pid in ("a", "x")]
    stored = {"a": _stored("a", "His own old read, nothing shared."), "x": _stored("x", _CLOSER)}
    committed: list[str] = []
    monkeypatch.setattr(sweep, "stored_capsules_for", lambda conn, ids: {k: v for k, v in stored.items() if k in ids})
    monkeypatch.setattr(sweep, "queue_regeneration", lambda conn, ids: 0)
    monkeypatch.setattr(sweep, "worn_phrases", lambda subjects, stored: WornPhrases((), ()))
    monkeypatch.setattr(sweep, "generate_capsule", lambda facts, gateway, worn, **_: _result(f"Fresh words. {_CLOSER}"))
    monkeypatch.setattr(sweep, "upsert_capsule", lambda conn, row, at: committed.append(row.player_id))
    monkeypatch.setattr(sweep, "_needs_generation", lambda subject, row: subject.universe_id == "a")
    engine = cast("Engine", SimpleNamespace(connect=lambda: nullcontext(None), begin=lambda: nullcontext(None)))
    gateway = _client(lambda r: _ok(), FakeClock(), WriterSettings("m/x", 1, 60))
    report = sweep_capsules(engine, gateway, NOW, plan, lambda c, a: subjects)
    assert report.processed == ["a"]
    assert committed == (["a"] if lands else [])
    assert (report.llm, report.kept, report.refused) == ((1, 0, 0) if lands else (0, 1, 1))


def test_a_sentence_the_facts_print_never_refuses_an_exclusive_claim() -> None:
    """Lane 73: the claim reads the facts' own sentences from the demotion's source
    (`SpanRules.exempt_sentences`), so a printed fact on another page never blocks a rewrite."""
    board = BoardSentences({"x": (_CLOSER,)}, 4, frozenset(held_sentences([_CLOSER], 4)))
    assert board.claim("a", (f"He is done. {_CLOSER}",), exclusive=True)
    assert not BoardSentences({"x": (_CLOSER,)}, 4).claim("a", (_CLOSER,), exclusive=True)


def test_a_rewrite_landing_a_sentence_the_facts_print_is_not_refused(monkeypatch: pytest.MonkeyPatch) -> None:
    """The sweep builds its claim from the night's span rules: the same exemption the gate and the
    demotion read (b58ff1de), never a second list."""
    subjects = [_subject(pid) for pid in ("a", "x")]
    stored = {"a": _stored("a", "His own old read, nothing shared."), "x": _stored("x", _CLOSER)}
    committed: list[str] = []
    monkeypatch.setattr(sweep, "stored_capsules_for", lambda conn, ids: {k: v for k, v in stored.items() if k in ids})
    monkeypatch.setattr(sweep, "queue_regeneration", lambda conn, ids: 0)
    monkeypatch.setattr(sweep, "worn_phrases", lambda subjects, stored: WornPhrases((), ()))
    monkeypatch.setattr(sweep, "generate_capsule", lambda facts, gateway, worn, **_: _result(f"Fresh words. {_CLOSER}"))
    monkeypatch.setattr(sweep, "upsert_capsule", lambda conn, row, at: committed.append(row.player_id))
    engine = cast("Engine", SimpleNamespace(connect=lambda: nullcontext(None), begin=lambda: nullcontext(None)))
    gateway = _client(lambda r: _ok(), FakeClock(), WriterSettings("m/x", 1, 60))
    rules = SpanRules(frozenset(), exempt_sentences=frozenset(held_sentences([_CLOSER], 4)))
    report = sweep_capsules(engine, gateway, NOW, SweepPlan(10, span_rules=rules, only=("a",)), lambda c, a: subjects)
    assert committed == ["a"]
    assert (report.llm, report.refused) == (1, 0)


def test_two_pages_in_flight_with_the_same_new_sentence_land_it_once(monkeypatch: pytest.MonkeyPatch) -> None:
    """Width 2, an exclusive pass: both rewrites return the same fresh sentence; exactly one lands."""
    subjects = [_subject(pid) for pid in ("a", "b")]
    stored = {pid: _stored(pid, f"The old read of {pid}, its own words.") for pid in ("a", "b")}
    both_started = threading.Barrier(2)
    committed: list[str] = []

    def generate(facts: Any, gateway: Any, worn: Any, **_: Any) -> Any:
        both_started.wait(5)
        return _result(f"Fresh words. {_CLOSER}")

    monkeypatch.setattr(sweep, "stored_capsules_for", lambda conn, ids: {k: v for k, v in stored.items() if k in ids})
    monkeypatch.setattr(sweep, "queue_regeneration", lambda conn, ids: 0)
    monkeypatch.setattr(sweep, "worn_phrases", lambda subjects, stored: WornPhrases((), ()))
    monkeypatch.setattr(sweep, "generate_capsule", generate)
    monkeypatch.setattr(sweep, "upsert_capsule", lambda conn, row, at: committed.append(row.player_id))
    engine = cast("Engine", SimpleNamespace(connect=lambda: nullcontext(None), begin=lambda: nullcontext(None)))
    gateway = _client(lambda r: _ok(), FakeClock(), WriterSettings("m/x", 2, 60))
    plan = SweepPlan(10, span_rules=SpanRules(frozenset()), only=("a", "b"))
    report = sweep_capsules(engine, gateway, NOW, plan, lambda c, a: subjects)
    assert len(committed) == 1
    assert (report.llm, report.refused) == (1, 1)


# The review's M1, M2 and L5: a long retry-after, a raising worker, the bucket under contention.


def test_a_retry_after_past_the_backoff_ceiling_is_waited_out() -> None:
    clock = FakeClock()
    gateway = _client(_scripted(httpx.Response(429, headers={"retry-after": "120"}), _ok()), clock)
    gateway.complete([{"role": "user", "content": "hi"}], 10)
    assert clock.slept == [pytest.approx(120.0)]


def test_a_retry_after_past_the_cap_fails_the_call_with_the_reason() -> None:
    clock = FakeClock()
    gateway = _client(_scripted(httpx.Response(429, headers={"retry-after": "900"})), clock)
    with pytest.raises(GenerationError, match="900 s, past the 300 s cap"):
        gateway.complete([{"role": "user", "content": "hi"}], 10)
    assert gateway.calls == 1
    assert clock.slept == []


def test_a_raising_worker_lets_its_siblings_land_then_raises() -> None:
    gateway = _client(lambda r: _ok(), FakeClock(), WriterSettings("m/x", 3, 60))
    raised = threading.Event()
    started: list[int] = []
    landed: list[int] = []

    def start(item: int) -> Callable[[GatewayClient], int]:
        started.append(item)

        def work(view: GatewayClient) -> int:
            if item == 0:
                raised.set()
                raise RuntimeError("the proxy dropped the commit twice")
            assert raised.wait(5)
            time.sleep(0.05)
            return item

        return work

    with pytest.raises(RuntimeError, match="dropped the commit"):
        gateway.rolling([0, 1, 2, 3, 4, 5], start, lambda item, result: landed.append(result))
    assert started == [0, 1, 2]
    assert sorted(landed) == [1, 2]


def test_the_bucket_holds_its_rate_under_contention() -> None:
    bucket = TokenBucket(600, 4)  # 10 a second, a burst of 4
    began = time.monotonic()
    threads = [threading.Thread(target=lambda: [bucket.acquire() for _ in range(3)]) for _ in range(4)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    # Twelve tokens: four from the burst, eight more at ten a second.
    assert time.monotonic() - began >= CONTENDED_FLOOR_S


# The review's L1 and L2.


class _DriverError(Exception):
    def __init__(self, sqlstate: str | None) -> None:
        super().__init__("driver error")
        self.sqlstate = sqlstate


@pytest.mark.parametrize(
    ("sqlstate", "lost"),
    [(None, True), ("08006", True), ("57014", False), ("40P01", False), ("55P03", False)],
    ids=["closed unexpectedly", "connection failure", "statement timeout", "deadlock", "lock not available"],
)
def test_only_a_lost_connection_is_retried(sqlstate: str | None, lost: bool) -> None:
    assert connection_lost(OperationalError("select 1", {}, _DriverError(sqlstate))) is lost


def test_the_concurrency_has_a_ceiling() -> None:
    with pytest.raises(ConfigurationError, match="at most 64"):
        writer_settings({"CAPSULE_CONCURRENCY": "500"})
