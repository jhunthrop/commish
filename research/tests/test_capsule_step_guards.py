"""The capsule step's guards (the Lane 24 review's M2, M3 and L2), with the gateway and the store
stubbed: a model the gateway's list does not carry fails the step before any call or write, a
malformed setting fails it before the regenerate stamp, and a pass that raises part way still hands
the night's spend to the run's report."""

import re
from contextlib import nullcontext
from datetime import UTC, datetime
from types import SimpleNamespace
from typing import Any, cast

import httpx
import pytest
from sqlalchemy import Engine
from sqlalchemy.exc import OperationalError

from research.capsules import sweep
from research.capsules.config import WriterSettings
from research.capsules.gateway import GatewayClient
from research.capsules.gateway_ledger import ModelPrice
from research.capsules.spans import SpanRules
from research.capsules.sweep import PageCommitError, Subject, SweepPlan
from research.errors import ConfigurationError
from research.nightly import capsule_step, run_parts
from research.nightly.capsule_step import (
    CapsuleSpend,
    CapsuleStepError,
    CapsuleStepPlan,
    _Passes,
    _write,
    checked_price,
)
from research.nightly.steps import StepRecord

NOW = datetime(2026, 10, 15, 5, tzinfo=UTC)
SETTINGS = WriterSettings("zai/glm-5.3-flash", 2, 60)
_LISTED = {"data": [{"id": "zai/glm-5.3-flash", "pricing": {"input": "0.00000015", "output": "0.0000005"}}]}


def _http(answer: httpx.Response) -> httpx.Client:
    return httpx.Client(transport=httpx.MockTransport(lambda request: answer))


def test_a_model_the_list_does_not_carry_fails_before_any_call() -> None:
    typo = WriterSettings("zai/glm-5.3-flsh", 2, 60)
    with pytest.raises(
        ConfigurationError, match=re.escape("zai/glm-5.3-flsh, which the gateway's model list does not carry")
    ):
        checked_price(_http(httpx.Response(200, json=_LISTED)), "test-key", typo)


def test_a_model_the_list_carries_passes() -> None:
    assert checked_price(_http(httpx.Response(200, json=_LISTED)), "test-key", SETTINGS).listed is True


def test_a_list_that_could_not_be_read_does_not_block() -> None:
    price = checked_price(_http(httpx.Response(503)), "test-key", SETTINGS)
    assert price.listed is None
    assert "not read" in price.basis


def _no_write(stamped: list[str], monkeypatch: pytest.MonkeyPatch) -> None:
    def regenerate_all(engine: Engine, now: datetime) -> str:
        stamped.append("stamped")
        return "stamped"

    monkeypatch.setattr(capsule_step, "_regenerate_all", regenerate_all)
    monkeypatch.setattr(capsule_step, "pooled_like", lambda engine, writers: pytest.fail("no writers' pool"))


def _run_write(plan: CapsuleStepPlan) -> CapsuleSpend:
    spend, _ = _write(
        cast("Engine", None), "test-key", NOW, plan, lambda _: None, cast("Any", None), SpanRules(frozenset())
    )
    return spend


def test_a_malformed_setting_fails_before_the_regenerate_stamp(monkeypatch: pytest.MonkeyPatch) -> None:
    stamped: list[str] = []
    _no_write(stamped, monkeypatch)
    monkeypatch.setenv("CAPSULE_CONCURRENCY", "eight")
    with pytest.raises(ConfigurationError, match="CAPSULE_CONCURRENCY"):
        _run_write(CapsuleStepPlan(regenerate_all=True))
    assert stamped == []


def test_an_unlisted_model_fails_before_the_regenerate_stamp(monkeypatch: pytest.MonkeyPatch) -> None:
    stamped: list[str] = []
    _no_write(stamped, monkeypatch)
    monkeypatch.setattr(capsule_step, "fetch_price", lambda http, key, model: ModelPrice(model, None, None, "x", False))
    with pytest.raises(ConfigurationError, match="does not carry"):
        _run_write(CapsuleStepPlan(regenerate_all=True))
    assert stamped == []


class _RaisingPasses:
    """Spends a little, then raises as a dropped commit would."""

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        self.spend = CapsuleSpend(calls=7, cost_usd=0.012, processed=3, written=3)

    def run(self) -> None:
        raise RuntimeError("the proxy dropped the commit twice")


