"""THE VALIDATOR: the law's enforcement arm, one set of rules for both reads and every narrative slot.

Ported from `research-ts/src/capsules/validate.ts`. Every number and multi-word proper name must
trace to the sheet; the copy rules bind (no em-dash, no semicolon, no banned or betting word, no
rival product, no set phrase or aside, the size's word band); a "floor" beside a number must say it
comes from injury seasons; mixed evidence must cite its strongest downside. One rule is new for the
long read: it must print at least one of the page's own numbers word for word, the pull-figure gate
the nightly enforces (`pull_figures.py`), so a written read cannot fail the run's capsule gate.
Each violation is worded to be handed back to the writer, and the soft ones say what to fix.
"""

import re
from collections.abc import Sequence
from dataclasses import dataclass
from typing import TYPE_CHECKING, Final

from research.capsules.board_ranks import rank_claims_off_page
from research.capsules.config import CAPSULE_CONFIG
from research.capsules.facts.model import LawEvidence
from research.capsules.grounding import (
    extract_numbers,
    is_derived_from_ledger,
    is_loose_reading_of,
    is_name_grounded,
    prompt_numbers,
    proper_name_phrases,
    round_half_up,
)
from research.capsules.pull_figures import adp_figures_off_page, facts_page_numbers, pull_figures_of, renderings_of
from research.capsules.rank_basis import rank_basis_violation, ranks_without_basis
from research.capsules.render import render_facts_for_model
from research.capsules.season_voice import (
    SeasonClock,
    clock_of,
    missed_weeks_violation,
    names_missed_weeks,
    time_frame_hits,
)
from research.capsules.voice_rules import (
    BANNED_VOCABULARY,
    COMPETITOR_NAMES,
    COMPETITOR_NAMES_THAT_ARE_WORDS,
    COMPETITOR_PRODUCT_CUES,
    EM_DASH,
    IN_SEASON_REPLACEMENTS,
    SEMICOLON,
    TRADING_REPLACEMENTS,
    VoiceRuleHit,
    banned_term_pattern,
    mask_names,
    voice_rule_hits,
)
from research.pipeline.jscompat import js_string

if TYPE_CHECKING:
    from research.capsules.facts.build import PlayerFacts

NARRATIVE_MIN_WORDS: Final = 3
UNFRAMED_FLOOR_VIOLATION: Final = (
    'The text says "floor" beside a number without saying that the number comes from seasons shortened by injury.'
)
# The read must print one of the page's numbers exactly as the page prints it. The violation names
# the renderings that count, so the correction can hand them to the writer (phase D: a deep player's
# projection under ten points counts only to the tenth, which reads that wrote "about 6 points" kept
# missing within the six calls).
NO_PAGE_NUMBER_VIOLATION: Final = (
    "The long note never prints one of the page's own numbers exactly as the page prints them"
)


def no_page_number_violation(numbers: tuple[tuple[str, float], ...]) -> str:
    choices = "; ".join(f"{' or '.join(renderings_of(value))} ({label})" for label, value in numbers)
    return f"{NO_PAGE_NUMBER_VIOLATION}: {choices}."


_AVAILABILITY: Final = re.compile(
    r"injur|health|hurt|miss(?:es|ed|ing)?\s+(?:time|games?|weeks?|snaps?)|games?\s+(?:he\s+)?miss|availab|durab|absen|"
    r"sidelin|out for|stay(?:s|ing)? on the field|on the field for all",
    re.IGNORECASE,
)
_COST_CUE: Final = re.compile(r"\b(costs?|minus|down|shaves?)\b", re.IGNORECASE | re.ASCII)
_SENTENCE_SPLIT: Final = re.compile(r"(?<=[.!?])\s+")
_PRODUCT_CUE_AFTER: Final = re.compile(rf"^(?:['\u2019]s)?\s+(?:{'|'.join(COMPETITOR_PRODUCT_CUES)})\b", re.IGNORECASE)
_ON_BEFORE: Final = re.compile(r"\bon\s+$", re.IGNORECASE)
_SENTENCE_OPENERS: Final = re.compile(r"[\s\"'\u201c\u2018(]+$")


@dataclass(frozen=True, slots=True)
class BandFailure:
    words: int
    min_words: int
    max_words: int


@dataclass(frozen=True, slots=True)
class ValidationResult:
    ok: bool
    violations: tuple[str, ...]
    band_failure: BandFailure | None = None


@dataclass(frozen=True, slots=True)
class Grounding:
    """What a text is graded against: the ledgers, the rendered sheet, the downside, the page's numbers."""

    number_ledger: tuple[float, ...]
    name_ledger: tuple[str, ...]
    prompt_text: str
    tension: float | None
    page_numbers: tuple[tuple[str, float], ...]
    # The page's ADP (the run's, `facts.market_adp`): any ADP or pick a read states must be it.
    adp: float | None
    # His position code and the page's position and overall rank: any board rank a read states must be them.
    position: str
    position_rank: int | None
    board_rank: int | None
    # The run's day: in season or not, how far the season has gone, the weeks he played and missed.
    clock: SeasonClock


