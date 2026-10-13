"""`preseasonCandidates` (`preseason/source.ts`) and `gateCandidates` (`roster-status-gate.ts`):
each player on a week-one roster becomes a candidate with a per-game line, a games outlook and
the reasons a reader sees; then the roster gate drops the ones not on an active roster and caps
the ones on a reserve list."""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass, replace

from research.model.domain import Position, StatLine
from research.model.jsmath import js_max, js_min, js_sorted, locale_compare
from research.model.laws.discovery import CandidateLaw
from research.model.laws.registry import Law, law_reasons_for
from research.model.preseason.adjustments import apply_career_stage, experience_band_for
from research.model.preseason.availability import (
    AvailabilityInput,
    GamesPlayedOutlook,
    ProjectionDistribution,
    age_at_season,
    availability_designation_of,
    availability_status_for,
    expected_games_played,
    seventeen_games_for_everyone,
    team_games_in,
)
from research.model.preseason.candidates import (
    BOARD_WEEK,
    KDEF_POSITIONS,
    MINIMUM_ABSENCE_GAMES,
    BoardCandidate,
    PreseasonFeatures,
    PreseasonPriors,
    Reason,
    _availability_reason,
    _law_reason,
    _team_context,
    board_opportunity,
    incumbent_claims,
)
from research.model.preseason.inputs import PreseasonInputs
from research.model.preseason.rookies import (
    RookieFeatures,
    RookieInput,
    capital_game_rate,
    landing_multiplier,
    rookie_opportunity,
)
from research.model.preseason.roster_status import (
    CurrentRosterStatus,
    is_capped_roster_status,
    is_excluded_roster_status,
    roster_status_reason,
)
from research.model.reads.teams import WeekRef, index_team_metrics
from research.model.weekly.efficiency import compose_stat_line, predict_rates
from research.model.weekly.opportunity import PredictedOpportunity
from research.model.weekly.scheme import PRESEASON_MODEL_FEATURES, contextualise_rates
from research.pipeline.nflverse.context import CoachMetric
from research.pipeline.nflverse.players import projected_position


@dataclass(frozen=True, slots=True)
class _Context:
    inputs: PreseasonInputs
    features: PreseasonFeatures
    priors: PreseasonPriors
    rates: Mapping[str, Mapping[str, float]]
    laws: Sequence[Law]
    candidates: Mapping[str, CandidateLaw]
    tenure: Mapping[str, float | None]


def _games(
    ctx: _Context,
    player_id: str,
    position: Position,
    predicted: PredictedOpportunity,
    baseline: float | None,
    roster_row: object,
) -> GamesPlayedOutlook:
    inputs = ctx.inputs
    if not ctx.features.availability:
        return seventeen_games_for_everyone(inputs.season)
    current = None if inputs.current_status is None else inputs.current_status.get(player_id)
    history = tuple(
        record for records in inputs.availability.values() if (record := records.get(player_id)) is not None
    )
    return expected_games_played(
        AvailabilityInput(
            position=position,
            age=age_at_season(roster_row.birth_date, inputs.season),
            status=availability_status_for(None if current is None else current.kind, roster_row.status),
            designation=availability_designation_of(
                None if current is None else current.kind, None if current is None else current.detail
            ),
            projected_snap_share=predicted.snap_share,
            history=history,
            baseline_rate=baseline,
        ),
        inputs.season,
        ctx.priors.availability,
    )


def _emit(
    ctx: _Context,
    player_id: str,
    position: Position,
    team: str,
    predicted: PredictedOpportunity,
    reasons: list[Reason],
    baseline: float | None,
) -> BoardCandidate | None:
    inputs = ctx.inputs
    roster_row = next((row for row in inputs.roster if row.player_id == player_id), None)
    if roster_row is None or roster_row.status == "off_roster":
        return None
    rates = ctx.rates.get(player_id) or ctx.priors.efficiency.by_position[position]
    composed: StatLine = compose_stat_line(player_id, BOARD_WEEK, predicted, rates)
    per_game = (
        apply_career_stage(
            composed, position, experience_band_for(inputs.season, roster_row.draft_year), ctx.priors.career
        )
        if ctx.features.career_stage
        else composed
    )
    games = _games(ctx, player_id, position, predicted, baseline, roster_row)
    everything = list(reasons)
    if ctx.features.availability:
        everything.append(_availability_reason(games))
    if ctx.tenure.get(team) == 0:
        everything.append({"code": "new_play_caller", "team": team})
    law_facts = inputs.law_facts.get(player_id)
    discovery = inputs.discovery_facts.get(player_id)
    if law_facts is not None or discovery is not None:
        everything.extend(
            _law_reason(reason) for reason in law_reasons_for(position, law_facts, discovery, ctx.laws, ctx.candidates)
        )
    return BoardCandidate(player_id, position, team, per_game, games, tuple(everything))


def _veteran_reasons(move: object | None, delta: object | None) -> list[Reason]:
    reasons: list[Reason] = []
    source = getattr(move, "source_team", None)
    destination = getattr(move, "destination_team", None)
    if move is not None and source is not None and destination is not None and source != destination:
        reasons.append({"code": "changed_team", "from": source, "to": destination})
    if delta is not None:
        target = float(delta.target_share)
        carry = float(delta.carry_share)
        if abs(target) > 0 or abs(carry) > 0:
            if target + carry >= 0:
                reasons.append({"code": "offseason_share_gained", "targetShare": target, "carryShare": carry})
            else:
                reasons.append({"code": "offseason_share_lost", "targetShare": -target, "carryShare": -carry})
    return reasons


