"""ONE PLAYER'S CAPSULE: one bundle call, the rejection pass, and the facts block as the counted fallback.

Ported from `research-ts/src/capsules/generate.ts`. The bundle (both reads and the narrative) comes
from one call, retried once whole if it never came back or was not an object. Each read is then
validated; a read that fails gets the correction its failure calls for (a length correction, a
fresh draft after a second length miss, the soft points, or a rewrite), each a call, up to
`corrections_per_read` of them (the oracle stopped at one) and all within the player's ceiling
(`max_gateway_calls_per_player`, six; the oracle had four). Once a read has been asked for a shorter
version it may run 10% over its cap. Every correction carries each rule the read has broken on any
attempt so far, with the sentence it broke it in and the rule in one line (`rule_notes`, Lane 52),
and a read out of its band is still read for every other rule, so its length correction asks for
all of it at once. A read the writer's asks could not write (a validation fall) is asked once more of the retry
writer when the run names one (Lane 294, the week read's Lane 276 retry writer on the same gateway
path, `retry_model`): the correction of its last draft with every rule broken so far, or the first ask
for a read the bundle never carried, held to the same validator. That ask is outside the six and the
night's ceiling. A read that still fails is the facts block (`facts_block`): his
numbers as labelled facts, no prose.
Narrative slots refused only for their voice get one rewrite each from what calls are left. Nothing
here raises for a gateway failure: the facts block is the answer, and the usage billed is kept.
A throttle is not a block (Lane 52): an ask the gateway fails on a rate limit or a transport failure
waits and is asked again with the same prompt (`ask`, `throttle_waits_ms`), and never counts against
the six; only a line still down after every wait ends in the facts block, named "throttled". An empty
or cut answer to a correction is an ask spent, and the read asks again while asks remain. A call the
run's budget refuses (`run_budget`) ends the page at once, named for the budget.
"""

from collections.abc import Sequence
from dataclasses import dataclass, replace
from typing import TYPE_CHECKING, Final

from research.capsules.bundle import CapsuleBundle, parse_bundle
from research.capsules.config import CAPSULE_CONFIG
from research.capsules.corrections import soft_correction_for
from research.capsules.facts_block import FACTS_SOURCE, render_facts_block
from research.capsules.gateway import DEGENERATE_COMPLETION_WORDS, Completion, GatewayClient, GenerationError
from research.capsules.gateway_ledger import Usage, add_usage
from research.capsules.narrative import (
    NarrativeResult,
    RefusedSlot,
    SlotRequest,
    failed_narrative,
    narrative_requests_for,
    settle_narrative,
    slot_rewrite_prompt,
    voice_rewritable,
    with_rewritten_slot,
)
from research.capsules.page_figures import fallback_violation
from research.capsules.prompt import (
    NO_WORN_PHRASES,
    FreshDraft,
    PriorAttempt,
    WornPhrases,
    bundle_prompt_for,
    correction_prompt_for,
    writer_rules_for,
)
from research.capsules.rule_notes import notes_of
from research.capsules.run_budget import BudgetSpentError
from research.capsules.validate import (
    NARRATIVE_MIN_WORDS,
    ValidationResult,
    grounding_of,
    validate_capsule,
    validate_narrative_slot,
    word_count,
)

if TYPE_CHECKING:
    from research.capsules.facts.build import PlayerFacts

NOT_AN_OBJECT: Final = "The answer was not a single JSON object."
_NOT_WRITTEN: Final = "The answer carried no such read."
# Why a page's gateway failed it: a line still down after every wait, the run's budget, or an answer
# the gateway refused or that came back empty or cut (an ask like any other, `GenerationError.transport`).
THROTTLED: Final = "throttled"
BUDGET_SPENT: Final = "budget"
UNUSABLE: Final = "unusable"


@dataclass(frozen=True, slots=True)
class Fallback:
    """Why a read fell to the facts block: the gateway never answered, or the writer never validated."""

    kind: str
    first_violation: str | None = None


@dataclass(frozen=True, slots=True)
class ReadAttempt:
    stage: str
    words: int
    body: str
    violations: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class ReadResult:
    text: str
    source: str
    usage: Usage | None
    fallback: Fallback | None
    attempts: tuple[ReadAttempt, ...]
    # The drafts asked of the retry writer for this read (0 or 1, Lane 294).
    retry_asks: int = 0

    @property
    def rescued(self) -> bool:
        """Whether the retry writer wrote the read the writer's asks could not."""
        return self.retry_asks > 0 and self.source == "llm"


