"""THE GATEWAY CALL: one chat completion, paced, retried and accounted.

Ported from `research-ts/src/capsules/write.ts` (`postChatCompletion`). Every call draws a token from
the run's bucket (`pace.TokenBucket`, `calls_per_minute`). A 429 gets its own longer backoff for the
one call that met it (a `retry-after` the gateway sends is honoured however long, up to
`retry_after_cap_ms`, past which the call fails with the reason, and an `x-should-retry: false` ends
the call); only when the gateway's rate-limit headers say the limit is
spent for everyone does the whole line pause until their reset. A 5xx, a network error, an empty
completion or one the gateway says was cut at its token limit (`finish_reason: length`, never read
as a whole answer: Lane 29) gets one retry, and usage the gateway billed before a failure is kept on
the error, so a player's cost is counted whether or not his read survived. A failure the line caused
(a rate limit, a network error, a 5xx, a response that was not JSON) is marked `transport`, which the
writer waits out (`generate._ask`, Lane 52). A run with a budget (`run_budget`) draws on it before
every HTTP call, so the budget is a hard stop at the gateway.

Pages are written `concurrency` at a time (`GatewayClient.rolling`): each page holds its own
scoped view of the run's client (its own call count over the shared line, bucket and ledger). The
ledger records every call's model, its serving provider and the cost the gateway's usage response
states; the gateway's price list is read once a run (`gateway_ledger.fetch_price`). The pacing
state lives on the client the caller holds, never in a module global. The key is read from the
environment by the caller and never printed.
"""

import json
import math
import time
from collections.abc import Callable, Mapping, Sequence
from concurrent.futures import FIRST_COMPLETED, Future, ThreadPoolExecutor, wait
from dataclasses import dataclass, field, replace
from email.utils import parsedate_to_datetime
from typing import TYPE_CHECKING, Any, Final, cast

import httpx

from research.capsules.config import CAPSULE_CONFIG, CAPSULE_MODEL, Gateway, WriterSettings
from research.capsules.gateway_ledger import (
    RATE_LIMITED,
    CallRecord,
    Usage,
    UsageLedger,
    add_usage,
    as_dict,
)
from research.capsules.pace import TokenBucket

if TYPE_CHECKING:
    from research.capsules.run_budget import RunBudget

DEGENERATE_COMPLETION_WORDS: Final = 20
_THINKING_DISABLED: Final = {"thinking": {"type": "disabled"}, "reasoning_effort": "none"}
_CONTROL: Final = dict.fromkeys((*range(0, 9), 11, 12, *range(14, 32)))
_SERVER_ERROR: Final = 500
_CUT_OFF: Final = "length"
# The rate-limit headers a gateway may answer with, in either spelling (the IETF draft's or the
# common `x-` one). The Vercel AI Gateway sent none on Lane 24's probes; they are read when sent.
_LIMIT_HEADERS: Final = ("x-ratelimit-limit", "ratelimit-limit")
_REMAINING_HEADERS: Final = ("x-ratelimit-remaining", "ratelimit-remaining")
_RESET_HEADERS: Final = ("x-ratelimit-reset", "ratelimit-reset")
# A reset this large is an epoch second, not a count of seconds to wait.
_EPOCH_RESET_FLOOR: Final = 1_000_000_000
# The end of a rolling pool's items.
_DONE: Final = object()


class GenerationError(Exception):
    """A call that did not produce a usable completion; `billed` is what the gateway charged anyway.
    `transport` marks a rate limit or a transport failure (a network error, a 5xx, a response that was
    not JSON): the line failed, not the writer, so the page waits and asks again (`generate`)."""

    def __init__(self, message: str, retryable: bool, billed: Usage | None = None, *, transport: bool = False) -> None:
        super().__init__(message)
        self.retryable = retryable
        self.billed = billed
        self.transport = transport


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