def test_a_pass_that_raises_still_hands_the_nights_spend_to_the_report(monkeypatch: pytest.MonkeyPatch) -> None:
    disposed: list[bool] = []
    listed = ModelPrice("zai/glm-5.3-flash", 0.15, 0.5, "x", True)
    monkeypatch.setattr(capsule_step, "fetch_price", lambda http, key, model: listed)
    monkeypatch.setattr(
        capsule_step,
        "pooled_like",
        lambda engine, writers: type("W", (), {"dispose": lambda s: disposed.append(True)})(),
    )
    monkeypatch.setattr(capsule_step, "_Passes", _RaisingPasses)
    monkeypatch.delenv("CAPSULE_CONCURRENCY", raising=False)
    with pytest.raises(CapsuleStepError, match="RuntimeError: the proxy dropped the commit twice") as caught:
        _run_write(CapsuleStepPlan())
    spend = caught.value.spend
    assert (spend.calls, spend.cost_usd, spend.price) == (7, 0.012, listed)
    assert spend.writer is not None
    assert disposed == [True]


def test_the_failed_step_carries_its_spend(monkeypatch: pytest.MonkeyPatch) -> None:
    spend = CapsuleSpend(calls=7, cost_usd=0.012)

    def step(*args: Any) -> Any:
        raise CapsuleStepError(RuntimeError("the proxy dropped the commit twice"), spend)

    monkeypatch.setattr(run_parts, "run_capsule_step", step)
    outcome = run_parts._capsules(
        cast("Engine", None), lambda: NOW, lambda _: None, False, CapsuleStepPlan(), cast("Any", None)
    )
    assert outcome.spend is spend
    assert outcome.record.status == "failed"
    assert outcome.record.summary.startswith("RuntimeError: the proxy dropped the commit twice, 0 pages attempted")
    assert outcome.record == StepRecord("capsules", "failed", outcome.record.summary)


def _paid_read(view: GatewayClient) -> Any:
    """One stubbed gateway call, its usage on the read as `generate_capsule` would put it."""
    answer = view.complete([{"role": "user", "content": "write"}], 10)
    text = "A fresh read of its own words, nothing shared with any page."
    read = SimpleNamespace(text=text, fallback=None)
    return SimpleNamespace(
        compact=read,
        full=read,
        narrative=SimpleNamespace(slots={}, rejected=()),
        source="llm",
        usage=answer.usage,
        calls=view.calls,
        asks=1,
        retry_asks=0,
        rescued=False,
        model="m/x",
    )


def test_a_raising_worker_leaves_the_headline_spend_equal_to_the_ledger(monkeypatch: pytest.MonkeyPatch) -> None:
    """The real `_Passes.sweep` over the real sweep and rolling pool, the gateway stubbed: page b's
    commit is lost twice, its siblings land, and the night's headline spend still equals the ledger."""
    pages = ["a", "b", "c", "d", "e"]
    subjects = [
        Subject(cast("Any", SimpleNamespace(identity=SimpleNamespace(name=p.upper(), id=p), facts_hash="h")), p)
        for p in pages
    ]

    def upsert(conn: Any, row: Any, at: Any) -> None:
        if row.player_id == "b":
            raise OperationalError("upsert", {}, Exception("server closed the connection unexpectedly"))

    monkeypatch.setattr(sweep, "stored_capsules_for", lambda conn, ids: {})
    monkeypatch.setattr(sweep, "queue_regeneration", lambda conn, ids: 0)
    monkeypatch.setattr(sweep, "generate_capsule", lambda facts, view, worn, **_: _paid_read(view))
    monkeypatch.setattr(sweep, "upsert_capsule", upsert)
    usage = {"prompt_tokens": 100, "completion_tokens": 50, "total_tokens": 150, "cost": 0.002}
    body = {"choices": [{"message": {"content": " ".join(["word"] * 30)}}], "usage": usage}
    http = httpx.Client(transport=httpx.MockTransport(lambda request: httpx.Response(200, json=body)))
    gateway = GatewayClient.for_run("test-key", http, WriterSettings("m/x", 2, 100_000))
    engine = cast("Engine", SimpleNamespace(connect=lambda: nullcontext(None), begin=lambda: nullcontext(None)))
    passes = _Passes(
        engine,
        gateway,
        NOW,
        CapsuleStepPlan(),
        lambda _: None,
        cast("Any", lambda conn, at: subjects),
        rules=SpanRules(frozenset()),
    )
    with pytest.raises(PageCommitError, match="server closed the connection"):
        passes.sweep("capsules", SweepPlan(10))
    ledger = gateway.ledger.by_model()["m/x"]
    assert passes.spend.calls == ledger.calls == len(gateway.ledger.records)
    assert passes.spend.cost_usd == pytest.approx(ledger.cost_usd)
    assert (passes.spend.prompt_tokens, passes.spend.completion_tokens) == (
        ledger.prompt_tokens,
        ledger.completion_tokens,
    )
    assert "b" in passes.asks_by_player
    assert passes.spend.processed == ledger.calls