@dataclass(frozen=True, slots=True)
class CapsuleResult:
    compact: ReadResult
    full: ReadResult
    narrative: NarrativeResult
    source: str
    model: str | None
    usage: Usage | None
    # Every HTTP call the gateway made for him (his bill), the gateway's own re-asks and the
    # throttle's included.
    calls: int
    # The writer's own asks (the bundle, each correction, each slot rewrite), which the six bound and
    # the night's ceiling counts (Lane 73 ruling 1); a re-ask inside one ask is not another.
    asks: int
    # The drafts asked of the retry writer (Lane 294), outside the six and the night's ceiling.
    retry_asks: int = 0

    @property
    def rescued(self) -> bool:
        """A written page one of whose reads the retry writer wrote."""
        return self.source == "llm" and any(read.rescued for read in (self.compact, self.full))


def _msgs(facts: "PlayerFacts", user: str) -> list[dict[str, str]]:
    """One request: the writer's rules in the voice of the run's day, then the user message."""
    return [{"role": "system", "content": writer_rules_for(facts)}, {"role": "user", "content": user}]


def ask(
    gateway: GatewayClient,
    messages: list[dict[str, str]],
    max_tokens: int,
    min_words: int = DEGENERATE_COMPLETION_WORDS,
) -> Completion:
    """One of the page's asks. A rate limit or a transport failure waits (`throttle_waits_ms`) and asks
    again with the same messages, as the same ask; every wait, the gateway's own included, draws on the
    ask's one allowance (`throttle_waits`), and a wait it cannot cover ends the ask. What the failed
    tries billed rides on the answer, or on the error raised. Any other failure is raised at once."""
    billed: Usage | None = None
    allowance = gateway.ask_waits()
    for wait_ms in (*CAPSULE_CONFIG.throttle_waits_ms, None):
        try:
            answer = gateway.complete(messages, max_tokens, min_words, allowance)
        except GenerationError as error:
            billed = add_usage(billed, error.billed)
            if not error.transport or wait_ms is None or not allowance.take(wait_ms / 1000):
                error.billed = billed
                raise
            gateway.sleep(wait_ms / 1000)
            continue
        return replace(answer, usage=add_usage(billed, answer.usage))
    raise AssertionError("unreachable: the last try raises or returns")


def gateway_failure(error: GenerationError) -> "Fallback":
    """The fallback a gateway failure leaves: the run's budget, or a line that never answered."""
    if isinstance(error, BudgetSpentError):
        return Fallback(BUDGET_SPENT, str(error))
    return Fallback(THROTTLED if error.transport else UNUSABLE, str(error))


@dataclass(frozen=True, slots=True)
class _BundleOutcome:
    bundle: CapsuleBundle | None
    usage: Usage | None
    failure: Fallback | None
    calls: int


def _bundle_once(
    facts: "PlayerFacts", requests: Sequence[SlotRequest], gateway: GatewayClient, worn: WornPhrases, note: str | None
) -> _BundleOutcome:
    prompt = bundle_prompt_for(facts, requests, worn)
    try:
        answer = ask(
            gateway, _msgs(facts, prompt if note is None else f"{prompt}\n\n{note}"), CAPSULE_CONFIG.bundle_max_tokens
        )
    except GenerationError as error:
        return _BundleOutcome(None, error.billed, gateway_failure(error), 1)
    bundle = parse_bundle(answer.content)
    failure = None if bundle is not None else Fallback("failed_validation", NOT_AN_OBJECT)
    return _BundleOutcome(bundle, answer.usage, failure, 1)


def _bundle(
    facts: "PlayerFacts", requests: Sequence[SlotRequest], gateway: GatewayClient, worn: WornPhrases
) -> _BundleOutcome:
    first = _bundle_once(facts, requests, gateway, worn, None)
    failure = first.failure
    if first.bundle is not None or (failure is not None and failure.kind in (THROTTLED, BUDGET_SPENT)):
        return first
    note = (
        "Your previous answer was not a single JSON object. Return exactly one JSON object with the three keys and nothing around it."
        if failure is not None and failure.first_violation == NOT_AN_OBJECT
        else "Your previous attempt did not complete. Answer again in full."
    )
    second = _bundle_once(facts, requests, gateway, worn, note)
    return replace(second, usage=add_usage(first.usage, second.usage), calls=first.calls + second.calls)


