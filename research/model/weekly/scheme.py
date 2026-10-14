"""THE SCHEME LAYER: a team's tempo and pass lean, sizing the pie layer 1's shares are cut from.

Ported from `research-ts/src/projections/features/scheme.ts` and the scheme arm of
`model/context.ts` (`contextualiseOpportunity`). The other context features (line, game context,
red zone, target depth, in-season redistribution, news) are weekly-board features the preseason
board runs without (`PRESEASON_MODEL_FEATURES`); `contextualise_rates` refuses them by name rather
than pretending to apply them.
"""

import math
from collections.abc import Mapping
from dataclasses import dataclass, replace
from typing import Final

from research.model.jsmath import js_max, js_min, js_pow
from research.model.reads.observations import LAST_POSSIBLE_WEEK
from research.model.reads.teams import TeamContext, TeamMetricLookup, WeekRef, index_team_metrics
from research.model.weekly.opportunity import PredictedOpportunity
from research.model.weekly.teams import TeamsOf, oracle_latest_teams
from research.pipeline.nflverse.context import CoachMetric
from research.pipeline.nflverse.pbp import PbpMetric

SHRINKAGE_GAMES: Final = 3
PRIOR_SEASON_GAMES: Final = 6
CONTEXT_MULTIPLIER_MIN: Final = 0.8
CONTEXT_MULTIPLIER_MAX: Final = 1.25


@dataclass(frozen=True, slots=True)
class SchemeLeagueMeans:
    pace_seconds_per_play: float
    pass_rate: float
    pass_rate_over_expected: float


@dataclass(frozen=True, slots=True)
class SchemeVolumeElasticity:
    tempo: float
    pass_lean: float


@dataclass(frozen=True, slots=True)
class SchemePriors:
    league: SchemeLeagueMeans
    targets: SchemeVolumeElasticity
    carries: SchemeVolumeElasticity
    pass_attempts: SchemeVolumeElasticity


@dataclass(frozen=True, slots=True)
class FeatureFlags:
    line: bool
    scheme: bool
    redistribution: bool
    game_context: bool
    red_zone: bool
    target_depth: bool
    news: bool


PRESEASON_MODEL_FEATURES: Final = FeatureFlags(
    line=False, scheme=True, redistribution=False, game_context=False, red_zone=False, target_depth=False, news=False
)


def bounded(multiplier: float) -> float:
    """`bounded`: a context multiplier clamped to [0.8, 1.25]; a non-finite one is 1."""
    if not math.isfinite(multiplier):
        return 1.0
    return js_min(CONTEXT_MULTIPLIER_MAX, js_max(CONTEXT_MULTIPLIER_MIN, multiplier))


def _mean_over(weeks: list[WeekRef], read: "_Read") -> tuple[float | None, int]:
    total = 0.0
    games = 0
    for at in weeks:
        value = read(at)
        if value is None:
            continue
        total += value
        games += 1
    return (None if games == 0 else total / games), games


class _Read:
    def __init__(self, metrics: TeamMetricLookup, team: str, metric: str) -> None:
        self._metrics = metrics
        self._team = team
        self._metric = metric

    def __call__(self, at: WeekRef) -> float | None:
        return self._metrics(self._team, at, self._metric)


def _shrink(estimate: float | None, games: float, prior: float, k: float) -> float:
    if estimate is None or games <= 0:
        return prior
    return (games * estimate + k * prior) / (games + k)


@dataclass(frozen=True, slots=True)
class SchemeEstimate:
    pace_seconds_per_play: float | None
    pass_rate: float | None
    pass_rate_over_expected: float | None
    coaching_change: bool