def preseason_candidates(
    inputs: PreseasonInputs,
    features: PreseasonFeatures,
    priors: PreseasonPriors,
    laws: Sequence[Law],
    candidates: Mapping[str, CandidateLaw],
) -> list[BoardCandidate]:
    """`preseasonCandidates`: veterans with usage, then the rookie class, sorted by id."""
    roster_by_player = {row.player_id: row for row in inputs.roster}
    board = board_opportunity(inputs, features, priors)
    rates = contextualise_rates(
        predict_rates(inputs.history, inputs.usage, inputs.season, BOARD_WEEK, inputs.positions, priors.efficiency),
        PRESEASON_MODEL_FEATURES,
    )
    lookup = index_team_metrics(_team_context(inputs))
    tenure: dict[str, float | None] = {}
    for row in inputs.roster:
        tenure.setdefault(row.team, lookup(row.team, WeekRef(inputs.season, BOARD_WEEK), CoachMetric.TENURE_SEASONS))
    ctx = _Context(inputs, features, priors, rates, laws, candidates, tenure)
    out: list[BoardCandidate] = []
    claims = incumbent_claims(inputs, board.opportunity)
    moves = {move.player_id: move for move in board.moves}
    for player_id, predicted in board.opportunity.items():
        position = inputs.positions.get(player_id)
        roster_row = roster_by_player.get(player_id)
        if position is None or roster_row is None or position in KDEF_POSITIONS:
            continue
        built = _emit(
            ctx,
            player_id,
            position,
            roster_row.team,
            predicted,
            _veteran_reasons(moves.get(player_id), board.deltas.get(player_id)),
            None,
        )
        if built is not None:
            out.append(built)
    if features.rookies:
        out.extend(_rookies(ctx, board.opportunity, claims))
    return js_sorted(out, lambda a, b: locale_compare(a.player_id, b.player_id))


def _rookies(
    ctx: _Context, opportunity: Mapping[str, PredictedOpportunity], claims: Mapping[str, float]
) -> list[BoardCandidate]:
    inputs = ctx.inputs
    rookie_features = RookieFeatures(ctx.features.rookie_landing, ctx.features.rookie_pick_curve)
    out: list[BoardCandidate] = []
    for row in inputs.roster:
        if row.status == "off_roster" or row.draft_year != inputs.season or row.player_id in opportunity:
            continue
        position = projected_position(row.position) or inputs.positions.get(row.player_id)
        if position is None or position in KDEF_POSITIONS:
            continue
        rookie = RookieInput(
            row.player_id, position, row.team, row.draft_pick, claims.get(f"{row.team}|{position}", 0.0)
        )
        landing = landing_multiplier(rookie, ctx.priors.rookies) if rookie_features.landing_spot else 1
        reason: Reason = {"code": "rookie", "overallPick": row.draft_pick, "landingMultiplier": landing}
        built = _emit(
            ctx,
            row.player_id,
            position,
            row.team,
            rookie_opportunity(rookie, ctx.priors.rookies, rookie_features, ctx.priors.rookie_curve),
            [reason],
            capital_game_rate(position, row.draft_pick, ctx.priors.rookies, rookie_features, ctx.priors.rookie_curve),
        )
        if built is not None:
            out.append(built)
    return out


def cap_games_outlook(games: GamesPlayedOutlook, cap: int) -> GamesPlayedOutlook:
    """`capGamesOutlook`: every season past the cap folded onto it."""
    effective = int(js_max(cap, games.distribution.floor))
    if games.expected <= effective and games.distribution.ceiling <= effective:
        return games
    tail = 0.0
    for mass in games.probabilities[effective:]:
        tail += mass
    probabilities = tuple(
        p if count < effective else (0.0 if count > effective else tail) for count, p in enumerate(games.probabilities)
    )
    expected = 0.0
    for count, probability in enumerate(probabilities):
        expected += probability * count
    team_games = len(probabilities) - 1
    floor, median, ceiling = (
        js_min(value, effective)
        for value in (games.distribution.floor, games.distribution.median, games.distribution.ceiling)
    )
    return GamesPlayedOutlook(
        expected,
        expected / team_games if team_games > 0 else 0,
        ProjectionDistribution(floor, median, ceiling),
        probabilities,
    )


@dataclass(frozen=True, slots=True)
class ExcludedCandidate:
    player_id: str
    position: Position
    team: str
    status: CurrentRosterStatus


def gate_candidates(
    candidates: Sequence[BoardCandidate], statuses: Mapping[str, CurrentRosterStatus], season: int
) -> tuple[list[BoardCandidate], list[ExcludedCandidate]]:
    """`gateCandidates`."""
    cap = team_games_in(season) - MINIMUM_ABSENCE_GAMES
    kept: list[BoardCandidate] = []
    excluded: list[ExcludedCandidate] = []
    for candidate in candidates:
        status = statuses.get(candidate.player_id)
        if status is not None and is_excluded_roster_status(status.kind):
            excluded.append(ExcludedCandidate(candidate.player_id, candidate.position, candidate.team, status))
            continue
        if status is None or not is_capped_roster_status(status.kind):
            kept.append(candidate)
            continue
        games = cap_games_outlook(candidate.games, cap)
        restated = tuple(
            _availability_reason(games) if reason["code"] == "availability" else reason for reason in candidate.reasons
        )
        kept.append(replace(candidate, games=games, reasons=(*restated, roster_status_reason(status))))
    return kept, excluded