@dataclass(frozen=True, slots=True)
class _Read:
    """Where one read stands: its latest graded text, its attempts, its band misses and its cost."""

    text: str | None = None
    result: ValidationResult | None = None
    attempts: tuple[ReadAttempt, ...] = ()
    band_misses: tuple[int, ...] = ()
    corrections: int = 0
    calls: int = 0
    usage: Usage | None = None

    def graded(self, stage: str, text: str, result: ValidationResult, usage: Usage | None, calls: int) -> "_Read":
        return _Read(
            text,
            result,
            (*self.attempts, ReadAttempt(stage, word_count(text), text, result.violations)),
            self.band_misses if result.band_failure is None else (*self.band_misses, result.band_failure.words),
            self.corrections + (0 if stage in ("draft", "missing") else 1),
            self.calls + calls,
            add_usage(self.usage, usage),
        )

    @property
    def ok(self) -> bool:
        return self.result is not None and self.result.ok


def _start(facts: "PlayerFacts", size: str, drafted: str | None) -> _Read:
    return (
        _Read()
        if drafted is None
        else _Read().graded("draft", drafted, validate_capsule(drafted, facts, size), None, 0)
    )


def _asked_shorter(read: _Read, size: str) -> bool:
    """A length correction has asked this read for fewer words."""
    return any(words > CAPSULE_CONFIG.size(size).max_words for words in read.band_misses)


def _next_correction(read: _Read) -> PriorAttempt | None:
    if read.text is None or read.result is None:
        return PriorAttempt("", missing=True)
    ledger = notes_of([(attempt.body, attempt.violations) for attempt in read.attempts])
    failure = read.result.band_failure
    if failure is not None:
        if len(read.band_misses) == 1:
            return PriorAttempt(read.text, read.result.violations, length_correction=failure, ledger=ledger)
        if len(read.band_misses) == 2:  # noqa: PLR2004 - a second miss is answered by a fresh draft
            return PriorAttempt(
                read.text,
                read.result.violations,
                fresh_draft=FreshDraft(read.band_misses, failure.min_words, failure.max_words),
                ledger=ledger,
            )
        return None
    if read.corrections >= CAPSULE_CONFIG.corrections_per_read:
        return None
    soft = [soft_correction_for(v) for v in read.result.violations]
    corrections = tuple(c for c in soft if c is not None) if all(c is not None for c in soft) else None
    return PriorAttempt(read.text, read.result.violations, soft_corrections=corrections, ledger=ledger)


def _facts_block(facts: "PlayerFacts", read: _Read, fallback: Fallback) -> ReadResult:
    return ReadResult(render_facts_block(facts), FACTS_SOURCE, read.usage, fallback, read.attempts)


def _validation_fall(read: _Read) -> Fallback:
    failed = None if read.result is None else read.result.violations
    return Fallback("failed_validation", _NOT_WRITTEN if not failed else fallback_violation(failed))


def _retry_correction(read: _Read) -> PriorAttempt:
    """The retry writer's ask: the correction of the read's last draft with every rule it broke on any
    attempt (its length named when the band was missed), or the first ask when no draft was carried."""
    if read.text is None or read.result is None:
        return PriorAttempt("", missing=True)
    ledger = notes_of([(attempt.body, attempt.violations) for attempt in read.attempts])
    return PriorAttempt(read.text, read.result.violations, length_correction=read.result.band_failure, ledger=ledger)


def _retry_writer_read(facts: "PlayerFacts", size: str, read: _Read, retrier: GatewayClient) -> ReadResult:
    """One draft of the read the writer's asks could not write, asked of the retry writer (`retrier`, the
    same line, bucket and ledger) and validated as the writer's are: written as the retry writer's, else
    the facts block named for this last draft, or for the writer's own fall when the gateway refused it."""
    prior = _retry_correction(read)
    try:
        answer = ask(
            retrier, _msgs(facts, correction_prompt_for(facts, size, prior)), CAPSULE_CONFIG.size(size).max_tokens
        )
    except GenerationError as error:
        spent = replace(read, usage=add_usage(read.usage, error.billed))
        return replace(_facts_block(facts, spent, _validation_fall(read)), retry_asks=1)
    text = answer.content.strip()
    graded = read.graded(
        "retry", text, validate_capsule(text, facts, size, asked_shorter=_asked_shorter(read, size)), answer.usage, 0
    )
    if graded.ok:
        return ReadResult(text, "llm", graded.usage, None, graded.attempts, retry_asks=1)
    return replace(_facts_block(facts, graded, _validation_fall(graded)), retry_asks=1)


