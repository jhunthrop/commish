"""FITTING LAYERS 1 AND 2: the role priors, the searched shrinkage, and the regressed rates.

Ported from `research-ts/src/projections/model/fit.ts` (`fitOpportunityPriors`,
`fitEfficiencyPriors`). Role priors and league team volume are descriptive means of the fit
seasons; the recency decay and the two share shrinkages are searched over the oracle's grid against
next-week share RMSE; each rate's regression constant is a variance ratio. A fit pointed at a season
it is told is held out refuses before reading anything. Every sum is a left fold in the oracle's
order, so the chosen grid cell and every constant match the oracle bit for bit.
"""

import math
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from types import MappingProxyType
from typing import Final

from research.model.domain import POSITIONS, Position, StatLine
from research.model.jsmath import js_min
from research.model.reads.observations import PlayerWeekUsage, SeasonStatLine
from research.model.weekly.efficiency import RATE_NAMES, RATES, EfficiencyPriors, opportunities_for
from research.model.weekly.opportunity import (
    LeagueTeamVolume,
    OpportunityPriors,
    OpportunityShrinkage,
    RolePrior,
    predict_opportunity,
)
from research.pipeline.jscompat import js_string

SCORED_SHARES: Final = ("snap_share", "target_share", "carry_share", "pass_attempt_share")
DECAY_GRID: Final = (0.5, 0.6, 0.7, 0.8, 0.85, 0.9, 0.95, 1.0)
SEASON_SHRINKAGE_GRID: Final = (0.25, 0.5, 1.0, 2.0, 4.0, 6.0, 9.0, 14.0, 20.0)
IN_SEASON_SHRINKAGE_GRID: Final = (0.0, 0.1, 0.25, 0.5, 1.0, 2.0, 3.0, 5.0, 8.0, 12.0)
TEAM_VOLUME_SHRINKAGE: Final = 4.0
MIN_OPPORTUNITIES_FOR_SPREAD: Final = 25
MAX_REGRESSION: Final = 10_000.0


class HeldOutSeasonError(ValueError):
    """`assertHeldOut`: a fit pointed at a season it will be judged on."""


@dataclass(frozen=True, slots=True)
class FitInput:
    usage: Sequence[PlayerWeekUsage]
    positions: Mapping[str, Position]
    seasons: tuple[int, ...]
    held_out: tuple[int, ...] = ()
    history: Sequence[SeasonStatLine] = field(default=())


def assert_held_out(seasons: Sequence[int], held_out: Sequence[int]) -> None:
    overlap = [season for season in seasons if season in held_out]
    if overlap:
        plural = "s" if len(overlap) > 1 else ""
        raise HeldOutSeasonError(
            f"Season{plural} {', '.join(str(s) for s in overlap)} would be fitted on and then reported on. "
            "A parameter that has read the test set is not a parameter."
        )


def _mean(values: Sequence[float]) -> float:
    if not values:
        return 0.0
    total = 0.0
    for value in values:
        total += value
    return total / len(values)


def fit_role_priors(data: FitInput) -> dict[Position, RolePrior]:
    """`fitRolePriors`."""
    allowed = set(data.seasons)
    by_position: dict[Position, list[PlayerWeekUsage]] = {}
    for row in data.usage:
        position = data.positions.get(row.player_id)
        if row.season not in allowed or position is None:
            continue
        by_position.setdefault(position, []).append(row)
    priors: dict[Position, RolePrior] = {}
    for position in POSITIONS:
        rows = [row for row in by_position.get(position, []) if row.snap_share is not None]
        if not rows:
            priors[position] = RolePrior(0.0, 0.0, 0.0, 0.0)
            continue
        snaps = [row.snap_share for row in rows if row.snap_share is not None]
        total_snap = 0.0
        for value in snaps:
            total_snap += value

        def slope(name: str, rows: list[PlayerWeekUsage] = rows, total: float = total_snap) -> float:
            if total == 0:
                return 0.0
            running = 0.0
            for row in rows:
                value = getattr(row, name)
                running += 0.0 if value is None else value
            return running / total

        priors[position] = RolePrior(
            _mean(snaps), slope("target_share"), slope("carry_share"), slope("pass_attempt_share")
        )
    return priors


