"""THE GATEWAY CALL: one chat completion, paced, retried and accounted.

Ported from `research-ts/src/capsules/write.ts` (`postChatCompletion`). Every call draws a token from
the run's bucket (`pace.TokenBucket`, `calls_per_minute`). A 429 gets its own longer backoff for the
one call that met it (a `retry-after` the gateway sends is honoured however long, up to
`retry_after_cap_ms`, past which the call fails with the reason, and an `x-should-retry: false` ends
the call); only when the gateway's rate-limit headers say the limit is
spent for everyone does the whole line pause until their reset. A 5xx, a network error, an empty
completion or one the gateway says was cut at its token limit (`finish_reason: length`, never read
as a whole answer: Lane 29) gets one retry, and usage the gateway billed before a failure is kept on
the error, so a player's cost is counted whether or not his read survived.

Pages are written `concurrency` at a time (`GatewayClient.rolling`): each page holds its own
scoped view of the run's client (its own call count over the shared line, bucket and ledger). The
ledger records every call's model, its serving provider and the cost the gateway's usage response
states; the gateway's price list is read once a run (`fetch_price`) for the run's report. The pacing
state lives on the client the caller holds, never in a module global. The key is read from the
environment by the caller and never printed.
"""

import json
import math
import threading
import time
from collections import Counter
from collections.abc import Callable, Mapping, Sequence
from concurrent.futures import FIRST_COMPLETED, Future, ThreadPoolExecutor, wait
from dataclasses import dataclass, field, replace
from datetime import UTC, datetime
from email.utils import parsedate_to_datetime
from typing import Any, Final, cast

import httpx

from research.capsules.config import CAPSULE_CONFIG, CAPSULE_MODEL, Gateway, WriterSettings
from research.capsules.pace import TokenBucket

DEGENERATE_COMPLETION_WORDS: Final = 20
_THINKING_DISABLED: Final = {"thinking": {"type": "disabled"}, "reasoning_effort": "none"}
_CONTROL: Final = dict.fromkeys((*range(0, 9), 11, 12, *range(14, 32)))
_RATE_LIMITED: Final = 429
_SERVER_ERROR: Final = 500
_CUT_OFF: Final = "length"
# The rate-limit headers a gateway may answer with, in either spelling (the IETF draft's or the
# common `x-` one). The Vercel AI Gateway sent none on Lane 24's probes; they are read when sent.
_LIMIT_HEADERS: Final = ("x-ratelimit-limit", "ratelimit-limit")
_REMAINING_HEADERS: Final = ("x-ratelimit-remaining", "ratelimit-remaining")
_RESET_HEADERS: Final = ("x-ratelimit-reset", "ratelimit-reset")
# A reset this large is an epoch second, not a count of seconds to wait.
_EPOCH_RESET_FLOOR: Final = 1_000_000_000
_PER_MILLION: Final = 1_000_000
# The end of a rolling pool's items.
_DONE: Final = object()


@dataclass(frozen=True, slots=True)
class Usage:
    prompt_tokens: int | None = None
    completion_tokens: int | None = None
    total_tokens: int | None = None
    cost_usd: float | None = None


def _sum(a: float | None, b: float | None) -> float | None:
    return b if a is None else a if b is None else a + b


def add_usage(total: Usage | None, more: Usage | None) -> Usage | None:
    """`addGatewayUsage`, None-tolerant per field."""
    if more is None:
        return total
    if total is None:
        return more
    prompt = _sum(total.prompt_tokens, more.prompt_tokens)
    completion = _sum(total.completion_tokens, more.completion_tokens)
    whole = _sum(total.total_tokens, more.total_tokens)
    return Usage(
        None if prompt is None else int(prompt),
        None if completion is None else int(completion),
        None if whole is None else int(whole),
        _sum(total.cost_usd, more.cost_usd),
    )


