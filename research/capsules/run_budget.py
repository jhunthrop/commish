"""THE RUN'S BUDGET: a hard stop on a paid run's gateway calls, counted in calls or in dollars.

`write --budget 120` caps the run at 120 calls; `write --budget '$0.20'` caps it at twenty cents. The
gateway client draws on the budget before every HTTP call it makes (`GatewayClient.complete`), the
retries and the throttle's re-asks included, so no call can carry the run past it (Lane 41's caveat:
counting calls a page at a time let transport retries pass the cap by a few). In dollars a call is
reserved at its worst case before it starts, its prompt's characters (never fewer than its tokens)
at the input price plus its whole completion allowance at the output price, and settles at the cost
the gateway states once it answers. A page starts only while its worst case (six asks at the
heaviest prompt measured, `room_for_page`) fits what is left; a page that runs past that, on a long
prompt, a retry or a throttle's re-ask, can still meet the stop part way. A call the budget refuses
raises `BudgetSpentError`
and the page falls to its facts block with that reason, never counted as the writer's failure.
"""

import threading
from dataclasses import dataclass, field
from typing import ClassVar

from research.capsules.config import CAPSULE_CONFIG
from research.capsules.gateway import GenerationError
from research.capsules.gateway_ledger import ModelPrice, Usage

_PER_MILLION = 1_000_000


class BudgetSpentError(GenerationError):
    """A call the run's budget refused: nothing was sent, and nothing waits it out."""

    def __init__(self, message: str) -> None:
        super().__init__(message, False)


def _per_token(per_million: float | None) -> float:
    if per_million is None:
        raise ValueError("a dollar budget needs the model's list price, and the gateway's list has none for it")
    return per_million / _PER_MILLION


@dataclass(slots=True)
class RunBudget:
    """What a run may spend, and what it has: `max_calls` HTTP calls, `max_usd` dollars, either or
    both or neither. Shared by every scoped view of the run's gateway client, across threads."""

    max_calls: int | None = None
    max_usd: float | None = None
    price: ModelPrice | None = None
    calls_made: int = 0
    spent_usd: float = 0.0
    _lock: threading.Lock = field(default_factory=threading.Lock, compare=False, repr=False)

    # A chat request's own tokens beyond its messages' text (roles, separators), counted generously.
    MESSAGE_OVERHEAD_TOKENS: ClassVar[int] = 64

    @classmethod
    def of(cls, *, calls: int | None = None, usd: float | None = None, price: ModelPrice | None = None) -> "RunBudget":
        return cls(calls, usd, price)

    def priced(self, price: ModelPrice) -> "RunBudget":
        """This budget, unspent, with the model's list price to reserve dollars by."""
        return RunBudget(self.max_calls, self.max_usd, price)

    def _usd(self, tokens_in: int, tokens_out: int) -> float:
        if self.max_usd is None:
            return 0.0
        price = self.price
        if price is None:
            raise ValueError("a dollar budget needs the model's list price before its first call")
        return tokens_in * _per_token(price.input_usd_per_million) + tokens_out * _per_token(
            price.output_usd_per_million
        )

    def _worst_call_usd(self, prompt_tokens: int, max_tokens: int) -> float:
        return self._usd(prompt_tokens + self.MESSAGE_OVERHEAD_TOKENS, max_tokens)

    def reserve(self, prompt_chars: int, max_tokens: int) -> float:
        """Takes one call, reserving its worst case; raises `BudgetSpentError` when it would pass the budget."""
        worst = self._worst_call_usd(prompt_chars, max_tokens)
        with self._lock:
            if self.max_calls is not None and self.calls_made + 1 > self.max_calls:
                raise BudgetSpentError(f"the run's budget of {self.max_calls} calls is spent")
            if self.max_usd is not None and self.spent_usd + worst > self.max_usd:
                raise BudgetSpentError(
                    f"the run's budget of ${self.max_usd:.2f} is spent (${self.spent_usd:.4f} so far, the next "
                    f"call could cost ${worst:.4f})"
                )
            self.calls_made += 1
            self.spent_usd += worst
        return worst

    def settle(self, reserved: float, usage: Usage | None, *, billed: bool) -> None:
        """A reserved call's actual cost: what the gateway stated, nothing for a call it did not bill,
        and the reservation kept when it may have billed without saying (a network error)."""
        if usage is not None and usage.cost_usd is not None:
            actual = usage.cost_usd
        elif usage is not None and usage.prompt_tokens is not None and usage.completion_tokens is not None:
            actual = self._usd(usage.prompt_tokens, usage.completion_tokens)
        else:
            actual = reserved if billed else 0.0
        with self._lock:
            self.spent_usd += actual - reserved

    def worst_page_usd(self) -> float:
        """A page's worst case in dollars: every ask it may make at the heaviest prompt measured."""
        per_call = self._worst_call_usd(CAPSULE_CONFIG.trial_worst_prompt_tokens, CAPSULE_CONFIG.bundle_max_tokens)
        return CAPSULE_CONFIG.max_gateway_calls_per_player * per_call

    def room_for_page(self) -> bool:
        """Whether a page may start: its worst case fits what is left of every limit."""
        with self._lock:
            calls, spent = self.calls_made, self.spent_usd
        worst_calls = CAPSULE_CONFIG.max_gateway_calls_per_player
        if self.max_calls is not None and calls + worst_calls > self.max_calls:
            return False
        return self.max_usd is None or spent + self.worst_page_usd() <= self.max_usd

    def line(self) -> str:
        limits = [f"{self.max_calls} calls"] if self.max_calls is not None else []
        limits += [f"${self.max_usd:.2f}"] if self.max_usd is not None else []
        return f"budget {' and '.join(limits) or 'none'}: {self.calls_made} calls made, ${self.spent_usd:.6f} spent"


def parse_budget(raw: str) -> RunBudget:
    """`write --budget`: a whole number of calls ("120"), or dollars ("$0.20")."""
    text = raw.strip()
    try:
        value = float(text[1:]) if text.startswith("$") else int(text)
    except ValueError:
        raise ValueError(f"a budget is a whole number of calls or dollars like $0.20, got {raw!r}") from None
    if value <= 0:
        raise ValueError(f"a budget must be more than nothing, got {raw!r}")
    return RunBudget.of(usd=float(value)) if text.startswith("$") else RunBudget.of(calls=int(value))