def fit_league_team_volume(data: FitInput) -> LeagueTeamVolume:
    """`fitLeagueTeamVolume`: one row per distinct team-week, keyed as the oracle keys it."""
    allowed = set(data.seasons)
    team_weeks: dict[str, tuple[float, float, float]] = {}
    for row in data.usage:
        if row.season not in allowed:
            continue
        if row.team_targets is None or row.team_carries is None or row.team_pass_attempts is None:
            continue
        if row.team_targets == 0 and row.team_carries == 0:
            continue
        key = f"{row.season}|{row.week}|{js_string(row.team_targets)}|{js_string(row.team_carries)}|{js_string(row.team_pass_attempts)}"
        team_weeks[key] = (row.team_targets, row.team_carries, row.team_pass_attempts)
    rows = list(team_weeks.values())
    return LeagueTeamVolume(_mean([r[0] for r in rows]), _mean([r[1] for r in rows]), _mean([r[2] for r in rows]))


def opportunity_residuals(data: FitInput, priors: OpportunityPriors) -> list[tuple[float, float]]:
    """`opportunityObservations`: (predicted, actual) for every scored share, in the oracle's order."""
    by_season: dict[int, list[PlayerWeekUsage]] = {}
    for row in data.usage:
        by_season.setdefault(row.season, []).append(row)
    observations: list[tuple[float, float]] = []
    for season in sorted(set(data.seasons)):
        this_season = by_season.get(season, [])
        history = [*by_season.get(season - 1, []), *this_season]
        for week in sorted({row.week for row in this_season}):
            predictions = predict_opportunity(history, season, week, data.positions, priors)
            for actual in this_season:
                if actual.week != week:
                    continue
                predicted = predictions.get(actual.player_id)
                if predicted is None:
                    continue
                for name in SCORED_SHARES:
                    observed = getattr(actual, name)
                    if observed is not None:
                        observations.append((getattr(predicted, name), observed))
    return observations


def root_mean_squared_error(observations: Sequence[tuple[float, float]]) -> float | None:
    """`rootMeanSquaredError`."""
    if not observations:
        return None
    total = 0.0
    for predicted, actual in observations:
        if not (math.isfinite(predicted) and math.isfinite(actual)):
            raise ValueError("A projection metric received a non-finite value.")
        difference = predicted - actual
        total += difference * difference
    return math.sqrt(total / len(observations))


@dataclass(frozen=True, slots=True)
class OpportunityFit:
    priors: OpportunityPriors
    rmse: float
    sample_size: int


def fit_opportunity_priors(data: FitInput) -> OpportunityFit:
    """`fitOpportunityPriors`: the descriptive priors, then the grid in the oracle's loop order."""
    if not data.seasons:
        raise ValueError("An opportunity fit needs at least one season; it cannot be fitted on nothing.")
    assert_held_out(data.seasons, data.held_out)
    roles = MappingProxyType(fit_role_priors(data))
    volume = fit_league_team_volume(data)
    best: OpportunityPriors | None = None
    best_error = math.inf
    for decay in DECAY_GRID:
        for season in SEASON_SHRINKAGE_GRID:
            for in_season in IN_SEASON_SHRINKAGE_GRID:
                candidate = OpportunityPriors(
                    decay, roles, OpportunityShrinkage(season, in_season, TEAM_VOLUME_SHRINKAGE), volume
                )
                error = root_mean_squared_error(opportunity_residuals(data, candidate))
                error = math.inf if error is None else error
                if error < best_error:
                    best_error = error
                    best = candidate
    if best is None:
        raise ValueError("no grid cell produced a finite share error; the fit seasons hold no usage")
    return OpportunityFit(best, best_error, len(opportunity_residuals(data, best)))


@dataclass(frozen=True, slots=True)
class _RateWeek:
    player_id: str
    position: Position
    opportunities: float
    rate: float


