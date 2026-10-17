"""ONE WEEK READ, WRITTEN: a draft and its corrections within the read's ceiling, the facts block as its
counted fallback.

The ask is the season writer's (`generate.ask`, Lane 52): a rate limit or a transport failure waits and
asks again with the same prompt and never spends one of the read's asks; a call the run's budget refuses
ends the read at once, named for the budget. An empty or cut answer is an ask spent. A draft that breaks
a rule is handed back with every rule broken so far and its sentence (`rule_notes`), up to
`MAX_CALLS_PER_READ` asks in all; a read that never passes is his facts block (`render_week_facts_block`),
labelled facts and no prose, which the night counts and writes again the next night.
"""

from collections.abc import Sequence, Set
from dataclasses import dataclass
from typing import Final

from research.capsules.facts_block import FACTS_SOURCE
from research.capsules.gateway import GatewayClient, GenerationError
from research.capsules.gateway_ledger import Usage, add_usage
from research.capsules.generate import BUDGET_SPENT, THROTTLED, ask, gateway_failure
from research.capsules.rule_notes import notes_of
from research.capsules.store import WRITTEN_SOURCE
from research.capsules.week.prompt import WEEK_RULES, week_correction, week_prompt
from research.capsules.week.sheet import WeekSheet, render_week_facts_block
from research.capsules.week.validate import validate_week_read

# A draft and three corrections: a week read is short, and a fourth failure is a facts block tonight and a
# fresh draft tomorrow. The season read's ceiling is six for two reads and a narrative.
MAX_CALLS_PER_READ: Final = 4
# A five-sentence read runs about 160 tokens; the cap leaves room and never cuts an honest read.
MAX_TOKENS: Final = 600


@dataclass(frozen=True, slots=True)
class WeekAttempt:
    body: str
    violations: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class WeekReadResult:
    """The read as stored (`text`, `source`), what wrote it, what it cost, its attempts, and why it fell
    to the facts block (None when written)."""

    text: str
    source: str
    model: str | None
    usage: Usage | None
    calls: int
    attempts: tuple[WeekAttempt, ...]
    fallback: str | None


def _messages(user: str) -> list[dict[str, str]]:
    return [{"role": "system", "content": WEEK_RULES}, {"role": "user", "content": user}]


def _facts(sheet: WeekSheet, usage: Usage | None, calls: int, attempts: list[WeekAttempt], why: str) -> WeekReadResult:
    return WeekReadResult(render_week_facts_block(sheet), FACTS_SOURCE, None, usage, calls, tuple(attempts), why)


def _gateway_why(error: GenerationError) -> str:
    failure = gateway_failure(error)
    if failure.kind == BUDGET_SPENT:
        return "the run's budget is spent"
    if failure.kind == THROTTLED:
        return "throttled"
    return "the gateway's answer was refused, empty or cut"


def write_week_read(
    sheet: WeekSheet, gateway: GatewayClient, avoid: Sequence[str] = (), taken: Set[str] = frozenset()
) -> WeekReadResult:
    """`sheet`'s read, told the sentences other pages carry (`avoid`, quoted) and held to them (`taken`,
    normalized). `calls` counts every HTTP call made for him, retries and re-asks included."""
    before = gateway.calls
    usage: Usage | None = None
    attempts: list[WeekAttempt] = []
    user = week_prompt(sheet, avoid)
    for _ in range(MAX_CALLS_PER_READ):
        try:
            answer = ask(gateway, _messages(user), MAX_TOKENS)
        except GenerationError as error:
            usage = add_usage(usage, error.billed)
            failure = gateway_failure(error)
            if failure.kind in (BUDGET_SPENT, THROTTLED) or not error.retryable:
                return _facts(sheet, usage, gateway.calls - before, attempts, _gateway_why(error))
            continue  # an empty or cut answer is an ask spent: ask again while asks remain
        usage = add_usage(usage, answer.usage)
        text = answer.content.strip()
        result = validate_week_read(text, sheet, taken)
        attempts.append(WeekAttempt(text, result.violations))
        if result.ok:
            return WeekReadResult(
                text, WRITTEN_SOURCE, gateway.model, usage, gateway.calls - before, tuple(attempts), None
            )
        ledger = notes_of([(attempt.body, attempt.violations) for attempt in attempts])
        user = week_correction(sheet, text, ledger, avoid)
    first = attempts[-1].violations[0] if attempts and attempts[-1].violations else "no answer was written"
    return _facts(sheet, usage, gateway.calls - before, attempts, f"failed validation: {first}")