def scheme_estimate(
    team: str, season: int, week: int, metrics: TeamMetricLookup, league: SchemeLeagueMeans
) -> SchemeEstimate:
    """`schemeEstimate`."""
    this_season = [WeekRef(season, index + 1) for index in range(max(0, week - 1))]
    prior_season = [WeekRef(season - 1, index + 1) for index in range(LAST_POSSIBLE_WEEK)]
    tenure = metrics(team, WeekRef(season, week), CoachMetric.TENURE_SEASONS)
    coaching_change = tenure is not None and tenure == 0

    def level(metric: str, coach_metric: str | None, league_mean: float) -> float | None:
        own_mean, own_games = _mean_over(prior_season, _Read(metrics, team, metric))
        coach_prior = None if coach_metric is None else metrics(team, WeekRef(season, week), coach_metric)
        if coaching_change:
            season_prior = league_mean if coach_prior is None else coach_prior
        else:
            season_prior = _shrink(own_mean, own_games, league_mean, PRIOR_SEASON_GAMES)
        form_mean, form_games = _mean_over(this_season, _Read(metrics, team, metric))
        if form_mean is None and own_mean is None and coach_prior is None:
            return None
        return _shrink(form_mean, form_games, season_prior, SHRINKAGE_GAMES)

    return SchemeEstimate(
        pace_seconds_per_play=level(
            PbpMetric.PACE_SECONDS_PER_PLAY, CoachMetric.PRIOR_PACE, league.pace_seconds_per_play
        ),
        pass_rate=level(PbpMetric.PASS_RATE, None, league.pass_rate),
        pass_rate_over_expected=level(
            PbpMetric.PASS_RATE_OVER_EXPECTED, CoachMetric.PRIOR_PASS_RATE_OVER_EXPECTED, league.pass_rate_over_expected
        ),
        coaching_change=coaching_change,
    )


def scheme_ratios(estimate: SchemeEstimate, league: SchemeLeagueMeans) -> tuple[float | None, float | None]:
    """`schemeRatios`: (tempo, pass lean)."""
    pace = estimate.pace_seconds_per_play
    tempo = None if pace is None or pace <= 0 else league.pace_seconds_per_play / pace
    lean = None if estimate.pass_rate is None or league.pass_rate <= 0 else estimate.pass_rate / league.pass_rate
    return tempo, lean


def _apply_elasticity(tempo: float, pass_lean: float, elasticity: SchemeVolumeElasticity) -> float:
    return bounded(js_pow(tempo, elasticity.tempo) * js_pow(pass_lean, elasticity.pass_lean))


@dataclass(frozen=True, slots=True)
class _Factors:
    targets: float
    carries: float
    pass_attempts: float


def contextualise_opportunity(  # noqa: PLR0913, PLR0917 - the oracle's own parameters, in its order, for a line-by-line read
    opportunity: Mapping[str, PredictedOpportunity],
    season: int,
    week: int,
    team_context: TeamContext,
    features: FeatureFlags,
    priors: SchemePriors,
    teams_of: TeamsOf = oracle_latest_teams,
) -> dict[str, PredictedOpportunity]:
    """`contextualiseOpportunity`: each player's team volume scaled by his club's scheme. The club
    is the oracle's `latestTeams` unless the caller names another rule (`weekly/teams.py`)."""
    if not features.scheme:
        return dict(opportunity)
    metrics = index_team_metrics(team_context)
    teams = teams_of(team_context)
    factors: dict[str, _Factors | None] = {}

    def factors_for(team: str) -> _Factors | None:
        if team in factors:
            return factors[team]
        tempo, lean = scheme_ratios(scheme_estimate(team, season, week, metrics, priors.league), priors.league)
        resolved = (
            None
            if tempo is None or lean is None or tempo <= 0 or lean <= 0
            else _Factors(
                _apply_elasticity(tempo, lean, priors.targets),
                _apply_elasticity(tempo, lean, priors.carries),
                _apply_elasticity(tempo, lean, priors.pass_attempts),
            )
        )
        factors[team] = resolved
        return resolved

    adjusted: dict[str, PredictedOpportunity] = {}
    for player_id, player in opportunity.items():
        team = teams.get(player_id)
        factor = None if team is None else factors_for(team)
        if factor is None:
            adjusted[player_id] = player
            continue
        adjusted[player_id] = replace(
            player,
            team_targets=player.team_targets * factor.targets,
            team_carries=player.team_carries * factor.carries,
            team_pass_attempts=player.team_pass_attempts * factor.pass_attempts,
        )
    return adjusted


def contextualise_rates(rates: dict[str, dict[str, float]], features: FeatureFlags) -> dict[str, dict[str, float]]:
    """`contextualiseRates` with every rate feature off returns the rates as they are, which is
    the only configuration the preseason board runs. The weekly board's rate features are not
    ported in this lane; asking for one is refused by name."""
    wanted = [name for name in ("line", "game_context", "red_zone", "target_depth") if getattr(features, name)]
    if wanted:
        raise NotImplementedError(
            f"the weekly rate features {wanted} are not ported; the preseason board runs without them"
        )
    return rates