def word_count(text: str) -> int:
    return len(text.split())


def split_sentences(text: str) -> list[str]:
    return [sentence for sentence in _SENTENCE_SPLIT.split(text) if sentence.strip() != ""]


def banned_term_in(text: str) -> str | None:
    return next((term for term in BANNED_VOCABULARY if banned_term_pattern(term).search(text)), None)


def _quoted(phrases: tuple[str, ...]) -> str:
    return ", ".join(f'"{phrase}"' for phrase in phrases)


def _banned_term_violation(term: str, text: str, clock: SeasonClock) -> str:
    pattern = banned_term_pattern(term)
    sentence = next((s for s in split_sentences(text) if pattern.search(s)), text)
    replacement = (IN_SEASON_REPLACEMENTS if clock.in_season else TRADING_REPLACEMENTS).get(term)
    words = "fantasy" if clock.in_season else "drafting"
    remedy = (
        "Rewrite without it." if replacement is None else f"Say it in {words} words instead: {_quoted(replacement)}."
    )
    return f'The text uses the banned term "{term}" in the sentence "{sentence}". {remedy}'


def _at_sentence_start(text: str, index: int) -> bool:
    before = _SENTENCE_OPENERS.sub("", text[:index])
    return before == "" or before[-1] in ".!?"


def _is_product_reference(text: str, name: str) -> bool:
    for match in re.finditer(rf"\b{name}\b", text, re.IGNORECASE):
        if match.group(0)[0].isupper() and not _at_sentence_start(text, match.start()):
            return True
        if _PRODUCT_CUE_AFTER.search(text[match.end() :]) or _ON_BEFORE.search(text[: match.start()]):
            return True
    return False


def _competitor_in(text: str) -> str | None:
    lower = text.lower()
    for name in COMPETITOR_NAMES:
        if name in COMPETITOR_NAMES_THAT_ARE_WORDS:
            if _is_product_reference(text, name):
                return name
        elif name in lower:
            return name
    return None


def _unframed_floor(text: str) -> bool:
    sentences = [s for s in split_sentences(text) if re.search(r"\bfloor\b", s, re.IGNORECASE)]
    if not sentences or _AVAILABILITY.search(text):
        return False
    return any(re.search(r"\d", s) for s in sentences)


def strongest_negative_law_effect(facts: "PlayerFacts") -> float | None:
    threshold = CAPSULE_CONFIG.tension_threshold_points
    negatives = [
        item.net_effect_points
        for item in facts.evidence
        if isinstance(item, LawEvidence) and item.net_effect_points < 0 and abs(item.net_effect_points) >= threshold
    ]
    if not negatives:
        return None
    strongest = negatives[0]
    for effect in negatives:
        if abs(effect) > abs(strongest):
            strongest = effect
    return strongest


def _cites_tension(text: str, tension: float) -> bool:
    if any(is_derived_from_ledger(value, [tension], False) for _, value in extract_numbers(text)):
        return True
    magnitude = abs(tension)
    return any(
        _COST_CUE.search(s) and any(is_derived_from_ledger(abs(v), [magnitude]) for _, v in extract_numbers(s))
        for s in split_sentences(text)
    )


def grounding_of(facts: "PlayerFacts") -> Grounding:
    return Grounding(
        facts.number_ledger,
        facts.name_ledger,
        render_facts_for_model(facts),
        strongest_negative_law_effect(facts),
        facts_page_numbers(facts),
        facts.market.adp,
        facts.identity.position,
        facts.market.position_rank,
        facts.market.board_rank,
        clock_of(facts),
    )


def _voice_violation(hit: VoiceRuleHit, text: str) -> str:
    """The violation, naming the sentence that holds the hit as a whole word or phrase: a bare
    substring would name "between" for a "bet" elsewhere, and the rewrite would miss the hit."""
    whole = re.compile(rf"(?<![a-z0-9]){re.escape(hit.found.lower())}(?![a-z0-9])")
    sentence = hit.sentence or next(
        (s for s in split_sentences(text) if whole.search(s.replace("\u2019", "'").replace("\u2018", "'").lower())),
        text,
    )
    article = "an" if hit.rule.startswith("aside") else "a"
    return f'The text carries {article} {hit.rule}, "{hit.found}", in the sentence "{sentence}". Rewrite that sentence.'


