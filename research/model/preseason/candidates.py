"""BUILDING ONE SEASON'S BOARD CANDIDATES: layer 1 schemed, the offseason redistributed, the depth
chart applied, rates composed into a per-game line, career stage, availability, and the reasons.

Ported from `research-ts/src/projections/preseason/source.ts` (`boardOpportunity`,
`preseasonCandidates` and their helpers) and `roster-status-gate.ts` (`gateCandidates`).
"""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass, replace
from typing import Any, Final

from research.model.domain import Position, StatLine
from research.model.jsmath import js_max, js_min, js_sorted, locale_compare
from research.model.preseason.adjustments import (
    CareerPriors,
    DepthPriors,
    OffseasonMove,
    RosterPlayer,
    ShareDelta,
    apply_depth_chart,
    offseason_deltas,
)
from research.model.preseason.availability import (
    AvailabilityPriors,
    GamesPlayedOutlook,
)
from research.model.preseason.inputs import PreseasonInputs
from research.model.preseason.rookies import (
    RookieCurvePriors,
    RookiePriors,
)
from research.model.reads.teams import TeamContext
from research.model.weekly.efficiency import EfficiencyPriors
from research.model.weekly.opportunity import OpportunityPriors, PredictedOpportunity, predict_opportunity
from research.model.weekly.scheme import (
    PRESEASON_MODEL_FEATURES,
    SchemePriors,
    contextualise_opportunity,
)
from research.pipeline.observations import PlayerWeekTeam

BOARD_WEEK: Final = 1
KDEF_POSITIONS: Final = ("K", "DEF")
MINIMUM_ABSENCE_GAMES: Final = 4
Reason = dict[str, Any]


@dataclass(frozen=True, slots=True)
class PreseasonFeatures:
    availability: bool
    offseason: bool
    rookies: bool
    rookie_landing: bool
    rookie_pick_curve: bool
    depth_chart: bool
    career_stage: bool


SHIPPED_PRESEASON_FEATURES: Final = PreseasonFeatures(True, True, True, False, True, True, True)


@dataclass(frozen=True, slots=True)
class PreseasonPriors:
    """`PreseasonPriors`, with the model's three layers and the rookie curve the capital reads."""

    opportunity: OpportunityPriors
    efficiency: EfficiencyPriors
    scheme: SchemePriors
    absorption_rate: float
    availability: AvailabilityPriors
    rookies: RookiePriors
    rookie_curve: RookieCurvePriors
    depth: DepthPriors
    career: CareerPriors


@dataclass(frozen=True, slots=True)
class BoardCandidate:
    player_id: str
    position: Position
    team: str
    per_game: StatLine
    games: GamesPlayedOutlook
    reasons: tuple[Reason, ...]
    per_game_tier_points: float | None = None
    season_projection_error_variance: float | None = None


def _team_context(inputs: PreseasonInputs) -> TeamContext:
    teams = tuple(
        PlayerWeekTeam(inputs.season, BOARD_WEEK, row.player_id, row.team, row.as_of)
        for row in inputs.roster
        if row.status != "off_roster"
    )
    return TeamContext(teams, inputs.team_observations)


def _last_season_teams(teams: Sequence[PlayerWeekTeam], season: int) -> dict[str, str]:
    best: dict[str, tuple[int, int]] = {}
    out: dict[str, str] = {}
    for row in teams:
        if row.season >= season:
            continue
        known = best.get(row.player_id)
        if known is not None and (known[0] > row.season or (known[0] == row.season and known[1] >= row.week)):
            continue
        best[row.player_id] = (row.season, row.week)
        out[row.player_id] = row.team
    return out


def _prior_season_shares(inputs: PreseasonInputs) -> dict[str, tuple[float, float]]:
    totals: dict[str, list[float]] = {}
    for row in inputs.usage:
        if row.season != inputs.season - 1:
            continue
        running = totals.setdefault(row.player_id, [0.0, 0.0, 0.0, 0.0])
        running[0] += row.target_share or 0.0
        running[1] += row.carry_share or 0.0
        running[2] += row.snap_share or 0.0
        running[3] += 1
    return {player_id: (t[0] / t[3], t[1] / t[3]) for player_id, t in totals.items()}


