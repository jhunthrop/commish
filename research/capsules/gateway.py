"""THE GATEWAY CALL: one chat completion, paced, retried and accounted.

Ported from `research-ts/src/capsules/write.ts` (`postChatCompletion`). Every call waits for its slot
(`min_call_spacing_ms`, the gateway's measured ceiling), a 429 gets its own longer backoff (a
`retry-after` the gateway sends is honoured up to that ceiling), a 5xx, a network error or an empty
completion gets one retry, and usage the gateway billed before a failure is kept on the error, so a
player's cost is counted whether or not his read survived. The pacing state lives on the client the
caller holds (one per process), never in a module global. The key is read from the environment by
the caller and never printed.
"""

import json
import math
import time
from collections.abc import Callable, Sequence
from dataclasses import dataclass, field
from email.utils import parsedate_to_datetime
from typing import Any, Final

import httpx

from research.capsules.config import CAPSULE_CONFIG, CAPSULE_MODEL, Gateway

DEGENERATE_COMPLETION_WORDS: Final = 20
_THINKING_DISABLED: Final = {"thinking": {"type": "disabled"}, "reasoning_effort": "none"}
_CONTROL: Final = dict.fromkeys((*range(0, 9), 11, 12, *range(14, 32)))
_RATE_LIMITED: Final = 429
_SERVER_ERROR: Final = 500


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
    raw_usage = _dict(body.get("usage"))
    cost = raw_usage.get("cost")
    usage = Usage(
        _int_or_none(raw_usage.get("prompt_tokens")),
        _int_or_none(raw_usage.get("completion_tokens")),
        _int_or_none(raw_usage.get("total_tokens")),
        float(cost) if isinstance(cost, int | float) and not isinstance(cost, bool) else None,
    )
    return Completion(str(content), usage)


@dataclass(slots=True)
class GatewayClient:
    """One process's line to the gateway: its key, its HTTP client and its pacing."""

    api_key: str
    http: httpx.Client
    config: Gateway = CAPSULE_CONFIG.gateway
    model: str = CAPSULE_MODEL
    spacing_ms: int = CAPSULE_CONFIG.gateway.min_call_spacing_ms
    clock: Callable[[], float] = time.monotonic
    sleep: Callable[[float], None] = time.sleep
    calls: int = 0
    _next_call_at: float = field(default=0.0)

    def _wait_for_slot(self) -> None:
        if self.spacing_ms <= 0:
            return
        now = self.clock()
        wait = max(0.0, self._next_call_at - now)
        self._next_call_at = max(now, self._next_call_at) + self.spacing_ms / 1000
        if wait > 0:
            self.sleep(wait)

    def _retry_after(self, response: httpx.Response) -> float | None:
        raw = response.headers.get("retry-after")
        if raw is None:
            return None
        ceiling = max(self.config.retry.rate_limit_backoff_ms) / 1000
        try:
            seconds = float(raw.strip())
        except ValueError:
            try:
                seconds = parsedate_to_datetime(raw).timestamp() - time.time()
            except (TypeError, ValueError):
                return None
        return None if not math.isfinite(seconds) or seconds <= 0 or seconds > ceiling else seconds

    def _post(self, messages: Sequence[dict[str, str]], max_tokens: int) -> httpx.Response:
        self._wait_for_slot()
        self.calls += 1
        body: dict[str, object] = {"model": self.model, "messages": list(messages), "max_tokens": max_tokens}
        if not self.config.thinking:
            body.update(_THINKING_DISABLED)
        return self.http.post(
            f"{self.config.base_url}/chat/completions",
            json=body,
            headers={"authorization": f"Bearer {self.api_key}"},
            timeout=self.config.timeout_ms / 1000,
        )

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
                if attempt <= len(retry.rate_limit_backoff_ms):
                    backoff = retry.rate_limit_backoff_ms[attempt - 1] / 1000
                    self.sleep(self._retry_after(response) or backoff)
                    continue
                raise GenerationError(
                    f"Gateway returned HTTP 429 after {len(retry.rate_limit_backoff_ms)} backoff retries.", True, billed
                )
            if response.status_code >= _SERVER_ERROR:
                if attempt < retry.max_attempts:
                    self.sleep(retry.base_delay_ms * attempt / 1000)
                    continue
                raise GenerationError(f"Gateway returned HTTP {response.status_code} after its retry.", True, billed)
            if not response.is_success:
                raise GenerationError(f"Gateway refused the request: HTTP {response.status_code}.", False)
            completion = _parse(response.text)
            if len(completion.content.split()) < min_words:
                billed = add_usage(billed, completion.usage)
                if attempt < retry.max_attempts:
                    self.sleep(retry.base_delay_ms * attempt / 1000)
                    continue
                raise GenerationError("Gateway returned an empty completion after its retry.", True, billed)
            return Completion(completion.content, add_usage(billed, completion.usage))
        raise GenerationError("Gateway request failed.", True, billed)
