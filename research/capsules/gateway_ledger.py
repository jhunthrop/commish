"""THE WRITER'S ACCOUNTS: what each gateway call cost and who served it, summed for the run's report.

Split from `gateway.py` (Lane 29, the review's L6): the usage a call states (`Usage`, `add_usage`), the
run's ledger of every call (`CallRecord`, `UsageLedger`, `ModelSpend`), and the model's list price read
once a run (`ModelPrice`, `fetch_price`). The client in `gateway.py` records into the ledger; nothing
here makes a completion call.
"""

import threading
from collections import Counter
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, Final

import httpx

from research.capsules.config import CAPSULE_CONFIG, Gateway

RATE_LIMITED: Final = 429
_PER_MILLION: Final = 1_000_000


def as_dict(value: object) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


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
        sum(1 for e in entries if e.status == RATE_LIMITED),
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
        return sum(1 for r in self.records if r.status == RATE_LIMITED)

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
        listed = as_dict(response.json()).get("data")
    except (httpx.HTTPError, ValueError) as error:
        return ModelPrice(model, None, None, f"{basis}: not read ({type(error).__name__})", None)
    entries = [as_dict(m) for m in listed] if isinstance(listed, list) else []
    entry = next((m for m in entries if m.get("id") == model), None)
    if entry is None:
        return ModelPrice(model, None, None, f"{basis}: the list does not carry {model}", False)
    pricing = as_dict(entry.get("pricing"))
    return ModelPrice(model, _per_million(pricing.get("input")), _per_million(pricing.get("output")), basis, True)