def _parse(raw: str) -> Completion:
    try:
        body: Any = json.loads(raw)
    except ValueError:
        try:
            body = json.loads(raw.translate(_CONTROL))
        except ValueError as error:
            raise GenerationError(f"Gateway response was not parseable JSON: {error}", True, transport=True) from None
    if not isinstance(body, dict):
        raise GenerationError("Gateway response was not a JSON object.", True, transport=True)
    choices = body.get("choices")
    first = as_dict(choices[0]) if isinstance(choices, list) and choices else {}
    message = as_dict(first.get("message"))
    content = message.get("content") if isinstance(message.get("content"), str) else ""
    routing = as_dict(as_dict(as_dict(message.get("provider_metadata")).get("gateway")).get("routing"))
    provider = routing.get("finalProvider")
    raw_usage = as_dict(body.get("usage"))
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
    # The run's budget (`run_budget`), shared by every scoped view: None for a run with no cap.
    budget: "RunBudget | None" = None

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

    def with_budget(self, budget: "RunBudget") -> "GatewayClient":
        """This client drawing every call it makes from `budget`, a hard stop."""
        return replace(self, budget=budget)

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
            raise GenerationError(
                "Gateway returned HTTP 429 with x-should-retry false, not retried.", True, billed, transport=True
            )
        if attempt > len(backoffs):
            raise GenerationError(
                f"Gateway returned HTTP 429 on attempt {attempt}, not retried.", True, billed, transport=True
            )
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
                transport=True,
            )
        self.sleep(asked if asked is not None else backoffs[attempt - 1] / 1000)

    def _retry_or_fail(self, attempt: int, failure: str, billed: Usage | None, *, transport: bool) -> None:
        """One retry for a failed attempt (a network error, a 5xx, an empty or a cut completion): wait and
        go again while attempts are left, else raise the failure with the usage billed so far."""
        retry = self.config.retry
        if attempt >= retry.max_attempts:
            raise GenerationError(f"{failure} after its retry.", True, billed, transport=transport)
        self.sleep(retry.base_delay_ms * attempt / 1000)

    def complete(
        self, messages: Sequence[dict[str, str]], max_tokens: int, min_words: int = DEGENERATE_COMPLETION_WORDS
    ) -> Completion:
        """`postChatCompletion`."""
        retry = self.config.retry
        billed: Usage | None = None
        attempts = max(retry.max_attempts, len(retry.rate_limit_backoff_ms) + 1)
        for attempt in range(1, attempts + 1):
            reserved = self._reserve(messages, max_tokens)
            try:
                response = self._post(messages, max_tokens)
            except httpx.HTTPError as error:
                self._settle(reserved, None, billed=True)
                self._retry_or_fail(attempt, f"Gateway request failed ({error})", billed, transport=True)
                continue
            if response.status_code == RATE_LIMITED:
                self._settle(reserved, None, billed=False)
                self.ledger.record(CallRecord(self.model, RATE_LIMITED))
                self._back_off_rate_limit(response, attempt, billed)
                continue
            if not response.is_success:
                self._settle(reserved, None, billed=False)
                self.ledger.record(CallRecord(self.model, response.status_code))
                if response.status_code < _SERVER_ERROR:
                    raise GenerationError(f"Gateway refused the request: HTTP {response.status_code}.", False)
                self._retry_or_fail(attempt, f"Gateway returned HTTP {response.status_code}", billed, transport=True)
                continue
            try:
                completion = _parse(response.text)
            except GenerationError:
                self._settle(reserved, None, billed=True)
                raise
            self._settle(reserved, completion.usage, billed=True)
            self.ledger.record(CallRecord(self.model, response.status_code, completion.provider, completion.usage))
            failure = self._unusable(completion, min_words, max_tokens)
            if failure is None:
                return replace(completion, usage=add_usage(billed, completion.usage))
            billed = add_usage(billed, completion.usage)
            self._retry_or_fail(attempt, failure, billed, transport=False)
        raise GenerationError("Gateway request failed.", True, billed, transport=True)

    def _reserve(self, messages: Sequence[dict[str, str]], max_tokens: int) -> float:
        """The run's budget takes this call before it is made (`run_budget`); nothing with no budget."""
        if self.budget is None:
            return 0.0
        return self.budget.reserve(sum(len(m.get("content", "")) for m in messages), max_tokens)

    def _settle(self, reserved: float, usage: Usage | None, *, billed: bool) -> None:
        if self.budget is not None:
            self.budget.settle(reserved, usage, billed=billed)

    @staticmethod
    def _unusable(completion: Completion, min_words: int, max_tokens: int) -> str | None:
        """Why a completion that came back is not an answer: empty, or cut at its token limit."""
        if len(completion.content.split()) < min_words:
            return "Gateway returned an empty completion"
        if completion.cut_off:
            return f"Gateway returned a completion cut off at its token limit ({max_tokens})"
        return None
