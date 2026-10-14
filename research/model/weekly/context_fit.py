"""FITTING THE TWO SHIPPED CONTEXT GROUPS: the scheme's volume elasticities, and the game context's.

Ported from `research-ts/src/projections/model/scheme-fit.ts` (`fitSchemePriors`, against the
residual of layer 1's own team-volume prediction, two regressors at once) and `context-fit.ts`
(`fitGameContextPriors`, against the league-relative team rate, with `line-fit.ts`'s
`teamProduction`). The logs are V8's (`fdlibm.log`) in the arithmetic the caller names, every sum
a left fold in the oracle's order, every map filled in the oracle's insertion order.
"""

import math
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Final

from research.model.arithmetic import Arithmetic
from research.model.domain import Position
from research.model.fdlibm import log
from research.model.reads.observations import PlayerWeekUsage, SeasonStatLine
from research.model.reads.teams import TeamContext, WeekRef, index_team_metrics
from research.model.weekly.fit import assert_held_out
from research.model.weekly.game_context import ContextElasticity, GameContextPriors, game_context_for
from research.model.weekly.opportunity import OpportunityPriors, predict_opportunity
from research.model.weekly.scheme import (
    SchemeLeagueMeans,
    SchemePriors,
    SchemeVolumeElasticity,
    scheme_estimate,
    scheme_ratios,
)
from research.pipeline.nflverse.pbp import PbpMetric

_VOLUMES: Final = ("team_targets", "team_carries", "team_pass_attempts")


def _mean(values: Sequence[float]) -> float:
    if not values:
        return 0.0
    total = 0.0
    for value in values:
        total += value
    return total / len(values)


def fit_scheme_league_means(context: TeamContext, seasons: Sequence[int]) -> SchemeLeagueMeans:
    """`fitSchemeLeagueMeans`."""
    allowed = set(seasons)

    def of(metric: str) -> float:
        return _mean([row.value for row in context.team_observations if row.metric == metric and row.season in allowed])

    return SchemeLeagueMeans(
        of(PbpMetric.PACE_SECONDS_PER_PLAY), of(PbpMetric.PASS_RATE), of(PbpMetric.PASS_RATE_OVER_EXPECTED)
    )


@dataclass(frozen=True, slots=True)
class _Point:
    x: float
    y: float
    outcome: float
    weight: float


def _solve_two(points: Sequence[_Point]) -> tuple[float, float]:
    """`solveTwoVariable` / `solve`: weighted least squares through the origin on two regressors."""
    xx = xy = yy = xr = yr = 0.0
    for p in points:
        if not (math.isfinite(p.x) and math.isfinite(p.y) and math.isfinite(p.outcome)):
            continue
        xx += p.weight * p.x * p.x
        xy += p.weight * p.x * p.y
        yy += p.weight * p.y * p.y
        xr += p.weight * p.x * p.outcome
        yr += p.weight * p.y * p.outcome
    determinant = xx * yy - xy * xy
    if determinant == 0:
        return 0.0, 0.0
    return (xr * yy - yr * xy) / determinant, (yr * xx - xr * xy) / determinant


@dataclass(frozen=True, slots=True)
class SchemeFitInput:
    usage: Sequence[PlayerWeekUsage]
    positions: Mapping[str, Position]
    context: TeamContext
    opportunity: OpportunityPriors
    seasons: tuple[int, ...]
    held_out: tuple[int, ...] = ()


def _team_of(context: TeamContext) -> dict[str, str]:
    return {f"{edge.season}|{edge.week}|{edge.player_id}": edge.team for edge in context.player_teams}


