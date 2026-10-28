"""THE BAKE-OFF'S TALLIES: per model, what the reads came to, and how often their sentences repeat in shape.

Pure functions over the outcomes the run recorded (`ReadOutcome`), so they are tested without a gateway.

The shape-duplicate rate (the coordinator's ruling): each sentence of a written read is normalized, then
every player name, club name or club code and every number is replaced with a placeholder, by the one
`research.capsules.narrative.ShapeMasks` the week validator holds reads to (Lane 265). Among the sentences of
`MIN_SHAPE_WORDS` words or more (the validator's `shared_shape_min_words`), the rate is the share whose shape
appears on two or more players' reads.
"""

import math
import statistics
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Final

from research.capsules.config import CAPSULE_CONFIG
from research.capsules.narrative import ShapeMasks, sentences_verbatim
from research.capsules.store import WRITTEN_SOURCE

MIN_SHAPE_WORDS: Final = CAPSULE_CONFIG.shared_shape_min_words
TOP_SHAPES: Final = 10
_P95: Final = 0.95


@dataclass(frozen=True, slots=True)
class ReadOutcome:
    """One sheet's read by one writer, as the run recorded it."""

    model: str
    player_id: str
    name: str
    may_start: bool
    source: str
    fallback: str | None
    calls: int
    prompt_tokens: int
    completion_tokens: int
    cost_usd: float
    seconds: float
    drafts: int
    # Drafts that broke a validation rule (any rule but the judge's), and those that broke the shape rule.
    broken_drafts: int
    shape_broken_drafts: int
    # Drafts the judge read (may-not-start sheets only), and those it refused.
    judged: int
    judge_refused: int

    @property
    def written(self) -> bool:
        return self.source == WRITTEN_SOURCE


@dataclass(frozen=True, slots=True)
class ModelTally:
    model: str
    reads: int
    written: int
    facts_blocks: int
    budget_stopped: int
    written_rate: float
    facts_rate: float
    reads_with_a_break: int
    drafts: int
    broken_drafts: int
    shape_broken_drafts: int
    may_not_start: int
    may_not_start_written: int
    judged: int
    judge_passed: int
    judge_pass_rate: float | None
    mean_seconds: float
    p95_seconds: float
    mean_calls: float
    mean_prompt_tokens: float
    mean_completion_tokens: float
    cost_usd: float
    cost_per_read: float


def _rate(part: float, whole: int) -> float:
    return part / whole if whole else 0.0


def p95(values: Sequence[float]) -> float:
    """The nearest-rank 95th percentile; 0 for no values."""
    if not values:
        return 0.0
    ordered = sorted(values)
    return ordered[max(0, math.ceil(_P95 * len(ordered)) - 1)]


def tally(model: str, outcomes: Sequence[ReadOutcome], budget_stopped: int = 0) -> ModelTally:
    """`model`'s reads summed. A read the budget stopped is not an outcome: it is counted apart."""
    reads = len(outcomes)
    written = sum(o.written for o in outcomes)
    held = [o for o in outcomes if not o.may_start]
    judged = sum(o.judged for o in held)
    refused = sum(o.judge_refused for o in held)
    seconds = [o.seconds for o in outcomes]
    cost = sum(o.cost_usd for o in outcomes)
    return ModelTally(
        model=model,
        reads=reads,
        written=written,
        facts_blocks=reads - written,
        budget_stopped=budget_stopped,
        written_rate=_rate(written, reads),
        facts_rate=_rate(reads - written, reads),
        reads_with_a_break=sum(o.broken_drafts > 0 for o in outcomes),
        drafts=sum(o.drafts for o in outcomes),
        broken_drafts=sum(o.broken_drafts for o in outcomes),
        shape_broken_drafts=sum(o.shape_broken_drafts for o in outcomes),
        may_not_start=len(held),
        may_not_start_written=sum(o.written for o in held),
        judged=judged,
        judge_passed=judged - refused,
        judge_pass_rate=None if not judged else (judged - refused) / judged,
        mean_seconds=statistics.fmean(seconds) if seconds else 0.0,
        p95_seconds=p95(seconds),
        mean_calls=_rate(sum(o.calls for o in outcomes), reads),
        mean_prompt_tokens=_rate(sum(o.prompt_tokens for o in outcomes), reads),
        mean_completion_tokens=_rate(sum(o.completion_tokens for o in outcomes), reads),
        cost_usd=cost,
        cost_per_read=_rate(cost, reads),
    )


@dataclass(frozen=True, slots=True)
class ShapeTally:
    reads: int
    sentences: int
    duplicated: int
    rate: float
    # The most repeated shapes: (shape, the players carrying it), most carriers first.
    top: tuple[tuple[str, int], ...]


def shape_duplicates(reads: Mapping[str, str], masks: ShapeMasks, top: int = TOP_SHAPES) -> ShapeTally:
    """Over `reads` (player id to written text): the share of long sentences whose shape two players carry."""
    shaped: list[tuple[str, str]] = []
    for player_id, text in reads.items():
        for sentence in sentences_verbatim(text):
            shape = masks.shape(sentence)
            if len(shape.split()) >= MIN_SHAPE_WORDS:
                shaped.append((player_id, shape))
    carriers: dict[str, set[str]] = {}
    for player_id, shape in shaped:
        carriers.setdefault(shape, set()).add(player_id)
    duplicated = sum(len(carriers[shape]) > 1 for _, shape in shaped)
    repeated = sorted(
        ((shape, len(ids)) for shape, ids in carriers.items() if len(ids) > 1), key=lambda s: (-s[1], s[0])
    )
    return ShapeTally(len(reads), len(shaped), duplicated, _rate(duplicated, len(shaped)), tuple(repeated[:top]))


@dataclass(frozen=True, slots=True)
class JudgeAgreement:
    """Drafts read by two judges: `first` is the run's judge, `second` the other; a refusal is a yes."""

    drafts: int
    both_refused: int
    both_passed: int
    first_only_refused: int
    second_only_refused: int

    @property
    def first_pass_rate(self) -> float | None:
        return None if not self.drafts else (self.both_passed + self.second_only_refused) / self.drafts

    @property
    def second_pass_rate(self) -> float | None:
        return None if not self.drafts else (self.both_passed + self.first_only_refused) / self.drafts


def agreement(verdicts: Sequence[tuple[bool, bool]]) -> JudgeAgreement:
    """`verdicts` are (first refused, second refused), one a draft."""
    return JudgeAgreement(
        len(verdicts),
        sum(a and b for a, b in verdicts),
        sum(not a and not b for a, b in verdicts),
        sum(a and not b for a, b in verdicts),
        sum(b and not a for a, b in verdicts),
    )