def _copy_violations(text: str, names: Sequence[str], clock: SeasonClock) -> list[str]:
    violations = []
    if EM_DASH in text:
        violations.append("The text contains an em-dash. Rewrite without one.")
    if SEMICOLON in text:
        violations.append("The text contains a semicolon. Split it into two sentences instead.")
    term = banned_term_in(mask_names(text, names))
    if term is not None:
        violations.append(_banned_term_violation(term, text, clock))
    competitor = _competitor_in(text)
    if competitor is not None:
        violations.append(f'The text names a competitor product ("{competitor}"). Remove it.')
    # The time frame rules read the text as written: they hold no name-sized words, and the sentence a
    # hit names goes back to the writer as he wrote it.
    hits = [*voice_rule_hits(text, names), *time_frame_hits(text, clock)]
    violations += [_voice_violation(hit, text) for hit in hits]
    if _unframed_floor(text):
        violations.append(UNFRAMED_FLOOR_VIOLATION)
    return violations


def _grounding_violations(text: str, source: Grounding) -> list[str]:
    printed = prompt_numbers(source.prompt_text)
    ledger = [*source.number_ledger, *printed]
    violations = [
        f'The number "{raw}" does not trace to any supplied fact.'
        for raw, value in extract_numbers(text)
        if not is_derived_from_ledger(value, ledger) and not is_loose_reading_of(value, printed)
    ]
    violations += [
        f'The name "{phrase}" does not trace to any supplied fact.'
        for phrase in proper_name_phrases(text)
        if not is_name_grounded(phrase, source.name_ledger)
    ]
    return violations


def _validate(
    text: str, source: Grounding, band: tuple[int, int], *, tension: bool, page_number: bool
) -> ValidationResult:
    trimmed = text.strip()
    if trimmed == "":
        return ValidationResult(False, ("The completion was empty.",))
    words = word_count(trimmed)
    if not band[0] <= words <= band[1]:
        message = f"Word count {words} is outside the required {band[0]}-{band[1]} word band."
        return ValidationResult(False, (message,), BandFailure(words, band[0], band[1]))
    violations = [*_copy_violations(trimmed, source.name_ledger, source.clock), *_grounding_violations(trimmed, source)]
    if page_number and not names_missed_weeks(trimmed, source.clock):
        violations.append(missed_weeks_violation(source.clock))
    if tension and source.tension is not None and not _cites_tension(trimmed, source.tension):
        figure = js_string(round_half_up(source.tension, 1))
        violations.append(
            f"Mixed evidence: the strongest downside ({figure} pts/game) is never cited. It has to appear, with that number, before the call."
        )
    if page_number and not pull_figures_of(trimmed, source.page_numbers, 1):
        violations.append(no_page_number_violation(source.page_numbers))
    violations += [adp_figure_violation(claim, source.adp) for claim in adp_figures_off_page(trimmed, source.adp)]
    violations += [
        rank_violation(claim, source)
        for claim in rank_claims_off_page(trimmed, source.position, source.position_rank, source.board_rank)
    ]
    violations += [
        rank_basis_violation(claim) for claim in ranks_without_basis(trimmed, source.position, source.position_rank)
    ]
    return ValidationResult(not violations, tuple(violations))


RANK_VIOLATION: Final = "The text states a board rank that is not his rank on the page"


def rank_violation(claim: str, source: Grounding) -> str:
    ranks = [f"{source.position}{source.position_rank}"] if source.position_rank is not None else []
    ranks += [f"rank {source.board_rank} overall"] if source.board_rank is not None else []
    allowed = " and ".join(ranks) or "no board rank"
    return f'{RANK_VIOLATION}: "{claim}". His ranks on our board are {allowed}. Say exactly that, or no rank.'


ADP_FIGURE_VIOLATION: Final = "The text states an ADP or a pick that is not his ADP on the page"


def adp_figure_violation(claim: str, adp: float | None) -> str:
    if adp is None:
        return f'{ADP_FIGURE_VIOLATION}: "{claim}", and the page has no ADP for him. Say no ADP or pick at all.'
    choices = " or ".join(renderings_of(adp))
    return f'{ADP_FIGURE_VIOLATION}: "{claim}". His ADP is {choices}. Say exactly that, or say no ADP.'


def overrun_cap(max_words: int) -> int:
    """The word cap a read is held to once it has been asked for a shorter read."""
    return max_words + max_words * CAPSULE_CONFIG.overrun_percent_after_length_correction // 100


def validate_capsule(body: str, facts: "PlayerFacts", size: str, *, asked_shorter: bool = False) -> ValidationResult:
    """`validateCapsule`: one read at its size's band, with the tension mandate. A read already asked
    for a shorter version may run `overrun_percent_after_length_correction` over the cap."""
    band = CAPSULE_CONFIG.size(size)
    cap = overrun_cap(band.max_words) if asked_shorter else band.max_words
    return _validate(body, grounding_of(facts), (band.min_words, cap), tension=True, page_number=size == "full")


def validate_narrative_slot(body: str, source: Grounding, max_words: int) -> ValidationResult:
    """`validateNarrativeSlot`: the same grounding and copy rules, a tighter band, no tension mandate."""
    return _validate(body, source, (NARRATIVE_MIN_WORDS, max_words), tension=False, page_number=False)
