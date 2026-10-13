"""THE MARKET BLEND: each modelled player re-anchored on the market's points, moved by the laws
and the availability gap the evidence admits, capped.

Ported from `research-ts/src/projections/market/{blend,availability-admission,thin-evidence-shrink,
props-anchor-artifact}.ts` (the applying half; the grid search is in `research.model.fits`).
"""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass, replace
from datetime import datetime
from typing import Any, Final

from research.model.domain import PPR_SCORING, STAT_FIELDS, Position, ScoringRules, StatLine, compute_fantasy_points
from research.model.instants import js_iso
from research.model.jsmath import js_max, js_min
from research.model.laws.registry import Law, cluster_key_for, pricing_eligible_law_ids
from research.model.market.curve import CURVE_POSITIONS, MarketPriorEntry
from research.model.preseason.availability import AvailabilityPriors, team_games_in
from research.model.preseason.board import scale_stat_line
from research.model.preseason.candidates import BoardCandidate, PreseasonPriors, Reason
from research.model.preseason.rookies import (
    RookieCurvePriors,
    RookieEvidenceKnot,
    historical_rookie_expected_games,
    rookie_curve,
    rookie_curve_evidence_n,
)

FULL_SEASON_GAMES: Final = 17
THIN_EVIDENCE_PRIOR_N: Final = 3
MINIMUM_LISTED_PER_POSITION: Final = 5


@dataclass(frozen=True, slots=True)
class BlendConstants:
    law_cap_points: float
    availability_cap_points: float
    total_cap_points: float
    implied_games_by_position: Mapping[str, float]
    market_tail_by_position: Mapping[str, float]
    law_cluster_dedup: bool | None = None
    player_law_cap_points: float | None = None
    props_anchor_weight: float | None = None
    availability_recency_decay: float | None = None


def parse_blend_constants(raw: Mapping[str, Any]) -> BlendConstants:
    return BlendConstants(
        law_cap_points=float(raw["lawCapPoints"]),
        availability_cap_points=float(raw["availabilityCapPoints"]),
        total_cap_points=float(raw["totalCapPoints"]),
        implied_games_by_position={k: float(v) for k, v in raw["impliedGamesByPosition"].items()},
        market_tail_by_position={k: float(v) for k, v in raw["marketTailByPosition"].items()},
        law_cluster_dedup=raw.get("lawClusterDedup"),
        player_law_cap_points=raw.get("playerLawCapPoints"),
        props_anchor_weight=raw.get("propsAnchorWeight"),
        availability_recency_decay=raw.get("availabilityRecencyDecay"),
    )


def with_props_anchor(base: BlendConstants, weight_payload: Mapping[str, Any]) -> BlendConstants:
    """`blendConstantsWithPropsAnchor`: the published weight merged on, or the base unchanged."""
    weight = weight_payload.get("weight")
    if weight is None:
        return base
    if not isinstance(weight, int | float) or not (0 <= weight <= 1):
        raise ValueError("props anchor: weight must be a finite number in [0, 1], or null.")
    return replace(base, props_anchor_weight=float(weight))


def with_availability_recency(priors: AvailabilityPriors, decay: float | None) -> AvailabilityPriors:
    """`withAvailabilityRecency`."""
    if decay is None:
        return priors
    if not (0 < decay <= 1):
        raise ValueError(f"availability.ts: recencyDecay must lie in (0, 1]; got {decay}.")
    return replace(priors, recency_decay=decay)


def blend_priors(priors: PreseasonPriors, constants: BlendConstants) -> PreseasonPriors:
    """`withBlendAvailabilityRecency`."""
    if constants.availability_recency_decay is None:
        return priors
    return replace(
        priors, availability=with_availability_recency(priors.availability, constants.availability_recency_decay)
    )


def clamp_abs(value: float, cap: float) -> float:
    """`clampAbs`."""
    return js_min(cap, js_max(-cap, value))


def shrink_toward_market(
    model_points: float, market_points: float | None, effective_n: float, prior_n: float = THIN_EVIDENCE_PRIOR_N
) -> float:
    """`shrinkTowardMarket`."""
    if market_points is None:
        return model_points
    weight = prior_n / (prior_n + js_max(0.0, effective_n))
    return model_points * (1 - weight) + market_points * weight


def season_points_of(candidate: BoardCandidate, rules: ScoringRules = PPR_SCORING) -> float:
    """`seasonPointsOf`."""
    return compute_fantasy_points(
        scale_stat_line(candidate.per_game, candidate.games.expected), candidate.position, rules
    )


