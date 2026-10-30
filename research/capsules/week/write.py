"""ONE WEEK READ, WRITTEN: a draft and its corrections within the read's ceiling, the facts block as its
counted fallback.

The ask is the season writer's (`generate.ask`, Lane 52): a rate limit or a transport failure waits and
asks again with the same prompt and never spends one of the read's asks; a call the run's budget refuses
(`run_budget`, the step attaches one) ends the read at once, named for the budget. An empty or cut answer
is an ask spent. The answer is the read and the writer's call for it (`prompt.parse_week_answer`). A draft
that breaks a rule is handed back with every rule broken so far and its sentence (`rule_notes`), up to
`MAX_CALLS_PER_READ` asks in all. A read whose writer's asks are spent without a written read is asked once
more of the retry writer (Lane 276, `retry_model`, the setting `config.RETRY_WRITER_MODEL`): the correction of
the writer's last draft with his voice's reminder (Lane 282), or the first ask when no draft was answered, held to the same
rules and the same judge. Only a read that every writer failed is his facts block (`render_week_facts_block`),
labelled facts and no prose.

Every answer's read has its season said once (`season_words.said_once`, Lane 303) before the validator reads it,
and that is the read stored and the draft a correction hands back.
"""

from collections.abc import Sequence, Set
from dataclasses import dataclass
from typing import Final

from research.capsules.facts_block import FACTS_SOURCE
from research.capsules.gateway import GatewayClient, GenerationError
from research.capsules.gateway_ledger import Usage, add_usage
from research.capsules.generate import BUDGET_SPENT, THROTTLED, ask, gateway_failure
from research.capsules.page_figures import fallback_violation
from research.capsules.rule_notes import notes_of
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
from research.capsules.week.prompt import parse_week_answer, week_correction, week_prompt, week_rules
from research.capsules.week.render import render_week_facts_block
from research.capsules.week.season_words import said_once
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
# Every fall a writer's asks reached (a draft that broke a rule, none answered), as against a gateway's refusal.
FAILED_VALIDATION: Final = "failed validation"
OVER_CAP_FALL: Final = f"{FAILED_VALIDATION}: the read ran over the {WEEK_BAND[1]}-word cap twice"
MAX_ASKS_PER_READ: Final = MAX_CALLS_PER_READ + OVERRUN_RETRIES + OVERRUN_JUDGE_ASKS
# Lane 276: the retry writer's one draft once the writer's asks are spent, and for a player who may not be
# started the judge's ask on it; a read's worst case is MAX_ASKS_PER_READ and these.
RETRY_WRITER_DRAFTS: Final = 1
RETRY_WRITER_JUDGE_ASKS: Final = 1
MAX_ASKS_WITH_RETRY: Final = MAX_ASKS_PER_READ + RETRY_WRITER_DRAFTS + RETRY_WRITER_JUDGE_ASKS
# The placeholder a draft carries when it passed and no ask was left for the judge: never a rule it broke.
_NO_JUDGE_ASK: Final = "No ask was left for the judge."
# A five-sentence read and its call run about 180 tokens; the cap leaves room and never cuts an honest read.
MAX_TOKENS: Final = 600


@dataclass(frozen=True, slots=True)
class WeekAttempt:
    body: str
    call: str | None
    violations: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class WeekReadResult:
    """The read as stored (`text`, `source`, `call`), what wrote it, what it cost, its attempts, why it
    fell to the facts block (None when written), and the drafts asked of the retry writer (`retry_asks`)."""

    text: str
    source: str
    call: str | None
    model: str | None
    usage: Usage | None
    calls: int
    attempts: tuple[WeekAttempt, ...]
    fallback: str | None
    retry_asks: int = 0

    @property
    def rescued(self) -> bool:
        """Whether the retry writer wrote the read the writer's asks could not."""
        return self.retry_asks > 0 and self.fallback is None


def messages_for(user: str) -> list[dict[str, str]]:
    return [{"role": "system", "content": week_rules()}, {"role": "user", "content": user}]


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


def write_week_read(  # noqa: PLR0913 - the read's parts
    sheet: WeekSheet,
    gateway: GatewayClient,
    avoid: Sequence[str] = (),
    taken: Set[str] = frozenset(),
    judge_model: str = JUDGE_MODEL,
    *,
    retry_model: str | None = None,
) -> WeekReadResult:
    """`sheet`'s read, told the sentences other pages carry (`avoid`, quoted) and held to their shapes
    (`taken`). For a player who may not be started, a read that passes goes to the judge (`judge`), whose
    call is one of the read's four, made to `judge_model` on the same line and budget. A read the writer's
    asks could not write is asked once more of `retry_model` when one is named (`_retry_writer_read`).
    `calls` counts every HTTP call made for him, the judge's, retries and re-asks included."""
    judge = gateway.with_model(judge_model)
    fallen = _writer_read(sheet, gateway, judge, avoid, taken)
    if retry_model is None or fallen.fallback is None or not fallen.fallback.startswith(FAILED_VALIDATION):
        return fallen
    return _retry_writer_read(sheet, gateway.with_model(retry_model), judge, avoid, taken, fallen=fallen)


