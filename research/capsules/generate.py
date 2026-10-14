"""ONE PLAYER'S CAPSULE: one bundle call, the rejection pass, and the facts block as the counted fallback.

Ported from `research-ts/src/capsules/generate.ts`. The bundle (both reads and the narrative) comes
from one call, retried once whole if it never came back or was not an object. Each read is then
validated; a read that fails gets the correction its failure calls for (a length correction, a
fresh draft after a second length miss, the soft points, or a rewrite), each a call, up to
`corrections_per_read` of them (the oracle stopped at one) and all within the player's ceiling
(`max_gateway_calls_per_player`, six; the oracle had four). Once a read has been asked for a shorter
version it may run 10% over its cap. Every correction quotes the exact banned phrases the read has
been caught with on any attempt. A read that still fails is the facts block (`facts_block`): his
numbers as labelled facts, no prose.
Narrative slots refused only for their voice get one rewrite each from what calls are left. Nothing
here raises for a gateway failure: the facts block is the answer, and the usage billed is kept.
"""

from collections.abc import Sequence
from dataclasses import dataclass, replace
from typing import TYPE_CHECKING, Final

from research.capsules.bundle import CapsuleBundle, parse_bundle
from research.capsules.config import CAPSULE_CONFIG
from research.capsules.corrections import banned_phrases_in, soft_correction_for
from research.capsules.facts_block import FACTS_SOURCE, render_facts_block
from research.capsules.gateway import GatewayClient, GenerationError, Usage, add_usage
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
from research.capsules.prompt import (
    NO_WORN_PHRASES,
    FreshDraft,
    PriorAttempt,
    WornPhrases,
    bundle_prompt_for,
    correction_prompt_for,
    writer_rules_for,
)
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


@dataclass(frozen=True, slots=True)
class CapsuleResult:
    compact: ReadResult
    full: ReadResult
    narrative: NarrativeResult
    source: str
    model: str | None
    usage: Usage | None
    calls: int


def _msgs(facts: "PlayerFacts", user: str) -> list[dict[str, str]]:
    """One request: the writer's rules in the voice of the run's day, then the user message."""
    return [{"role": "system", "content": writer_rules_for(facts)}, {"role": "user", "content": user}]


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
        answer = gateway.complete(
            _msgs(facts, prompt if note is None else f"{prompt}\n\n{note}"), CAPSULE_CONFIG.bundle_max_tokens
        )
    except GenerationError as error:
        return _BundleOutcome(None, error.billed, Fallback("throttled"), 1)
    bundle = parse_bundle(answer.content)
    failure = None if bundle is not None else Fallback("failed_validation", NOT_AN_OBJECT)
    return _BundleOutcome(bundle, answer.usage, failure, 1)


