"""THE BOARD'S REASONS AS A CAPSULE'S EVIDENCE: law groups by net effect, then the facts.

Ported from `research-ts/src/capsules/outlook/groups.ts` (`groupReasons`), `projections/laws/
headline.ts` (`lawHeadline`) and `capsules/facts.ts` (`evidenceFrom`, `marketFrom`,
`availabilityFrom`). Laws that measure the same thing are one group, keyed by the quantity they
read; a group's net effect is its members' effects summed in the board's order; groups are ordered
by the size of that effect (a stable sort), then the non-law facts follow in the board's order.
Market anchor, scarcity and tier cliff are the verdict's, not evidence, and feed `Market`.
"""

from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from types import MappingProxyType
from typing import Any, Final

from research.capsules.facts.model import (
    Availability,
    ChangedTeamEvidence,
    EvidenceItem,
    LawEvidence,
    Market,
    MarketUnlistedEvidence,
    NewPlayCallerEvidence,
    RookieEvidence,
    ShareEvidence,
)
from research.model.jsmath import js_round, js_to_fixed
from research.model.laws.registry import Law
from research.pipeline.jscompat import js_string

Reason = Mapping[str, Any]

_VERDICT_ONLY_CODES: Final = frozenset({"market_anchor", "scarcity", "tier_cliff"})
# The reason codes deliberately not evidence: availability is its own field, the kicker and defense
# reasons never reach a capsule (it is written for skill players only), and the roster status is
# read off the board's own reason by the surfaces.
_NOT_EVIDENCE: Final = frozenset(
    {
        "availability",
        "kicker_no_history",
        "kicker_opportunity",
        "defense_no_history",
        "defense_takeaways",
        "roster_status",
    }
)
_TRIBAL_QUANTITY_ID: Final = MappingProxyType(
    {
        "rb_workload_cliff": "touches",
        "rb_age_curve": "age",
        "wr_target_competition": "tribal:bestTeammateTargetShare",
        "target_share_persistence": "targetShare",
        "td_regression": "tribal:touchdownPointsShareOverThreshold",
        "play_caller_fingerprint": "incomingCoachPriorPassRateOverExpected",
    }
)
_POINTS_PER_GAME_QUANTITY_ID: Final = "pointsPerGame"
_PERCENT: Final = 100


def _whole(value: float) -> str:
    return js_string(js_round(value))


_LAW_HEADLINES: Final[Mapping[str, Callable[[float], str]]] = MappingProxyType(
    {
        "rb_workload_cliff": lambda magnitude: f"{_whole(magnitude)} touches last season",
        "rb_age_curve": lambda magnitude: f"Age {_whole(magnitude)} season",
        "wr_target_competition": lambda magnitude: "Crowded target room",
        "target_share_persistence": lambda magnitude: f"{_whole(magnitude * _PERCENT)}% target share",
        "td_regression": lambda magnitude: f"{js_to_fixed(magnitude, 1)}x touchdown share",
        "play_caller_fingerprint": lambda magnitude: "New play caller",
    }
)


def _format_magnitude(unit: str, value: float) -> str:
    if unit == "whole":
        return _whole(value)
    if unit == "one_decimal":
        return js_to_fixed(value, 1)
    if unit == "two_decimal":
        return js_to_fixed(value, 2)
    return f"{js_to_fixed(value * _PERCENT, 1)}%"


def law_headline(law_id: str, magnitude: float, law: Law | None) -> str:
    """`lawHeadline`: the tribal law's own words, a discovered law's quantity, or its id as words."""
    build = _LAW_HEADLINES.get(law_id)
    if build is not None:
        return build(magnitude)
    if law is not None and law.primary_quantity_noun is not None and law.primary_quantity_unit is not None:
        value = _format_magnitude(law.primary_quantity_unit, magnitude)
        if law.primary_quantity_id == _POINTS_PER_GAME_QUANTITY_ID:
            return f"averaging {value} a game last season"
        noun = law.primary_quantity_noun
        return f"{noun} {value}" if law.primary_quantity_unit == "two_decimal" else f"{value} {noun}"
    words = law_id.replace("_", " ")
    return words[:1].upper() + words[1:]


