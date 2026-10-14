"""THE NARRATIVE SLOTS: one validated sentence per module on the player's page.

Ported from `research-ts/src/capsules/{narrative,narrative-slots}.ts`. Each slot is asked for with a
brief and a word cap, validated like a read (no tension mandate), and a slot refused only for its
voice is rewritten once within the player's call ceiling. The books slot and its absence slot are
gone with the sportsbook register (the prep-site ruling): the page's modules no longer carry one.
"""

import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field, replace
from typing import TYPE_CHECKING, Final

from research.capsules.config import CAPSULE_MODEL
from research.capsules.corrections import is_voice_rule_violation, voice_rule_correction_for
from research.capsules.facts.model import (
    ChangedTeamEvidence,
    EvidenceItem,
    LawEvidence,
    NewPlayCallerEvidence,
    RookieEvidence,
    ShareEvidence,
)
from research.capsules.validate import grounding_of, validate_narrative_slot
from research.capsules.voice_rules import in_fantasy_words

if TYPE_CHECKING:
    from research.capsules.facts.build import PlayerFacts

CALL_WORDS: Final = 30
MODULE_WORDS: Final = 40
_SENTENCES: Final = re.compile(r"(?<=[.!?])\s+")


def why_group_slot_key(group_key: str) -> str:
    return f"whyGroup:{group_key}"


def absence_slot_key(module: str) -> str:
    return f"absence:{module}"


def normalize_sentence(text: str) -> str:
    """`normalizeSentence`: lower case, punctuation folded, decimals kept."""
    lowered = re.sub(r"(?<!\d)\.(?!\d)", " ", text.lower())
    folded = re.sub(r"[^a-z0-9%. ]+", " ", lowered)
    return re.sub(r"\s+", " ", folded).strip()


def sentences_verbatim(text: str) -> list[str]:
    return [s.strip() for s in _SENTENCES.split(text) if normalize_sentence(s.strip()) != ""]


def sentences_of(text: str) -> list[str]:
    return [normalize_sentence(s) for s in sentences_verbatim(text)]


@dataclass(frozen=True, slots=True)
class SlotRequest:
    key: str
    max_words: int
    brief: str


@dataclass(frozen=True, slots=True)
class RefusedSlot:
    key: str
    text: str
    violations: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class NarrativeResult:
    slots: Mapping[str, str] = field(default_factory=dict)
    model: str | None = None
    rejected: tuple[str, ...] = ()
    refused: tuple[RefusedSlot, ...] = ()
    failure: str | None = None


def failed_narrative(failure: str) -> NarrativeResult:
    return NarrativeResult(failure=failure)


def voice_rewritable(slot: RefusedSlot) -> bool:
    return bool(slot.violations) and all(is_voice_rule_violation(v) for v in slot.violations)


def slot_rewrite_prompt(request: SlotRequest, slot: RefusedSlot) -> str:
    corrections = [c for c in (voice_rule_correction_for(v) for v in slot.violations) if c is not None]
    return "\n\n".join(
        [
            f"This is one sentence you wrote for the {request.key} module: {request.brief}",
            f'What you wrote: "{slot.text}"',
            *corrections,
            f"Keep every number and name it already has, stay under {request.max_words} words, and answer with the rewritten sentence alone, no quotes and nothing around it.",
        ]
    )


def with_rewritten_slot(result: NarrativeResult, key: str, text: str, model: str) -> NarrativeResult:
    refused = tuple(slot for slot in result.refused if slot.key != key)
    rejected = tuple(
        f"{slot.key}: {slot.violations[0] if slot.violations else 'unknown violation'}" for slot in refused
    )
    return replace(result, slots={**result.slots, key: text}, model=model, refused=refused, rejected=rejected)


def _label(item: EvidenceItem) -> str:
    if isinstance(item, LawEvidence):
        return in_fantasy_words(item.headline)
    if isinstance(item, ShareEvidence):
        return (
            "his role grew this offseason"
            if item.kind == "offseason_share_gained"
            else "his role shrank this offseason"
        )
    if isinstance(item, ChangedTeamEvidence):
        return f"he changed teams, {item.from_} to {item.to}"
    if isinstance(item, NewPlayCallerEvidence):
        return f"a new play caller at {item.team}"
    if isinstance(item, RookieEvidence):
        return "he is a rookie"
    return "he has no ADP on file"


def narrative_requests_for(facts: "PlayerFacts") -> list[SlotRequest]:
    """`narrativeRequestsFor`: the slots this player's page has something to say in."""
    requests = [
        SlotRequest(
            "call",
            CALL_WORDS,
            "The lead. One sentence a sharp analyst would open with about THIS player, the thing you would say first if a friend asked about him. Take a side.",
        )
    ]
    if facts.availability is not None:
        requests.append(
            SlotRequest(
                "perGame",
                MODULE_WORDS,
                "The games question, beside the per-game figure the page already shows. Say what his expected games mean for what he is worth, and never restate the rank itself.",
            )
        )
    if facts.trend is not None and facts.trend.points_per_game is not None and facts.trend.points_per_game.material:
        requests.append(
            SlotRequest(
                "trend",
                MODULE_WORDS,
                "What his year-over-year move actually was, and whether it changes your read. The page prints the two seasons and the delta, so say what they mean.",
            )
        )
    if facts.last_season_story is not None:
        requests.append(
            SlotRequest(
                "story",
                MODULE_WORDS,
                "Last season in one line, the shape of it rather than the totals the page already lists beside you.",
            )
        )
    else:
        requests.append(
            SlotRequest(
                absence_slot_key("story"),
                MODULE_WORDS,
                "There is no prior season on record for him. Say that plainly, in a way that tells the reader what it means for him rather than apologising for a gap.",
            )
        )
    if facts.usage is None:
        requests.append(
            SlotRequest(
                absence_slot_key("usage"),
                MODULE_WORDS,
                "His role last season was never tracked. Say that without dressing it up, and say what a reader should watch instead.",
            )
        )
    if facts.market.players_left_in_tier is not None and facts.market.drop_to_next_tier is not None:
        requests.append(
            SlotRequest(
                "tier",
                MODULE_WORDS,
                "Where he sits in his tier and what the drop behind him is worth"
                + (" to a drafter" if facts.season is None else " on a roster now")
                + ". Never call a small step a cliff.",
            )
        )
    for item in facts.evidence:
        requests.append(
            SlotRequest(
                why_group_slot_key(item.group_key),
                MODULE_WORDS,
                f'The evidence line for "{_label(item)}": why it moves his outlook, in the words you would use out loud.',
            )
        )
    return requests


def settle_narrative(
    raw: Mapping[str, object] | None, facts: "PlayerFacts", requests: Sequence[SlotRequest], model: str = CAPSULE_MODEL
) -> NarrativeResult:
    """`settleNarrative`: every requested slot validated, kept or refused with its violations."""
    if raw is None:
        return failed_narrative("the answer carried no narrative object")
    grounding = grounding_of(facts)
    slots: dict[str, str] = {}
    refused: list[RefusedSlot] = []
    for request in requests:
        value = raw.get(request.key)
        if not isinstance(value, str) or value.strip() == "":
            continue
        text = value.strip()
        result = validate_narrative_slot(text, grounding, request.max_words)
        if result.ok:
            slots[request.key] = text
        else:
            refused.append(RefusedSlot(request.key, text, result.violations))
    rejected = tuple(
        f"{slot.key}: {slot.violations[0] if slot.violations else 'unknown violation'}" for slot in refused
    )
    return NarrativeResult(slots, model if slots else None, rejected, tuple(refused), None)