def _points_only_per_game(candidate: BoardCandidate, season_points: float) -> StatLine:
    games = candidate.games.expected
    per_game_points = season_points / games if games > 0 else 0.0
    return StatLine(
        candidate.per_game.player_id,
        candidate.per_game.week,
        **dict.fromkeys(STAT_FIELDS, 0.0),
    ).with_values(receiving_yards=per_game_points / PPR_SCORING.points_per_receiving_yard)


def _format_ratio(candidate: BoardCandidate, rules: ScoringRules) -> float:
    ppr = season_points_of(candidate, PPR_SCORING)
    if ppr <= 0:
        return 1.0
    return season_points_of(candidate, rules) / ppr


@dataclass(frozen=True, slots=True)
class BlendContext:
    constants: BlendConstants
    train_effect_by_law_id: Mapping[str, float]
    pricing_eligible_ids: frozenset[str]
    cluster_key_by_law_id: Mapping[str, str]
    props_anchor: Mapping[str, float]
    rules: ScoringRules
    rookie_curve: RookieCurvePriors
    rookie_games_rate: Mapping[Position, Mapping[str, float]]
    rookie_evidence: Mapping[Position, tuple[RookieEvidenceKnot, ...]]


def _admit_availability(candidate: BoardCandidate, anchor_points: float, constants: BlendConstants) -> float:
    if candidate.position not in CURVE_POSITIONS:
        raise ValueError(f"no implied-games entry for position {candidate.position}")
    implied = constants.implied_games_by_position[candidate.position]
    gap = ((candidate.games.expected - implied) * anchor_points) / implied
    return clamp_abs(gap, constants.availability_cap_points)


def _admitted_delta(candidate: BoardCandidate, anchor_points: float, context: BlendContext) -> float:
    constants = context.constants
    exposure = candidate.games.expected / FULL_SEASON_GAMES
    dedup = constants.law_cluster_dedup is True
    strongest: dict[str, float] = {}
    law_total = 0.0
    for reason in candidate.reasons:
        if reason["code"] != "law":
            continue
        train_effect = context.train_effect_by_law_id.get(reason["lawId"])
        if train_effect is None:
            raise ValueError(
                f'market/blend.ts: "{reason["lawId"]}" fired a BoardReason but has no matching entry in evidence.laws'
            )
        if reason["lawId"] not in context.pricing_eligible_ids:
            continue
        delta = clamp_abs(train_effect * exposure, constants.law_cap_points)
        if not dedup:
            law_total += delta
            continue
        key = context.cluster_key_by_law_id.get(reason["lawId"]) or cluster_key_for(reason["lawId"])
        held = strongest.get(key)
        if held is None or abs(delta) > abs(held):
            strongest[key] = delta
    if dedup:
        for delta in strongest.values():
            law_total += delta
    if constants.player_law_cap_points is not None:
        law_total = clamp_abs(law_total, constants.player_law_cap_points)
    return clamp_abs(law_total + _admit_availability(candidate, anchor_points, constants), constants.total_cap_points)


def blend_context(  # noqa: PLR0913, PLR0917 - the oracle's own parameters, in its order, for a line-by-line read
    laws: Sequence[Law],
    constants: BlendConstants,
    props_anchor: Mapping[str, float],
    rules: ScoringRules,
    rookie_curve_priors: RookieCurvePriors,
    games_rate: Mapping[Position, Mapping[str, float]],
    evidence: Mapping[Position, tuple[RookieEvidenceKnot, ...]],
) -> BlendContext:
    """`blendContextOf`."""
    weight = constants.props_anchor_weight
    if weight is not None and not (0 <= weight <= 1):
        raise ValueError(f"market/blend.ts: propsAnchorWeight must lie in [0, 1]; got {weight}.")
    if constants.player_law_cap_points is not None and constants.player_law_cap_points < 0:
        raise ValueError("market/blend.ts: playerLawCapPoints must be a finite, non-negative number of points")
    return BlendContext(
        constants,
        {law.id: law.train_effect for law in laws},
        pricing_eligible_law_ids(laws),
        {law.id: cluster_key_for(law.id) for law in laws},
        props_anchor,
        rules,
        rookie_curve_priors,
        games_rate,
        evidence,
    )


def _anchor_points(player_id: str, market_points: float, context: BlendContext) -> float:
    weight = context.constants.props_anchor_weight or 0.0
    if weight == 0:
        return market_points
    props = context.props_anchor.get(player_id)
    if props is None:
        return market_points
    return market_points * (1 - weight) + props * weight