class GenerationError(Exception):
    """A call that did not produce a usable completion; `billed` is what the gateway charged anyway."""

    def __init__(self, message: str, retryable: bool, billed: Usage | None = None) -> None:
        super().__init__(message)
        self.retryable = retryable
        self.billed = billed


@dataclass(frozen=True, slots=True)
class Completion:
    content: str
    usage: Usage | None
    # The provider the gateway routed the call to (`provider_metadata.gateway.routing.finalProvider`).
    provider: str | None = None
    # Why the completion ended (`choices[0].finish_reason`): "length" is a completion cut at its token
    # limit, never a whole answer (Lane 29: the cause of Puka Nacua's read ending "by about").
    finish_reason: str | None = None

    @property
    def cut_off(self) -> bool:
        return self.finish_reason == _CUT_OFF


def _int_or_none(value: object) -> int | None:
    return int(value) if isinstance(value, int | float) and not isinstance(value, bool) else None


def _dict(value: object) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _parse(raw: str) -> Completion:
    try:
        body: Any = json.loads(raw)
    except ValueError:
        try:
            body = json.loads(raw.translate(_CONTROL))
        except ValueError as error:
            raise GenerationError(f"Gateway response was not parseable JSON: {error}", True) from None
    if not isinstance(body, dict):
        raise GenerationError("Gateway response was not a JSON object.", True)
    choices = body.get("choices")
    first = _dict(choices[0]) if isinstance(choices, list) and choices else {}
    message = _dict(first.get("message"))
    content = message.get("content") if isinstance(message.get("content"), str) else ""
    routing = _dict(_dict(_dict(message.get("provider_metadata")).get("gateway")).get("routing"))
    provider = routing.get("finalProvider")
    raw_usage = _dict(body.get("usage"))
    cost = raw_usage.get("cost")
    usage = Usage(
        _int_or_none(raw_usage.get("prompt_tokens")),
        _int_or_none(raw_usage.get("completion_tokens")),
        _int_or_none(raw_usage.get("total_tokens")),
        float(cost) if isinstance(cost, int | float) and not isinstance(cost, bool) else None,
    )
    finish = first.get("finish_reason")
    return Completion(
        str(content),
        usage,
        provider if isinstance(provider, str) else None,
        finish if isinstance(finish, str) else None,
    )


@dataclass(frozen=True, slots=True)
class CallRecord:
    """One HTTP call as the ledger keeps it: the model asked for, the answer's status (None for a
    network error), the provider that served it and the usage the gateway stated."""

    model: str
    status: int | None
    provider: str | None = None
    usage: Usage | None = None


@dataclass(frozen=True, slots=True)
class ModelSpend:
    """A run's calls to one model, summed from the ledger; `cost_usd` is the gateway's own figure."""

    calls: int
    rate_limited: int
    prompt_tokens: int
    completion_tokens: int
    cost_usd: float
    providers: dict[str, int]


def _model_spend(entries: Sequence[CallRecord]) -> ModelSpend:
    usage = [e.usage for e in entries if e.usage is not None]
    return ModelSpend(
        len(entries),
        sum(1 for e in entries if e.status == _RATE_LIMITED),
        sum(u.prompt_tokens or 0 for u in usage),
        sum(u.completion_tokens or 0 for u in usage),
        sum(u.cost_usd or 0.0 for u in usage),
        dict(Counter(e.provider for e in entries if e.provider is not None)),
    )