def _settle(  # noqa: PLR0913 - one read's parts
    facts: "PlayerFacts", size: str, read: _Read, budget: int, gateway: GatewayClient, *, retrier: GatewayClient | None
) -> tuple[ReadResult, int]:
    while True:
        if read.ok and read.text is not None:
            return ReadResult(read.text, "llm", read.usage, None, read.attempts), read.calls
        prior = _next_correction(read)
        if prior is None or read.calls >= budget:
            if retrier is not None:
                return _retry_writer_read(facts, size, read, retrier), read.calls
            return _facts_block(facts, read, _validation_fall(read)), read.calls
        try:
            answer = ask(
                gateway, _msgs(facts, correction_prompt_for(facts, size, prior)), CAPSULE_CONFIG.size(size).max_tokens
            )
        except GenerationError as error:
            spent = replace(read, usage=add_usage(read.usage, error.billed), calls=read.calls + 1)
            failure = gateway_failure(error)
            if failure.kind != UNUSABLE or not error.retryable:
                return _facts_block(facts, spent, failure), spent.calls
            # An empty or cut answer is an ask spent, never the read's end: ask again while asks remain
            # (a refused request, not retryable, would be refused again).
            read = spent
            continue
        text = answer.content.strip()
        result = validate_capsule(text, facts, size, asked_shorter=_asked_shorter(read, size))
        read = read.graded(prior.kind, text, result, answer.usage, 1)


def _rewrite_voice_slots(
    settled: NarrativeResult,
    facts: "PlayerFacts",
    requests: Sequence[SlotRequest],
    gateway: GatewayClient,
    calls_left: int,
) -> tuple[NarrativeResult, Usage | None, int]:
    narrative, usage, calls = settled, None, 0
    grounding = grounding_of(facts)
    by_key = {request.key: request for request in requests}
    for slot in [s for s in settled.refused if voice_rewritable(s)]:
        request = by_key.get(slot.key)
        current: RefusedSlot = slot
        attempt = 0
        while request is not None and attempt < CAPSULE_CONFIG.narrative_voice_rewrites_per_slot and calls < calls_left:
            attempt += 1
            calls += 1
            try:
                answer = ask(
                    gateway,
                    _msgs(facts, slot_rewrite_prompt(request, current)),
                    CAPSULE_CONFIG.bundle_max_tokens,
                    NARRATIVE_MIN_WORDS,
                )
            except GenerationError as error:
                usage = add_usage(usage, error.billed)
                break
            usage = add_usage(usage, answer.usage)
            text = answer.content.strip()
            result = validate_narrative_slot(text, grounding, request.max_words)
            if result.ok:
                narrative = with_rewritten_slot(narrative, slot.key, text, gateway.model)
                break
            current = RefusedSlot(slot.key, text, result.violations)
            if not voice_rewritable(current):
                break
    return narrative, usage, calls


def _one_kind(facts: "PlayerFacts", reads: tuple[ReadResult, ReadResult]) -> tuple[ReadResult, ReadResult]:
    """Both reads written, or both the facts block: a page is prose or a facts list, never half each."""
    if all(read.source == "llm" for read in reads):
        return reads
    block = render_facts_block(facts)
    compact, full = (replace(read, text=block, source=FACTS_SOURCE) for read in reads)
    return compact, full


def _assemble(  # noqa: PLR0913, PLR0917 - one page's parts
    reads: tuple[ReadResult, ReadResult],
    narrative: NarrativeResult,
    usage: Usage | None,
    model: str,
    calls: int,
    asks: int,
    retry_model: str | None = None,
) -> CapsuleResult:
    """The page: written when both reads are, its model the retry writer's when it wrote either one."""
    compact, full = reads
    both = compact.source == "llm" and full.source == "llm"
    total = add_usage(add_usage(usage, compact.usage), full.usage)
    rescued = retry_model is not None and any(read.rescued for read in reads)
    return CapsuleResult(
        compact,
        full,
        narrative,
        "llm" if both else FACTS_SOURCE,
        (retry_model if rescued else model) if both else None,
        total,
        calls,
        charged_asks(asks, reads),
        compact.retry_asks + full.retry_asks,
    )