def offseason_moves_from(inputs: PreseasonInputs) -> list[OffseasonMove]:
    """`offseasonMovesFrom`: everyone who moved, retired or arrived, sorted by id (localeCompare)."""
    origin = _last_season_teams(inputs.prior_player_teams, inputs.season)
    shares = _prior_season_shares(inputs)
    destination = {row.player_id: (None if row.status == "off_roster" else row.team) for row in inputs.roster}
    moves: list[OffseasonMove] = []
    seen: set[str] = set()
    for player_id in [*origin, *destination]:
        if player_id in seen:
            continue
        seen.add(player_id)
        position = inputs.positions.get(player_id)
        if position is None:
            continue
        target, carry = shares.get(player_id, (0.0, 0.0))
        moves.append(
            OffseasonMove(player_id, position, origin.get(player_id), destination.get(player_id), target, carry)
        )
    return js_sorted(moves, lambda a, b: locale_compare(a.player_id, b.player_id))


def _returning_rosters(
    inputs: PreseasonInputs, opportunity: Mapping[str, PredictedOpportunity]
) -> dict[str, list[RosterPlayer]]:
    by_team: dict[str, list[RosterPlayer]] = {}
    for row in inputs.roster:
        if row.status == "off_roster":
            continue
        position = inputs.positions.get(row.player_id)
        predicted = opportunity.get(row.player_id)
        if position is None or predicted is None:
            continue
        by_team.setdefault(row.team, []).append(RosterPlayer(row.player_id, position, predicted.snap_share, None))
    return by_team


def _apply_deltas(
    opportunity: Mapping[str, PredictedOpportunity], deltas: Mapping[str, ShareDelta]
) -> dict[str, PredictedOpportunity]:
    out: dict[str, PredictedOpportunity] = {}
    for player_id, player in opportunity.items():
        delta = deltas.get(player_id)
        out[player_id] = (
            player
            if delta is None
            else replace(
                player,
                target_share=js_min(1.0, js_max(0.0, player.target_share + delta.target_share)),
                carry_share=js_min(1.0, js_max(0.0, player.carry_share + delta.carry_share)),
            )
        )
    return out


def incumbent_claims(inputs: PreseasonInputs, opportunity: Mapping[str, PredictedOpportunity]) -> dict[str, float]:
    """`incumbentClaims`."""
    claims: dict[str, float] = {}
    for row in inputs.roster:
        if row.status == "off_roster":
            continue
        position = inputs.positions.get(row.player_id)
        predicted = opportunity.get(row.player_id)
        if position is None or predicted is None:
            continue
        key = f"{row.team}|{position}"
        claim = predicted.pass_attempt_share if position == "QB" else predicted.target_share + predicted.carry_share
        claims[key] = claims.get(key, 0.0) + claim
    return claims


@dataclass(frozen=True, slots=True)
class BoardOpportunity:
    opportunity: dict[str, PredictedOpportunity]
    moves: list[OffseasonMove]
    deltas: dict[str, ShareDelta]


def board_opportunity(
    inputs: PreseasonInputs, features: PreseasonFeatures, priors: PreseasonPriors
) -> BoardOpportunity:
    """`boardOpportunity`: scheme sizes the pie, the offseason decides who eats it, then the chart."""
    base = predict_opportunity(inputs.usage, inputs.season, BOARD_WEEK, inputs.positions, priors.opportunity)
    schemed = contextualise_opportunity(
        base, inputs.season, BOARD_WEEK, _team_context(inputs), PRESEASON_MODEL_FEATURES, priors.scheme
    )
    moves = offseason_moves_from(inputs)
    deltas = (
        offseason_deltas(moves, _returning_rosters(inputs, schemed), priors.absorption_rate)
        if features.offseason
        else {}
    )
    redistributed = _apply_deltas(schemed, deltas)
    opportunity = (
        apply_depth_chart(redistributed, inputs.depth_chart, inputs.positions, priors.depth)
        if features.depth_chart
        else redistributed
    )
    return BoardOpportunity(opportunity, moves, deltas)


def _availability_reason(games: GamesPlayedOutlook) -> Reason:
    return {
        "code": "availability",
        "expectedGames": games.expected,
        "floorGames": games.distribution.floor,
        "ceilingGames": games.distribution.ceiling,
    }


def _law_reason(reason: Any) -> Reason:
    return {"code": "law", "lawId": reason.law_id, "effect": reason.effect, "magnitude": reason.magnitude}