def fit_scheme_priors(data: SchemeFitInput, arithmetic: Arithmetic) -> SchemePriors:
    """`fitSchemePriors`."""
    assert_held_out(data.seasons, data.held_out)
    fused = arithmetic.fused_multiply_add
    league = fit_scheme_league_means(data.context, data.seasons)
    metrics = index_team_metrics(data.context)
    team_of = _team_of(data.context)
    by_season: dict[int, list[PlayerWeekUsage]] = {}
    for row in data.usage:
        by_season.setdefault(row.season, []).append(row)
    points: dict[str, list[_Point]] = {name: [] for name in _VOLUMES}
    for season in sorted(data.seasons):
        this_season = by_season.get(season, [])
        history = [*by_season.get(season - 1, []), *this_season]
        for week in sorted({row.week for row in this_season}):
            predictions = predict_opportunity(history, season, week, data.positions, data.opportunity)
            by_team: dict[str, tuple[dict[str, list[float]], PlayerWeekUsage]] = {}
            for row in this_season:
                if row.week != week:
                    continue
                team = team_of.get(f"{season}|{week}|{row.player_id}")
                predicted = predictions.get(row.player_id)
                if team is None or predicted is None:
                    continue
                entry = by_team.setdefault(team, ({name: [] for name in _VOLUMES}, row))
                for name in _VOLUMES:
                    entry[0][name].append(getattr(predicted, name))
            for team, (predicted_by_volume, actual_row) in by_team.items():
                tempo, lean = scheme_ratios(scheme_estimate(team, season, week, metrics, league), league)
                if tempo is None or lean is None or tempo <= 0 or lean <= 0:
                    continue
                for name in _VOLUMES:
                    ordered = sorted(predicted_by_volume[name])
                    predicted_value = ordered[len(ordered) // 2] if ordered else 0.0
                    actual = getattr(actual_row, name)
                    if actual is None or predicted_value <= 0 or actual <= 0:
                        continue
                    points[name].append(
                        _Point(
                            log(tempo, fused=fused),
                            log(lean, fused=fused),
                            log(actual / predicted_value, fused=fused),
                            actual,
                        )
                    )

    def elasticity(name: str) -> SchemeVolumeElasticity:
        tempo, lean = _solve_two(points[name])
        return SchemeVolumeElasticity(tempo, lean)

    return SchemePriors(
        league, elasticity("team_targets"), elasticity("team_carries"), elasticity("team_pass_attempts")
    )


@dataclass(frozen=True, slots=True)
class _Production:
    season: int
    week: int
    team: str
    carries: float
    rushing_yards: float
    pass_attempts: float
    passing_yards: float


def team_production(
    usage: Sequence[PlayerWeekUsage], history: Sequence[SeasonStatLine], context: TeamContext, seasons: Sequence[int]
) -> list[_Production]:
    """`teamProduction` (`line-fit.ts`): each team-week's carries, attempts and the yards on them."""
    allowed = set(seasons)
    team_of = _team_of(context)
    lines = {f"{row.season}|{row.line.week}|{row.line.player_id}": row for row in history}
    totals: dict[str, list[float]] = {}
    keys: dict[str, tuple[int, int, str]] = {}
    for row in usage:
        if row.season not in allowed:
            continue
        player_key = f"{row.season}|{row.week}|{row.player_id}"
        team = team_of.get(player_key)
        line = lines.get(player_key)
        if team is None or line is None or row.carries is None or row.pass_attempts is None:
            continue
        key = f"{row.season}|{row.week}|{team}"
        if key not in totals:
            totals[key] = [0.0, 0.0, 0.0, 0.0]
            keys[key] = (row.season, row.week, team)
        running = totals[key]
        running[0] += row.carries
        running[1] += line.line.rushing_yards
        running[2] += row.pass_attempts
        running[3] += line.line.passing_yards
    return [_Production(*keys[key], *running) for key, running in totals.items()]


@dataclass(frozen=True, slots=True)
class GameContextFitInput:
    usage: Sequence[PlayerWeekUsage]
    history: Sequence[SeasonStatLine]
    context: TeamContext
    seasons: tuple[int, ...]
    held_out: tuple[int, ...] = ()


def fit_game_context_priors(data: GameContextFitInput, arithmetic: Arithmetic) -> GameContextPriors:
    """`fitGameContextPriors`."""
    assert_held_out(data.seasons, data.held_out)
    fused = arithmetic.fused_multiply_add
    metrics = index_team_metrics(data.context)
    production = team_production(data.usage, data.history, data.context, data.seasons)
    sums = [0.0, 0.0, 0.0, 0.0]
    for row in production:
        sums[0] += row.passing_yards
    for row in production:
        sums[1] += row.pass_attempts
    for row in production:
        sums[2] += row.rushing_yards
    for row in production:
        sums[3] += row.carries
    league_pass = sums[0] / max(1.0, sums[1])
    league_rush = sums[2] / max(1.0, sums[3])
    passing: list[_Point] = []
    rushing: list[_Point] = []
    for row in production:
        context = game_context_for(row.team, WeekRef(row.season, row.week), metrics)
        if context.rest_ratio is None or context.rest_ratio <= 0:
            continue
        rest = log(context.rest_ratio, fused=fused)
        opponent_pass = context.opponent_pass_defence
        if opponent_pass is not None and opponent_pass > 0 and row.pass_attempts > 0 and row.passing_yards > 0:
            outcome = log(row.passing_yards / row.pass_attempts / league_pass, fused=fused)
            passing.append(_Point(log(opponent_pass, fused=fused), rest, outcome, row.pass_attempts))
        opponent_rush = context.opponent_rush_defence
        if opponent_rush is not None and opponent_rush > 0 and row.carries > 0 and row.rushing_yards > 0:
            outcome = log(row.rushing_yards / row.carries / league_rush, fused=fused)
            rushing.append(_Point(log(opponent_rush, fused=fused), rest, outcome, row.carries))
    return GameContextPriors(
        passing=ContextElasticity(*_solve_two(passing)),
        rushing=ContextElasticity(*_solve_two(rushing)),
        league_passing_yards_per_attempt=league_pass,
        league_rushing_yards_per_carry=league_rush,
    )
