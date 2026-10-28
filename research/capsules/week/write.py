"""ONE WEEK READ, WRITTEN: a draft and its corrections within the read's ceiling, the facts block as its
counted fallback.

The ask is the season writer's (`generate.ask`, Lane 52): a rate limit or a transport failure waits and
asks again with the same prompt and never spends one of the read's asks; a call the run's budget refuses
(`run_budget`, the step attaches one) ends the read at once, named for the budget. An empty or cut answer
is an ask spent. The answer is the read and the writer's call for it (`prompt.parse_week_answer`). A draft
that breaks a rule is handed back with every rule broken so far and its sentence (`rule_notes`), up to
`MAX_CALLS_PER_READ` asks in all; a read that never passes is his facts block (`render_week_facts_block`),
labelled facts and no prose.
"""

from collections.abc import Sequence, Set
from dataclasses import dataclass
from typing import Final

from research.capsules.facts_block import FACTS_SOURCE
from research.capsules.gateway import GatewayClient, GenerationError
from research.capsules.gateway_ledger import Usage, add_usage
from research.capsules.generate import BUDGET_SPENT, THROTTLED, ask, gateway_failure
from research.capsules.page_figures import fallback_violation
from research.capsules.store import WRITTEN_SOURCE
from research.capsules.validate import ValidationResult
from research.capsules.week.judge import (
    JUDGE_MAX_TOKENS,
    JUDGE_MIN_WORDS,
    JUDGE_MODEL,
    judge_messages,
    judge_violation,
    says_start,
)
from research.capsules.week.prompt import WEEK_RULES, parse_week_answer, week_correction, week_notes, week_prompt
from research.capsules.week.render import render_week_facts_block
from research.capsules.week.sheet import WeekSheet
from research.capsules.week.validate import WEEK_BAND, validate_week_read

# A draft and three corrections, the judge's call among them for a player who may not be started: a week
# read is short, and a fourth failure is a facts block, retried on the cadence's terms. The season read's ceiling is six for two reads and a narrative.
MAX_CALLS_PER_READ: Final = 4
# Lane 100: a read whose last draft within the ceiling broke only the word cap is asked once more, its
# overrun named, before it falls to the facts block. For a player who may not be started (a bye, Out) the
# retry carries the judge's ask with it, as a playing player's read needs none (Lane 117, B80). The run's
# budget counts both in a read's worst case.
OVERRUN_RETRIES: Final = 1
OVERRUN_JUDGE_ASKS: Final = 1
# Lane 117 (B95, fix round 3): a draft over the cap is handed back once, its count and the target named
# (`prompt.length_move`); a second draft over it is the facts block, never trimmed to fit.
OVER_CAP_DRAFTS: Final = 2
OVER_CAP_FALL: Final = f"failed validation: the read ran over the {WEEK_BAND[1]}-word cap twice"
MAX_ASKS_PER_READ: Final = MAX_CALLS_PER_READ + OVERRUN_RETRIES + OVERRUN_JUDGE_ASKS
# A five-sentence read and its call run about 180 tokens; the cap leaves room and never cuts an honest read.
MAX_TOKENS: Final = 600


@dataclass(frozen=True, slots=True)
class WeekAttempt:
    body: str
    call: str | None
    violations: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class WeekReadResult:
    """The read as stored (`text`, `source`, `call`), what wrote it, what it cost, its attempts, and why it
    fell to the facts block (None when written)."""

    text: str
    source: str
    call: str | None
    model: str | None
    usage: Usage | None
    calls: int
    attempts: tuple[WeekAttempt, ...]
    fallback: str | None


def messages_for(user: str) -> list[dict[str, str]]:
    return [{"role": "system", "content": WEEK_RULES}, {"role": "user", "content": user}]


def _facts(sheet: WeekSheet, usage: Usage | None, calls: int, attempts: list[WeekAttempt], why: str) -> WeekReadResult:
    block = render_week_facts_block(sheet)
    return WeekReadResult(block, FACTS_SOURCE, None, None, usage, calls, tuple(attempts), why)


def _gateway_why(error: GenerationError) -> str:
    failure = gateway_failure(error)
    if failure.kind == BUDGET_SPENT:
        return "the run's budget is spent"
    if failure.kind == THROTTLED:
        return "throttled"
    return "the gateway's answer was refused, empty or cut"


def _over_cap(result: ValidationResult) -> bool:
    return result.band_failure is not None and result.band_failure.words > WEEK_BAND[1]


class _Asks:
    """The read's asks so far, the writer's and the judge's together, within `MAX_CALLS_PER_READ`, the
    overrun's one more draft (`OVERRUN_RETRIES`) once granted, and with it for a player who may not be
    started the judge's ask on that draft (`OVERRUN_JUDGE_ASKS`), which no draft may spend."""

    def __init__(self) -> None:
        self.made = 0
        self.extra = 0
        self.judge_extra = 0
        self.over_cap = 0

    @property
    def left(self) -> bool:
        """Whether another draft may be asked."""
        return self.made < MAX_CALLS_PER_READ + self.extra

    @property
    def judge_left(self) -> bool:
        """Whether the judge may be asked on the draft in hand."""
        return self.made < MAX_CALLS_PER_READ + self.extra + self.judge_extra

    def count_over(self, result: ValidationResult) -> bool:
        """Counts a draft over the word cap; True once one is over it the last time (`OVER_CAP_DRAFTS`)."""
        if _over_cap(result):
            self.over_cap += 1
        return self.over_cap >= OVER_CAP_DRAFTS

    def grant_overrun(self, result: ValidationResult, judged: bool) -> None:
        """One more ask, once, when the ceiling is reached and the draft broke the word cap alone; and the
        judge's ask on that draft when the read is `judged`."""
        over = _over_cap(result)
        if not self.left and self.extra < OVERRUN_RETRIES and over and len(result.violations) == 1:
            self.extra += 1
            if judged:
                self.judge_extra += OVERRUN_JUDGE_ASKS