def charged_asks(asks: int, reads: Sequence[ReadResult]) -> int:
    """The asks a generation is charged against the night's ceiling: its own, or the whole six when it
    ends in its facts block, whatever ended it (a throttle, the budget, a refused, empty or cut answer,
    a bundle that was never one JSON object, a read that never validated). A lost bundle is one or two
    asks, so a page could otherwise start up to seven ordinary generations a night; charged the six, it
    starts two and the grace, the ceiling's three drafts (review 73 item 5, re-review N1)."""
    lost = any(read.source == FACTS_SOURCE for read in reads)
    return max(asks, CAPSULE_CONFIG.max_gateway_calls_per_player) if lost else asks


def _note_dry_pool(gateway: GatewayClient, compact: ReadResult, full: ReadResult) -> None:
    """A page that fell to its facts block on a throttle once the run's pool ran dry is counted on it."""
    if gateway.waits.dry and any(r.fallback is not None and r.fallback.kind == THROTTLED for r in (compact, full)):
        gateway.waits.page_fell()


def describe_fallback(compact: ReadResult, full: ReadResult) -> str:
    """`describeCapsuleFallback`: one player's outcome in words an operator scans."""
    reasons = [r for r in (compact.fallback, full.fallback) if r is not None]
    if not reasons:
        return "llm"
    if any(r.kind == BUDGET_SPENT for r in reasons):
        return "facts (the run's budget is spent)"
    if any(r.kind == THROTTLED for r in reasons):
        return "facts (throttled)"
    if any(r.kind == UNUSABLE for r in reasons):
        return "facts (the gateway's answer was refused, empty or cut)"
    failed = next((r for r in reasons if r.kind == "failed_validation"), None)
    return "facts (fell back)" if failed is None else f"facts (failed validation: {failed.first_violation})"


def generate_capsule(
    facts: "PlayerFacts", gateway: GatewayClient, worn: WornPhrases = NO_WORN_PHRASES, *, retry_model: str | None = None
) -> CapsuleResult:
    """`generateCapsule`. `calls` is every HTTP call made for him, the retry writer's and retries included.
    A read the writer's asks could not write is asked once more of `retry_model` when one is named."""
    before = gateway.calls
    retrier = None if retry_model is None else gateway.with_model(retry_model)

    def made() -> int:
        return gateway.calls - before + (0 if retrier is None else retrier.calls)

    requests = narrative_requests_for(facts)
    outcome = _bundle(facts, requests, gateway, worn)
    if outcome.bundle is None:
        failure = outcome.failure or Fallback(THROTTLED)
        reason = (
            NOT_AN_OBJECT if failure.first_violation == NOT_AN_OBJECT else "the gateway never returned a usable answer"
        )
        floor = _facts_block(facts, _Read(), failure)
        _note_dry_pool(gateway, floor, floor)
        return _assemble(
            (floor, floor),
            failed_narrative(reason),
            outcome.usage,
            gateway.model,
            made(),
            outcome.calls,
        )
    remaining = CAPSULE_CONFIG.max_gateway_calls_per_player - outcome.calls
    full_start = _start(facts, "full", outcome.bundle.full)
    compact, compact_calls = _settle(
        facts,
        "compact",
        _start(facts, "compact", outcome.bundle.compact),
        remaining - (0 if full_start.ok else 1),
        gateway,
        retrier=retrier,
    )
    full, full_calls = _settle(facts, "full", full_start, remaining - compact_calls, gateway, retrier=retrier)
    settled = settle_narrative(outcome.bundle.narrative, facts, requests, gateway.model)
    left = CAPSULE_CONFIG.max_gateway_calls_per_player - outcome.calls - compact_calls - full_calls
    narrative, voice_usage, voice_calls = _rewrite_voice_slots(settled, facts, requests, gateway, left)
    _note_dry_pool(gateway, compact, full)
    return _assemble(
        _one_kind(facts, (compact, full)),
        narrative,
        add_usage(outcome.usage, voice_usage),
        gateway.model,
        made(),
        outcome.calls + compact_calls + full_calls + voice_calls,
        retry_model,
    )