@dataclass(frozen=True, slots=True)
class _LawGroup:
    key: str
    headline: str
    net_effect: float
    members: tuple[Reason, ...]


def _group_key(reason: Reason, law: Law | None) -> str:
    tribal = _TRIBAL_QUANTITY_ID.get(reason["lawId"])
    if tribal is not None:
        return tribal
    if law is not None and law.origin == "discovered" and law.primary_quantity_id is not None:
        return law.primary_quantity_id
    return str(reason["lawId"])


def _law_groups(reasons: Sequence[Reason], by_id: Mapping[str, Law]) -> list[_LawGroup]:
    by_key: dict[str, list[Reason]] = {}
    for reason in reasons:
        if reason["code"] == "law":
            by_key.setdefault(_group_key(reason, by_id.get(reason["lawId"])), []).append(reason)
    groups: list[_LawGroup] = []
    for key, members in by_key.items():
        ordered = sorted(members, key=lambda member: -abs(member["effect"]))
        source = next((m for m in ordered if m["lawId"] in _TRIBAL_QUANTITY_ID), ordered[0])
        net = 0.0
        for member in members:
            net += member["effect"]
        headline = law_headline(source["lawId"], source["magnitude"], by_id.get(source["lawId"]))
        groups.append(_LawGroup(key, headline, net, tuple(ordered)))
    return sorted(groups, key=lambda group: -abs(group.net_effect))


def _fact_item(reason: Reason) -> EvidenceItem | None:
    code = reason["code"]
    if code in ("offseason_share_gained", "offseason_share_lost"):
        return ShareEvidence(code, code, reason["targetShare"], reason["carryShare"])
    if code == "changed_team":
        return ChangedTeamEvidence("changed_team", code, reason["from"], reason["to"])
    if code == "new_play_caller":
        return NewPlayCallerEvidence("new_play_caller", code, reason["team"])
    if code == "rookie":
        return RookieEvidence("rookie", code, reason.get("overallPick"))
    if code == "market_unlisted":
        return MarketUnlistedEvidence("market_unlisted", code)
    if code in _NOT_EVIDENCE:
        return None
    raise ValueError(f"a board reason with code {code!r} has no evidence form")


def evidence_from(reasons: Sequence[Reason], laws: Sequence[Law]) -> tuple[EvidenceItem, ...]:
    """`evidenceFrom(groupReasons(reasons, laws))`."""
    by_id = {law.id: law for law in laws}
    items: list[EvidenceItem] = [
        LawEvidence("law", group.key, group.headline, group.net_effect, len(group.members))
        for group in _law_groups(reasons, by_id)
    ]
    for reason in reasons:
        if reason["code"] == "law" or reason["code"] in _VERDICT_ONLY_CODES:
            continue
        item = _fact_item(reason)
        if item is not None:
            items.append(item)
    return tuple(items)


def _first(reasons: Sequence[Reason], code: str) -> Reason | None:
    return next((reason for reason in reasons if reason["code"] == code), None)


def availability_from(reasons: Sequence[Reason]) -> Availability | None:
    reason = _first(reasons, "availability")
    if reason is None:
        return None
    return Availability(reason["expectedGames"], reason["floorGames"], reason["ceilingGames"])


def market_from(reasons: Sequence[Reason], adp: float | None, position_adp: str | None, board_rank: int) -> Market:
    """`marketFrom`: the market's numbers and the board's own verdict reasons."""
    scarcity = _first(reasons, "scarcity")
    cliff = _first(reasons, "tier_cliff")
    anchor = _first(reasons, "market_anchor")
    return Market(
        adp,
        position_adp,
        board_rank,
        None if scarcity is None else scarcity.get("positionRank"),
        None if scarcity is None else scarcity.get("replacementLevel"),
        None if cliff is None else cliff.get("playersLeftInTier"),
        None if cliff is None else cliff.get("dropToNextTier"),
        None if anchor is None else anchor.get("marketPoints"),
        None if anchor is None else anchor.get("delta"),
    )