def _judged_start(sheet: WeekSheet, text: str, judge: GatewayClient) -> tuple[bool, Usage | None]:
    """The judge's verdict on a passing read for a player who may not be started (`judge`): True for start."""
    answer = ask(judge, judge_messages(sheet, text), JUDGE_MAX_TOKENS, JUDGE_MIN_WORDS)
    return says_start(answer.content), answer.usage


@dataclass(frozen=True, slots=True)
class WeekModels:
    """The models a read asks beside the writer's own: the judge's, and the corrections' when one is named
    (`retry`, Lane 264), the first draft always the writer's."""

    judge: str = JUDGE_MODEL
    retry: str | None = None


def write_week_read(
    sheet: WeekSheet,
    gateway: GatewayClient,
    avoid: Sequence[str] = (),
    taken: Set[str] = frozenset(),
    judge_model: str = JUDGE_MODEL,
) -> WeekReadResult:
    """`sheet`'s read, its corrections asked of the writer too (`write_week_read_with`)."""
    return write_week_read_with(sheet, gateway, avoid, taken, WeekModels(judge_model))


def write_week_read_with(
    sheet: WeekSheet,
    gateway: GatewayClient,
    avoid: Sequence[str],
    taken: Set[str],
    models: WeekModels,
) -> WeekReadResult:
    """`sheet`'s read, told the sentences other pages carry (`avoid`, quoted) and held to their shapes
    (`taken`). For a player who may not be started, a read that passes goes to the judge (`judge`), whose
    call is one of the read's four, made to `models.judge` on the same line and budget. A correction is asked
    of `models.retry` when one is named, the first draft always of `gateway`'s own. `calls` counts every
    HTTP call made for him, the judge's, retries and re-asks included."""
    judge = gateway.with_model(models.judge)
    retrier = gateway if models.retry is None else gateway.with_model(models.retry)
    before = gateway.calls

    def made() -> int:
        return gateway.calls - before + judge.calls + (0 if retrier is gateway else retrier.calls)

    usage: Usage | None = None
    attempts: list[WeekAttempt] = []
    asks = _Asks()
    user = week_prompt(sheet, avoid)
    while asks.left:
        asks.made += 1
        try:
            writer = gateway if asks.made == 1 else retrier
            completion = ask(writer, messages_for(user), MAX_TOKENS)
        except GenerationError as error:
            usage = add_usage(usage, error.billed)
            failure = gateway_failure(error)
            if failure.kind in (BUDGET_SPENT, THROTTLED) or not error.retryable:
                return _facts(sheet, usage, made(), attempts, _gateway_why(error))
            continue  # an empty or cut answer is an ask spent: ask again while asks remain
        usage = add_usage(usage, completion.usage)
        answer = parse_week_answer(completion.content)
        text = answer.read or ""
        result = validate_week_read(text, sheet, taken, answer.call)
        if asks.count_over(result):
            attempts.append(WeekAttempt(text, answer.call, result.violations))
            # The fall names the guard a figure broke before the cap, as every fall does (fallback_violation).
            alone = len(result.violations) == 1
            why = OVER_CAP_FALL if alone else f"failed validation: {fallback_violation(result.violations)}"
            return _facts(sheet, usage, made(), attempts, why)
        asks.grant_overrun(result, judged=not sheet.may_start)
        violations = result.violations
        if result.ok and not sheet.may_start:
            if not asks.judge_left:
                attempts.append(WeekAttempt(text, answer.call, ("No ask was left for the judge.",)))
                break
            asks.made += 1
            try:
                says, judged = _judged_start(sheet, text, judge)
            except GenerationError as error:
                usage = add_usage(usage, error.billed)
                attempts.append(WeekAttempt(text, answer.call, ()))
                return _facts(sheet, usage, made(), attempts, _gateway_why(error))
            usage = add_usage(usage, judged)
            violations = (judge_violation(sheet),) if says else ()
        attempts.append(WeekAttempt(text, answer.call, violations))
        if not violations:
            calls = made()
            return WeekReadResult(text, WRITTEN_SOURCE, answer.call, writer.model, usage, calls, tuple(attempts), None)
        ledger = week_notes(sheet, [(attempt.body, attempt.violations) for attempt in attempts])
        user = week_correction(sheet, text, ledger, avoid)
    first = (
        fallback_violation(attempts[-1].violations) if attempts and attempts[-1].violations else "no answer was written"
    )
    return _facts(sheet, usage, made(), attempts, f"failed validation: {first}")