def _with(candidate: BoardCandidate, points: float, reason: Reason) -> BoardCandidate:
    return replace(candidate, per_game=_points_only_per_game(candidate, points), reasons=(*candidate.reasons, reason))


def blend_candidate(
    candidate: BoardCandidate, entry: MarketPriorEntry | None, context: BlendContext, season: int
) -> BoardCandidate:
    """`blendCandidate`."""
    if entry is None:
        raw = season_points_of(candidate, context.rules)
        if candidate.position not in CURVE_POSITIONS:
            raise ValueError(f"market/blend.ts: no market-tail entry for position {candidate.position}")
        capped = js_min(raw, context.constants.market_tail_by_position[candidate.position])
        return _with(candidate, capped, {"code": "market_unlisted"})
    rookie = next((reason for reason in candidate.reasons if reason["code"] == "rookie"), None)
    if rookie is not None and rookie["overallPick"] is not None:
        pick = rookie["overallPick"]
        historical = historical_rookie_expected_games(
            candidate.position, pick, team_games_in(season), context.rookie_games_rate
        )
        per_game_rate = (
            rookie_curve(candidate.position, pick, context.rookie_curve) / historical if historical > 0 else 0.0
        )
        model_points = per_game_rate * candidate.games.expected * _format_ratio(candidate, context.rules)
        evidence_n = rookie_curve_evidence_n(candidate.position, pick, context.rookie_evidence)
        rookie_points = shrink_toward_market(model_points, entry.market_points, evidence_n)
        return _with(
            candidate,
            rookie_points,
            {
                "code": "market_anchor",
                "marketPoints": entry.market_points,
                "delta": rookie_points - entry.market_points,
            },
        )
    anchor = _anchor_points(candidate.player_id, entry.market_points, context)
    delta = _admitted_delta(candidate, anchor, context)
    return _with(
        candidate, js_max(0.0, anchor + delta), {"code": "market_anchor", "marketPoints": anchor, "delta": delta}
    )


def blend_board(
    market: Sequence[MarketPriorEntry], model: Sequence[BoardCandidate], context: BlendContext, season: int
) -> list[BoardCandidate]:
    """`blendBoard`: every modelled candidate re-anchored, in the model's order."""
    by_player = {entry.player_id: entry for entry in market}
    return [blend_candidate(candidate, by_player.get(candidate.player_id), context, season) for candidate in model]


# The refusals are the oracle's sentences word for word, but for the module they point a reader to.
ADP_DOCSTRING: Final = "publishers.py's fetch_average_draft_position docstring"
REFUSAL_WORDING: Final = (("publishers.ts's fetchAverageDraftPosition docblock", ADP_DOCSTRING),)


class DegenerateMarketError(ValueError):
    """`assertLiveMarketCoverage`'s refusal: a live board whose market is too thin to anchor."""


def assert_live_market_coverage(
    season: int, moment: datetime, kind: str, candidates: Sequence[BoardCandidate], market: Sequence[MarketPriorEntry]
) -> None:
    """`assertLiveMarketCoverage`: a live board needs a market at every curved position it lists."""
    if kind != "live":
        return
    if not market:
        raise DegenerateMarketError(
            f"{season}'s LIVE board resolved ZERO listed market players at {js_iso(moment)}. "
            "Every candidate would fall back to the position tail cap, degenerately tying every player at a "
            "position to the identical value -- this board must not be persisted. The usual cause is the ADP "
            f"benchmark's own publication stamp sitting after the live moment ({ADP_DOCSTRING}): verify the "
            "benchmark is ingested AND visible at this moment before persisting again."
        )
    listed: dict[str, int] = {}
    for entry in market:
        listed[entry.position] = listed.get(entry.position, 0) + 1
    on_board = {candidate.position for candidate in candidates if candidate.position in CURVE_POSITIONS}
    thin = sorted(position for position in on_board if listed.get(position, 0) < MINIMUM_LISTED_PER_POSITION)
    if thin:
        named = ", ".join(f"{position} ({listed.get(position, 0)} listed)" for position in thin)
        raise DegenerateMarketError(
            f"{season}'s LIVE board resolves fewer than {MINIMUM_LISTED_PER_POSITION} listed market players at "
            f"{named} at {js_iso(moment)}. Every unlisted candidate at a position this thin would fall "
            "back to the SAME position tail cap, degenerately tying most or all of that position's own board rows "
            "-- this board must not be persisted. Verify the ADP benchmark is ingested AND visible at this moment "
            "for the named position(s) before persisting again."
        )
