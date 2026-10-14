"""THE WEEKLY MODEL, ONE WEEK AT A TIME: opportunity, scheme, rates, game context, composed.

Ported from `research-ts/src/projections/model/source.ts` (`modelProjection`) with the oracle's
`SHIPPED_FEATURES`: scheme sizes each club's volume, layer 1's shares cut it, layer 2's rates are
moved by the game context, and layer 3 multiplies them into one predicted stat line per player. A
player is projected only when both layers hold an opinion of him, in layer 1's id order. The
redistribution and news passes were never shipped by the oracle and are refused by name.
"""

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any, Final

from research.model.domain import StatLine, snake_to_camel
from research.model.priors import parse_efficiency, parse_opportunity, parse_scheme
from research.model.weekly.efficiency import EfficiencyPriors, compose_stat_line, predict_rates
from research.model.weekly.game_context import ContextElasticity, GameContextPriors, contextualise_weekly_rates
from research.model.weekly.inputs import WeeklyInput
from research.model.weekly.opportunity import OpportunityPriors, PredictedOpportunity, predict_opportunity
from research.model.weekly.scheme import FeatureFlags, SchemePriors, contextualise_opportunity
from research.model.weekly.teams import TeamsOf, oracle_latest_teams

SHIPPED_FEATURES: Final = FeatureFlags(
    line=False, scheme=True, redistribution=False, game_context=True, red_zone=False, target_depth=False, news=False
)


@dataclass(frozen=True, slots=True)
class WeeklyPriors:
    opportunity: OpportunityPriors
    efficiency: EfficiencyPriors
    scheme: SchemePriors
    game_context: GameContextPriors


def parse_game_context(raw: Mapping[str, Any]) -> GameContextPriors:
    def pair(cell: Mapping[str, Any]) -> ContextElasticity:
        return ContextElasticity(float(cell["opponent"]), float(cell["rest"]))

    return GameContextPriors(
        passing=pair(raw["passing"]),
        rushing=pair(raw["rushing"]),
        league_passing_yards_per_attempt=float(raw["leaguePassingYardsPerAttempt"]),
        league_rushing_yards_per_carry=float(raw["leagueRushingYardsPerCarry"]),
    )


def weekly_priors_from(payload: Mapping[str, Any]) -> WeeklyPriors:
    """The four fitted groups the shipped model reads, from a `model/weekly-priors` payload."""
    context = payload["context"]
    return WeeklyPriors(
        opportunity=parse_opportunity(payload["opportunity"]),
        efficiency=parse_efficiency(payload["efficiency"]),
        scheme=parse_scheme(context["scheme"]),
        game_context=parse_game_context(context["gameContext"]),
    )


def weekly_priors_payload(priors: WeeklyPriors) -> dict[str, Any]:
    """The four groups in the oracle's JSON shape (camelCase, as `fitted.ts` and the fits print them)."""
    opportunity = priors.opportunity
    efficiency = priors.efficiency
    scheme = priors.scheme
    game = priors.game_context

    def elasticity(cell: Any) -> dict[str, float]:
        return {"tempo": cell.tempo, "passLean": cell.pass_lean}

    return {
        "opportunity": {
            "recencyDecay": opportunity.recency_decay,
            "byPosition": {
                position: {
                    "snapShare": role.snap_share,
                    "targetsPerSnap": role.targets_per_snap,
                    "carriesPerSnap": role.carries_per_snap,
                    "passAttemptsPerSnap": role.pass_attempts_per_snap,
                }
                for position, role in opportunity.by_position.items()
            },
            "shrinkage": {
                "season": opportunity.shrinkage.season,
                "inSeason": opportunity.shrinkage.in_season,
                "teamVolume": opportunity.shrinkage.team_volume,
            },
            "leagueTeamVolume": {
                "targets": opportunity.league_team_volume.targets,
                "carries": opportunity.league_team_volume.carries,
                "passAttempts": opportunity.league_team_volume.pass_attempts,
            },
        },
        "efficiency": {
            "byPosition": {
                position: {snake_to_camel(name): value for name, value in rates.items()}
                for position, rates in efficiency.by_position.items()
            },
            "regression": {snake_to_camel(name): value for name, value in efficiency.regression.items()},
        },
        "context": {
            "scheme": {
                "league": {
                    "paceSecondsPerPlay": scheme.league.pace_seconds_per_play,
                    "passRate": scheme.league.pass_rate,
                    "passRateOverExpected": scheme.league.pass_rate_over_expected,
                },
                "targets": elasticity(scheme.targets),
                "carries": elasticity(scheme.carries),
                "passAttempts": elasticity(scheme.pass_attempts),
            },
            "gameContext": {
                "passing": {"opponent": game.passing.opponent, "rest": game.passing.rest},
                "rushing": {"opponent": game.rushing.opponent, "rest": game.rushing.rest},
                "leaguePassingYardsPerAttempt": game.league_passing_yards_per_attempt,
                "leagueRushingYardsPerCarry": game.league_rushing_yards_per_carry,
            },
        },
    }


@dataclass(frozen=True, slots=True)
class WeeklyProjection:
    """One player's week: the predicted line, and the two layers it was multiplied from."""

    line: StatLine
    opportunity: PredictedOpportunity
    rates: Mapping[str, float]


def _refuse_unshipped(features: FeatureFlags) -> None:
    wanted = [name for name in ("redistribution", "news") if getattr(features, name)]
    if wanted:
        raise NotImplementedError(
            f"the weekly opportunity passes {wanted} are not ported; the oracle never shipped them"
        )


def project_week(
    data: WeeklyInput,
    priors: WeeklyPriors,
    features: FeatureFlags = SHIPPED_FEATURES,
    teams_of: TeamsOf = oracle_latest_teams,
) -> list[WeeklyProjection]:
    """`modelProjection`, keeping each player's two layers beside his line."""
    _refuse_unshipped(features)
    opportunity = contextualise_opportunity(
        predict_opportunity(data.usage, data.season, data.week, data.positions, priors.opportunity),
        data.season,
        data.week,
        data.team_context,
        features,
        priors.scheme,
        teams_of,
    )
    rates = contextualise_weekly_rates(
        predict_rates(
            data.history,
            data.usage,
            data.season,
            data.week,
            data.positions,
            priors.efficiency,
            data.first_roster_season,
        ),
        data.season,
        data.week,
        data.team_context,
        teams_of,
        features,
        priors.game_context,
    )
    projections: list[WeeklyProjection] = []
    for player_id, player in opportunity.items():
        player_rates = rates.get(player_id)
        if player_rates is None:
            continue
        projections.append(
            WeeklyProjection(compose_stat_line(player_id, data.week, player, player_rates), player, player_rates)
        )
    return projections