def _writer_read(
    sheet: WeekSheet, gateway: GatewayClient, judge: GatewayClient, avoid: Sequence[str], taken: Set[str]
) -> WeekReadResult:
    """The writer's own asks at `sheet`'s read, within the read's ceiling (`_Asks`)."""
    before = gateway.calls

    def made() -> int:
        return gateway.calls - before + judge.calls

    usage: Usage | None = None
    attempts: list[WeekAttempt] = []
    asks = _Asks()
    user = week_prompt(sheet, avoid)
    while asks.left:
        asks.made += 1
        try:
            completion = ask(gateway, messages_for(user), MAX_TOKENS)
        except GenerationError as error:
            usage = add_usage(usage, error.billed)
            failure = gateway_failure(error)
            if failure.kind in (BUDGET_SPENT, THROTTLED) or not error.retryable:
                return _facts(sheet, usage, made(), attempts, _gateway_why(error))
            continue  # an empty or cut answer is an ask spent: ask again while asks remain
        usage = add_usage(usage, completion.usage)
        answer = parse_week_answer(completion.content)
        text = said_once(answer.read or "", sheet.season, None if sheet.bye else sheet.week)
        result = validate_week_read(text, sheet, taken, answer.call)
        if asks.count_over(result):
            attempts.append(WeekAttempt(text, answer.call, result.violations))
            # The fall names the guard a figure broke before the cap, as every fall does (fallback_violation).
            alone = len(result.violations) == 1
            why = OVER_CAP_FALL if alone else f"{FAILED_VALIDATION}: {fallback_violation(result.violations)}"
            return _facts(sheet, usage, made(), attempts, why)
        asks.grant_overrun(result, judged=not sheet.may_start)
        violations = result.violations
        if result.ok and not sheet.may_start:
            if not asks.judge_left:
                attempts.append(WeekAttempt(text, answer.call, (_NO_JUDGE_ASK,)))
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
            return WeekReadResult(text, WRITTEN_SOURCE, answer.call, gateway.model, usage, calls, tuple(attempts), None)
        ledger = notes_of([(attempt.body, attempt.violations) for attempt in attempts])
        user = week_correction(sheet, text, ledger, avoid)
    return _facts(sheet, usage, made(), attempts, _validation_why(attempts))


def _validation_why(attempts: Sequence[WeekAttempt]) -> str:
    last = attempts[-1].violations if attempts else ()
    return f"{FAILED_VALIDATION}: {fallback_violation(last) if last else 'no answer was written'}"


def _retry_prompt(sheet: WeekSheet, attempts: Sequence[WeekAttempt], avoid: Sequence[str]) -> str:
    """The retry writer's ask: the correction of the writer's last answered draft with every rule broken so
    far and his voice's reminder (Lane 282), or the first ask, voice and all, when no draft was answered."""
    drafts = [attempt for attempt in attempts if attempt.body]
    if not drafts:
        return week_prompt(sheet, avoid)
    broken = [(a.body, tuple(v for v in a.violations if v != _NO_JUDGE_ASK)) for a in drafts]
    return week_correction(sheet, drafts[-1].body, notes_of(broken), avoid)


def _retry_writer_read(  # noqa: PLR0913 - the read's parts
    sheet: WeekSheet,
    retrier: GatewayClient,
    judge: GatewayClient,
    avoid: Sequence[str],
    taken: Set[str],
    *,
    fallen: WeekReadResult,
) -> WeekReadResult:
    """One draft of the read `fallen` could not write, asked of the retry writer (`retrier`, the same line,
    bucket and budget), validated as the writer's are and judged by the same judge for a player who may not
    be started; written as the retry writer's, else the facts block named for this last draft, or for the
    writer's own fall when the gateway refused the retry's ask."""
    judge_before = judge.calls
    attempts, usage = list(fallen.attempts), fallen.usage

    def done(text: str, source: str, call: str | None, why: str | None) -> WeekReadResult:
        calls = fallen.calls + retrier.calls + judge.calls - judge_before
        model = retrier.model if why is None else None
        return WeekReadResult(text, source, call, model, usage, calls, tuple(attempts), why, RETRY_WRITER_DRAFTS)

    block = render_week_facts_block(sheet)
    try:
        completion = ask(retrier, messages_for(_retry_prompt(sheet, attempts, avoid)), MAX_TOKENS)
    except GenerationError as error:
        # A refusal at the retry ask (the budget's above all, Lane 276 review M1) keeps the writer's own fall: his
        # facts block lands and stays due, never a read the budget stopped with no row.
        usage = add_usage(usage, error.billed)
        return done(block, FACTS_SOURCE, None, fallen.fallback)
    usage = add_usage(usage, completion.usage)
    answer = parse_week_answer(completion.content)
    text = said_once(answer.read or "", sheet.season, None if sheet.bye else sheet.week)
    violations = validate_week_read(text, sheet, taken, answer.call).violations
    if not violations and not sheet.may_start:
        try:
            says, judged = _judged_start(sheet, text, judge)
        except GenerationError as error:
            usage = add_usage(usage, error.billed)
            attempts.append(WeekAttempt(text, answer.call, ()))
            return done(block, FACTS_SOURCE, None, fallen.fallback)
        usage = add_usage(usage, judged)
        violations = (judge_violation(sheet),) if says else ()
    attempts.append(WeekAttempt(text, answer.call, violations))
    if violations:
        return done(block, FACTS_SOURCE, None, _validation_why(attempts))
    return done(text, WRITTEN_SOURCE, answer.call, None)