def _bundle(
    facts: "PlayerFacts", requests: Sequence[SlotRequest], gateway: GatewayClient, worn: WornPhrases
) -> _BundleOutcome:
    first = _bundle_once(facts, requests, gateway, worn, None)
    if first.bundle is not None:
        return first
    note = (
        "Your previous attempt did not complete. Answer again in full."
        if first.failure is not None and first.failure.kind == "throttled"
        else "Your previous answer was not a single JSON object. Return exactly one JSON object with the three keys and nothing around it."
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
    banned = banned_phrases_in([v for attempt in read.attempts for v in attempt.violations])
    failure = read.result.band_failure
    if failure is not None:
        if len(read.band_misses) == 1:
            return PriorAttempt(read.text, read.result.violations, length_correction=failure, banned_phrases=banned)
        if len(read.band_misses) == 2:  # noqa: PLR2004 - a second miss is answered by a fresh draft
            return PriorAttempt(
                read.text,
                read.result.violations,
                fresh_draft=FreshDraft(read.band_misses, failure.min_words, failure.max_words),
                banned_phrases=banned,
            )
        return None
    if read.corrections >= CAPSULE_CONFIG.corrections_per_read:
        return None
    soft = [soft_correction_for(v) for v in read.result.violations]
    corrections = tuple(c for c in soft if c is not None) if all(c is not None for c in soft) else None
    return PriorAttempt(read.text, read.result.violations, soft_corrections=corrections, banned_phrases=banned)


def _facts_block(facts: "PlayerFacts", read: _Read, fallback: Fallback) -> ReadResult:
    return ReadResult(render_facts_block(facts), FACTS_SOURCE, read.usage, fallback, read.attempts)


def _settle(
    facts: "PlayerFacts", size: str, read: _Read, budget: int, gateway: GatewayClient
) -> tuple[ReadResult, int]:
    while True:
        if read.ok and read.text is not None:
            return ReadResult(read.text, "llm", read.usage, None, read.attempts), read.calls
        prior = _next_correction(read)
        if prior is None or read.calls >= budget:
            first = _NOT_WRITTEN if read.result is None or not read.result.violations else read.result.violations[0]
            return _facts_block(facts, read, Fallback("failed_validation", first)), read.calls
        try:
            answer = gateway.complete(
                _msgs(facts, correction_prompt_for(facts, size, prior)), CAPSULE_CONFIG.size(size).max_tokens
            )
        except GenerationError as error:
            spent = replace(read, usage=add_usage(read.usage, error.billed))
            return _facts_block(facts, spent, Fallback("throttled")), read.calls + 1
        text = answer.content.strip()
        result = validate_capsule(text, facts, size, asked_shorter=_asked_shorter(read, size))
        read = read.graded(prior.kind, text, result, answer.usage, 1)


def _rewrite_voice_slots(
    settled: NarrativeResult,
    facts: "PlayerFacts",
    requests: Sequence[SlotRequest],
    gateway: GatewayClient,
    calls_left: int,
) -> tuple[NarrativeResult, Usage | None]:
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
                answer = gateway.complete(
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
    return narrative, usage


def _one_kind(facts: "PlayerFacts", reads: tuple[ReadResult, ReadResult]) -> tuple[ReadResult, ReadResult]:
    """Both reads written, or both the facts block: a page is prose or a facts list, never half each."""
    if all(read.source == "llm" for read in reads):
        return reads
    block = render_facts_block(facts)
    compact, full = (replace(read, text=block, source=FACTS_SOURCE) for read in reads)
    return compact, full


def _assemble(
    reads: tuple[ReadResult, ReadResult], narrative: NarrativeResult, usage: Usage | None, model: str, calls: int
) -> CapsuleResult:
    compact, full = reads
    both = compact.source == "llm" and full.source == "llm"
    total = add_usage(add_usage(usage, compact.usage), full.usage)
    return CapsuleResult(
        compact, full, narrative, "llm" if both else FACTS_SOURCE, model if both else None, total, calls
    )


def describe_fallback(compact: ReadResult, full: ReadResult) -> str:
    """`describeCapsuleFallback`: one player's outcome in words an operator scans."""
    reasons = [r for r in (compact.fallback, full.fallback) if r is not None]
    if not reasons:
        return "llm"
    if any(r.kind == "throttled" for r in reasons):
        return "facts (throttled)"
    failed = next((r for r in reasons if r.kind == "failed_validation"), None)
    return "facts (fell back)" if failed is None else f"facts (failed validation: {failed.first_violation})"


def generate_capsule(
    facts: "PlayerFacts", gateway: GatewayClient, worn: WornPhrases = NO_WORN_PHRASES
) -> CapsuleResult:
    """`generateCapsule`. `calls` is every HTTP call the gateway client made for him, retries included."""
    before = gateway.calls
    requests = narrative_requests_for(facts)
    outcome = _bundle(facts, requests, gateway, worn)
    if outcome.bundle is None:
        failure = outcome.failure or Fallback("throttled")
        reason = "the gateway never returned a usable answer" if failure.kind == "throttled" else NOT_AN_OBJECT
        floor = _facts_block(facts, _Read(), failure)
        return _assemble((floor, floor), failed_narrative(reason), outcome.usage, gateway.model, gateway.calls - before)
    remaining = CAPSULE_CONFIG.max_gateway_calls_per_player - outcome.calls
    full_start = _start(facts, "full", outcome.bundle.full)
    compact, compact_calls = _settle(
        facts,
        "compact",
        _start(facts, "compact", outcome.bundle.compact),
        remaining - (0 if full_start.ok else 1),
        gateway,
    )
    full, full_calls = _settle(facts, "full", full_start, remaining - compact_calls, gateway)
    settled = settle_narrative(outcome.bundle.narrative, facts, requests, gateway.model)
    left = CAPSULE_CONFIG.max_gateway_calls_per_player - outcome.calls - compact_calls - full_calls
    narrative, voice_usage = _rewrite_voice_slots(settled, facts, requests, gateway, left)
    return _assemble(
        _one_kind(facts, (compact, full)),
        narrative,
        add_usage(outcome.usage, voice_usage),
        gateway.model,
        gateway.calls - before,
    )