class UsageLedger:
    """Every call of a run, from every thread: the model, the provider, the status and the cost."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._records: list[CallRecord] = []
        self._stated_limits: set[str] = set()

    def record(self, entry: CallRecord) -> None:
        with self._lock:
            self._records.append(entry)

    def state_limit(self, limit: str) -> None:
        with self._lock:
            self._stated_limits.add(limit)

    @property
    def records(self) -> tuple[CallRecord, ...]:
        with self._lock:
            return tuple(self._records)

    @property
    def stated_limits(self) -> tuple[str, ...]:
        """The limits the gateway's rate-limit headers stated, if it ever sent one."""
        with self._lock:
            return tuple(sorted(self._stated_limits))

    @property
    def rate_limited(self) -> int:
        return sum(1 for r in self.records if r.status == _RATE_LIMITED)

    def by_model(self) -> dict[str, ModelSpend]:
        grouped: dict[str, list[CallRecord]] = {}
        for entry in self.records:
            grouped.setdefault(entry.model, []).append(entry)
        return {model: _model_spend(entries) for model, entries in sorted(grouped.items())}


@dataclass(frozen=True, slots=True)
class ModelPrice:
    """A model's list price as the gateway's model list states it, read once a run for the report."""

    model: str
    input_usd_per_million: float | None
    output_usd_per_million: float | None
    basis: str
    # Whether the list carries the model: None when the list could not be read (`fetch_price`).
    listed: bool | None = None


def _per_million(value: object) -> float | None:
    if value is None:
        return None
    try:
        return float(str(value)) * _PER_MILLION
    except ValueError:
        return None


def fetch_price(http: httpx.Client, api_key: str, model: str, config: Gateway = CAPSULE_CONFIG.gateway) -> ModelPrice:
    """The model's price from the gateway's model list (`GET /models`), read now. A failed read is
    stated on the price rather than failing the run: the cost each call reports is the spend's basis."""
    basis = f"GET {config.base_url}/models at {datetime.now(UTC).isoformat(timespec='seconds')}"
    try:
        response = http.get(
            f"{config.base_url}/models",
            headers={"authorization": f"Bearer {api_key}"},
            timeout=config.timeout_ms / 1000,
        )
        response.raise_for_status()
        listed = _dict(response.json()).get("data")
    except (httpx.HTTPError, ValueError) as error:
        return ModelPrice(model, None, None, f"{basis}: not read ({type(error).__name__})", None)
    entries = [_dict(m) for m in listed] if isinstance(listed, list) else []
    entry = next((m for m in entries if m.get("id") == model), None)
    if entry is None:
        return ModelPrice(model, None, None, f"{basis}: the list does not carry {model}", False)
    pricing = _dict(entry.get("pricing"))
    return ModelPrice(model, _per_million(pricing.get("input")), _per_million(pricing.get("output")), basis, True)


def _header(headers: Mapping[str, str], names: Sequence[str]) -> str | None:
    return next((headers[name] for name in names if name in headers), None)


def _float(raw: str | None) -> float | None:
    if raw is None:
        return None
    try:
        value = float(raw.strip())
    except ValueError:
        return None
    return value if math.isfinite(value) else None


def _default_bucket() -> TokenBucket:
    return TokenBucket(CAPSULE_CONFIG.gateway.calls_per_minute, CAPSULE_CONFIG.gateway.concurrency)


