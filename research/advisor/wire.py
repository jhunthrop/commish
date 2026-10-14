"""THE ADVICE AS JSON, in the shape `research-ts/README.md` documents and `api/internal/advisor`
decodes (`wireResponse`): camelCase keys, every reason its `code` first."""

from dataclasses import fields
from typing import Any

from research.advisor.advise import Advice, AdvisedCandidate, PositionTier
from research.model.decide.reasons import PickReason
from research.model.domain import snake_to_camel


def reason_json(reason: PickReason) -> dict[str, Any]:
    out: dict[str, Any] = {"code": reason.code}
    for item in fields(reason):
        if item.name != "code":
            out[snake_to_camel(item.name)] = getattr(reason, item.name)
    return out


def _candidate_json(advised: AdvisedCandidate) -> dict[str, Any]:
    r = advised.recommendation
    return {
        "playerId": r.player_id,
        "position": r.position,
        "expectedValueAdded": r.expected_value_added,
        "valueOverReplacement": r.value_over_replacement,
        "rosterAdjustedValue": r.roster_adjusted_value,
        "survivalProbability": r.survival_probability,
        "reasons": [reason_json(reason) for reason in r.reasons],
        "why": advised.why,
        "contrast": advised.contrast,
    }


def _tier_json(tier: PositionTier) -> dict[str, Any]:
    return {"tier": tier.tier, "playerIds": list(tier.player_ids), "dropToNextTier": tier.drop_to_next_tier}


def advice_json(advice: Advice) -> dict[str, Any]:
    return {
        "pickNumber": advice.pick_number,
        "nextPickNumber": advice.next_pick_number,
        "shortlist": [_candidate_json(candidate) for candidate in advice.shortlist],
        "survival": advice.survival,
        "tiers": {position: [_tier_json(t) for t in tiers] for position, tiers in advice.tiers.items()},
        "basis": advice.basis,
    }