def _rate_weeks(data: FitInput, name: str) -> list[_RateWeek]:
    allowed = set(data.seasons)
    lines: dict[str, StatLine] = {}
    for stat in data.history:
        if stat.season in allowed:
            lines[f"{stat.season}|{stat.line.week}|{stat.line.player_id}"] = stat.line
    numerator, denominator = RATES[name]
    weeks: list[_RateWeek] = []
    for row in data.usage:
        if row.season not in allowed:
            continue
        line = lines.get(f"{row.season}|{row.week}|{row.player_id}")
        position = data.positions.get(row.player_id)
        if line is None or position is None:
            continue
        opportunities = opportunities_for(row, denominator)
        if opportunities is None or opportunities <= 0:
            continue
        weeks.append(_RateWeek(row.player_id, position, opportunities, getattr(line, numerator) / opportunities))
    return weeks


@dataclass(frozen=True, slots=True)
class _PlayerRate:
    position: Position
    opportunities: float
    rate: float
    weeks: tuple[_RateWeek, ...]


def _by_player(weeks: Sequence[_RateWeek]) -> list[_PlayerRate]:
    grouped: dict[str, list[_RateWeek]] = {}
    for week in weeks:
        grouped.setdefault(week.player_id, []).append(week)
    players: list[_PlayerRate] = []
    for player_weeks in grouped.values():
        opportunities = 0.0
        numerator = 0.0
        for week in player_weeks:
            opportunities += week.opportunities
        for week in player_weeks:
            numerator += week.rate * week.opportunities
        players.append(
            _PlayerRate(player_weeks[0].position, opportunities, numerator / opportunities, tuple(player_weeks))
        )
    return players


def _sampling_variance(players: Sequence[_PlayerRate]) -> float | None:
    within = 0.0
    degrees = 0
    for player in players:
        if len(player.weeks) < 2:  # noqa: PLR2004 - a spread needs two weeks
            continue
        for week in player.weeks:
            difference = week.rate - player.rate
            within += week.opportunities * (difference * difference)
        degrees += len(player.weeks) - 1
    return None if degrees == 0 else within / degrees


def fit_regression_constant(data: FitInput, name: str) -> float:
    """`fitRegressionConstant`: sampling variance over true variance, capped."""
    players = _by_player(_rate_weeks(data, name))
    sampling = _sampling_variance(players)
    if sampling is None:
        return MAX_REGRESSION
    established = [player for player in players if player.opportunities >= MIN_OPPORTUNITIES_FOR_SPREAD]
    if len(established) < 2:  # noqa: PLR2004 - a spread needs two players
        return MAX_REGRESSION
    by_position: dict[Position, list[_PlayerRate]] = {}
    for player in established:
        by_position.setdefault(player.position, []).append(player)
    spread = 0.0
    count = 0
    inverse = 0.0
    for group in by_position.values():
        if len(group) < 2:  # noqa: PLR2004 - a spread needs two players
            continue
        group_mean = _mean([player.rate for player in group])
        for player in group:
            difference = player.rate - group_mean
            spread += difference * difference
            inverse += 1 / player.opportunities
            count += 1
    if count < 2:  # noqa: PLR2004 - a spread needs two players
        return MAX_REGRESSION
    true_variance = spread / count - (sampling * inverse) / count
    if true_variance <= 0:
        return MAX_REGRESSION
    return js_min(MAX_REGRESSION, sampling / true_variance)


def fit_efficiency_priors(data: FitInput) -> EfficiencyPriors:
    """`fitEfficiencyPriors`: each position's pooled rate, and each rate's regression constant."""
    assert_held_out(data.seasons, data.held_out)
    by_position: dict[Position, Mapping[str, float]] = {}
    weeks_by_rate = {name: _rate_weeks(data, name) for name in RATE_NAMES}
    for position in POSITIONS:
        rates: dict[str, float] = {}
        for name in RATE_NAMES:
            weeks = [week for week in weeks_by_rate[name] if week.position == position]
            opportunities = 0.0
            numerator = 0.0
            for week in weeks:
                opportunities += week.opportunities
            for week in weeks:
                numerator += week.rate * week.opportunities
            rates[name] = 0.0 if opportunities == 0 else numerator / opportunities
        by_position[position] = MappingProxyType(rates)
    regression = {name: fit_regression_constant(data, name) for name in RATE_NAMES}
    return EfficiencyPriors(MappingProxyType(by_position), MappingProxyType(regression))