@dataclass(slots=True)
class GatewayClient:
    """One run's line to the gateway: its key, its HTTP client, its bucket and its ledger, shared by
    every scoped view (`scoped`); `calls` counts the HTTP calls made through this view."""

    api_key: str
    http: httpx.Client
    config: Gateway = CAPSULE_CONFIG.gateway
    model: str = CAPSULE_MODEL
    providers: tuple[str, ...] = ()
    concurrency: int = CAPSULE_CONFIG.gateway.concurrency
    bucket: TokenBucket = field(default_factory=_default_bucket)
    ledger: UsageLedger = field(default_factory=UsageLedger)
    clock: Callable[[], float] = time.monotonic
    sleep: Callable[[float], None] = time.sleep
    calls: int = 0

    @classmethod
    def for_run(
        cls,
        api_key: str,
        http: httpx.Client,
        settings: WriterSettings,
        clock: Callable[[], float] = time.monotonic,
        sleep: Callable[[float], None] = time.sleep,
    ) -> "GatewayClient":
        """The run's client on its settings: the model, the providers, the pool and the bucket."""
        return cls(
            api_key,
            http,
            model=settings.model,
            providers=settings.providers,
            concurrency=settings.concurrency,
            bucket=TokenBucket(settings.calls_per_minute, settings.concurrency, clock, sleep),
            clock=clock,
            sleep=sleep,
        )

    def scoped(self) -> "GatewayClient":
        """A view for one page: the same line, bucket and ledger, its own call count from zero."""
        return replace(self, calls=0)

    def rolling[T, R](
        self,
        items: Sequence[T],
        start: Callable[[T], Callable[["GatewayClient"], R]],
        land: Callable[[T, R], None],
        stop: Callable[[], bool] = lambda: False,
    ) -> bool:
        """THE ROLLING POOL: at most `concurrency` items in flight, a slot refilled the moment its item
        lands. `start(item)` runs on the caller's thread as the item starts (so it reads the state
        every landed item left) and returns the work, run on a scoped view in a worker; `land(item,
        result)` runs on the caller's thread as each lands, in landing order. `stop` is asked before
        each start; True ends the run once the items in flight land. Returns whether it stopped.
        A worker that raises starts nothing more: every item still in flight finishes and lands
        (its spend is tallied), then the first error is raised."""
        queue = iter(items)
        failure: Exception | None = None
        with ThreadPoolExecutor(max_workers=max(1, self.concurrency)) as pool:
            flight: dict[Future[R], T] = {}
            stopped = False
            while True:
                while failure is None and not stopped and len(flight) < max(1, self.concurrency):
                    item = next(queue, _DONE)
                    if item is _DONE:
                        break
                    if stop():
                        stopped = True
                        break
                    work = start(cast("T", item))
                    flight[pool.submit(work, self.scoped())] = cast("T", item)
                if not flight:
                    break
                done, _ = wait(flight, return_when=FIRST_COMPLETED)
                for future in done:
                    item = flight.pop(future)
                    try:
                        result = future.result()
                    except Exception as error:  # kept, and raised once the flight has landed
                        failure = failure or error
                        continue
                    land(item, result)
        if failure is not None:
            raise failure
        return stopped

    def _retry_after(self, response: httpx.Response) -> float | None:
        """The seconds the gateway's `retry-after` asks for (a count or a date); None when absent,
        unreadable or not in the future."""
        raw = response.headers.get("retry-after")
        if raw is None:
            return None
        seconds = _float(raw)
        if seconds is None:
            try:
                seconds = parsedate_to_datetime(raw).timestamp() - time.time()
            except (TypeError, ValueError):
                return None
        return None if not math.isfinite(seconds) or seconds <= 0 else seconds

    def _line_spent_for(self, response: httpx.Response) -> float | None:
        """Seconds until the gateway's limit resets for everyone, when its rate-limit headers say the
        limit is spent (remaining 0 with a reset); None when they do not say so."""
        limit = _header(response.headers, _LIMIT_HEADERS)
        if limit is not None:
            self.ledger.state_limit(limit)
        remaining = _float(_header(response.headers, _REMAINING_HEADERS))
        reset = _float(_header(response.headers, _RESET_HEADERS))
        if remaining is None or remaining > 0 or reset is None or reset <= 0:
            return None
        return reset - time.time() if reset >= _EPOCH_RESET_FLOOR else reset

    def _post(self, messages: Sequence[dict[str, str]], max_tokens: int) -> httpx.Response:
        self.bucket.acquire()
        self.calls += 1
        body: dict[str, object] = {"model": self.model, "messages": list(messages), "max_tokens": max_tokens}
        if not self.config.thinking:
            body.update(_THINKING_DISABLED)
        if self.providers:
            body["providerOptions"] = {"gateway": {"only": list(self.providers)}}
        try:
            return self.http.post(
                f"{self.config.base_url}/chat/completions",
                json=body,
                headers={"authorization": f"Bearer {self.api_key}"},
                timeout=self.config.timeout_ms / 1000,
            )
        except httpx.HTTPError:
            self.ledger.record(CallRecord(self.model, None))
            raise

    def _back_off_rate_limit(self, response: httpx.Response, attempt: int, billed: Usage | None) -> None:
        """A 429: waits before this call tries again, or raises why it will not. The wait is this
        call's own: the `retry-after` the gateway asks for, however long, up to `retry_after_cap_ms`
        (past it the call fails with the reason), else the configured backoff. When the rate-limit
        headers say the line is spent, the bucket holds every caller until the reset instead."""
        retry = self.config.retry
        backoffs = retry.rate_limit_backoff_ms
        if response.headers.get("x-should-retry", "").strip().lower() == "false":
            raise GenerationError("Gateway returned HTTP 429 with x-should-retry false, not retried.", True, billed)
        if attempt > len(backoffs):
            raise GenerationError(f"Gateway returned HTTP 429 on attempt {attempt}, not retried.", True, billed)
        line_wait = self._line_spent_for(response)
        if line_wait is not None and line_wait > 0:
            self.bucket.pause_for(line_wait)
            return
        asked = self._retry_after(response)
        cap = retry.retry_after_cap_ms / 1000
        if asked is not None and asked > cap:
            raise GenerationError(
                f"Gateway returned HTTP 429 asking to retry after {asked:.0f} s, past the {cap:.0f} s cap, not retried.",
                True,
                billed,
            )
        self.sleep(asked if asked is not None else backoffs[attempt - 1] / 1000)

    def complete(
        self, messages: Sequence[dict[str, str]], max_tokens: int, min_words: int = DEGENERATE_COMPLETION_WORDS
    ) -> Completion:
        """`postChatCompletion`."""
        retry = self.config.retry
        billed: Usage | None = None
        attempts = max(retry.max_attempts, len(retry.rate_limit_backoff_ms) + 1)
        for attempt in range(1, attempts + 1):
            try:
                response = self._post(messages, max_tokens)
            except httpx.HTTPError as error:
                if attempt < retry.max_attempts:
                    self.sleep(retry.base_delay_ms * attempt / 1000)
                    continue
                raise GenerationError(f"Gateway request failed after its retry: {error}", True, billed) from None
            if response.status_code == _RATE_LIMITED:
                self.ledger.record(CallRecord(self.model, _RATE_LIMITED))
                self._back_off_rate_limit(response, attempt, billed)
                continue
            if not response.is_success:
                self.ledger.record(CallRecord(self.model, response.status_code))
                if response.status_code < _SERVER_ERROR:
                    raise GenerationError(f"Gateway refused the request: HTTP {response.status_code}.", False)
                if attempt < retry.max_attempts:
                    self.sleep(retry.base_delay_ms * attempt / 1000)
                    continue
                raise GenerationError(f"Gateway returned HTTP {response.status_code} after its retry.", True, billed)
            completion = _parse(response.text)
            self.ledger.record(CallRecord(self.model, response.status_code, completion.provider, completion.usage))
            if len(completion.content.split()) < min_words:
                billed = add_usage(billed, completion.usage)
                if attempt < retry.max_attempts:
                    self.sleep(retry.base_delay_ms * attempt / 1000)
                    continue
                raise GenerationError("Gateway returned an empty completion after its retry.", True, billed)
            if completion.cut_off:
                billed = add_usage(billed, completion.usage)
                if attempt < retry.max_attempts:
                    self.sleep(retry.base_delay_ms * attempt / 1000)
                    continue
                raise GenerationError(
                    f"Gateway returned a completion cut off at its token limit ({max_tokens}) after its retry.",
                    True,
                    billed,
                )
            return Completion(completion.content, add_usage(billed, completion.usage), completion.provider)
        raise GenerationError("Gateway request failed.", True, billed)
