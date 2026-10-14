"""THE GAME-CONTEXT LAYER: this week's opponent and rest, as bounded multipliers on layer 2's rates.

Ported from `research-ts/src/projections/features/context.ts` (`gameContextFor`) and the rate arm
of `model/context.ts` (`contextualiseRates`). The oracle ships two context groups on its weekly
model (`SHIPPED_FEATURES`: scheme and game context); scheme sizes the pie in `scheme.py`, and this
moves the yards per carry and per dropback by the opponent's defence, adjusted for the offences it
faced, and by the days of rest. The other rate groups (line, red zone, target depth) are refused by
name: the oracle measured them and did not ship them, and this port does not carry them.

With red zone and target depth off, the oracle still multiplies the touchdown and receiving rates
by their neutral multiplier (exactly 1) and caps the catch rate at 1; both are kept, so a rate
above 1 is capped here exactly where the oracle caps it.
"""

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Final

from research.model.jsmath import js_min, js_pow
from research.model.reads.teams import TeamContext, TeamMetricLookup, WeekRef, index_team_metrics
from research.model.weekly.scheme import FeatureFlags, bounded
from research.model.weekly.teams import TeamsOf
from research.pipeline.nflverse.context import ContextMetric
from research.pipeline.nflverse.schedule import ScheduleMetric

STANDARD_REST_DAYS: Final = 7
_UNPORTED_RATE_GROUPS: Final = ("line", "red_zone", "target_depth")


@dataclass(frozen=True, slots=True)
class ContextElasticity:
    opponent: float
    rest: float


@dataclass(frozen=True, slots=True)
class GameContextPriors:
    passing: ContextElasticity
    rushing: ContextElasticity
    league_passing_yards_per_attempt: float
    league_rushing_yards_per_carry: float


@dataclass(frozen=True, slots=True)
class GameContext:
    """`GameContext`: above 1 is a soft matchup; a rest ratio below 1 is a short week."""

    opponent_pass_defence: float | None
    opponent_rush_defence: float | None
    rest_ratio: float | None


def game_context_for(team: str, at: WeekRef, metrics: TeamMetricLookup) -> GameContext:
    """`gameContextFor`."""
    rest_days = metrics(team, at, ScheduleMetric.REST_DAYS)
    return GameContext(
        opponent_pass_defence=metrics(team, at, ContextMetric.OPPONENT_PASS_DEFENCE),
        opponent_rush_defence=metrics(team, at, ContextMetric.OPPONENT_RUSH_DEFENCE),
        rest_ratio=None if rest_days is None or rest_days <= 0 else rest_days / STANDARD_REST_DAYS,
    )


@dataclass(frozen=True, slots=True)
class Matchup:
    rushing: float
    passing: float


NEUTRAL_MATCHUP: Final = Matchup(1.0, 1.0)


def matchup_for(team: str, at: WeekRef, metrics: TeamMetricLookup, priors: GameContextPriors) -> Matchup:
    """The matchup pair `contextualiseRates` computes once per team."""
    context = game_context_for(team, at, metrics)
    rest = 1.0 if context.rest_ratio is None or context.rest_ratio <= 0 else context.rest_ratio

    def factor(opponent: float | None, elasticity: ContextElasticity) -> float:
        if opponent is None or opponent <= 0:
            return 1.0
        return bounded(js_pow(opponent, elasticity.opponent) * js_pow(rest, elasticity.rest))

    return Matchup(
        rushing=factor(context.opponent_rush_defence, priors.rushing),
        passing=factor(context.opponent_pass_defence, priors.passing),
    )


def _neutral_groups(rates: Mapping[str, float]) -> dict[str, float]:
    """The red-zone and target-depth arms with their flags off: each multiplier is exactly 1."""
    return {
        **rates,
        "rushing_touchdowns_per_carry": rates["rushing_touchdowns_per_carry"] * 1.0,
        "receiving_touchdowns_per_target": rates["receiving_touchdowns_per_target"] * 1.0,
        "receiving_yards_per_target": rates["receiving_yards_per_target"] * 1.0,
        "receptions_per_target": js_min(1.0, rates["receptions_per_target"] * 1.0),
    }


def contextualise_weekly_rates(  # noqa: PLR0913, PLR0917 - the oracle's own parameters, in its order
    rates: Mapping[str, Mapping[str, float]],
    season: int,
    week: int,
    team_context: TeamContext,
    teams: TeamsOf,
    features: FeatureFlags,
    priors: GameContextPriors,
) -> dict[str, dict[str, float]]:
    """`contextualiseRates` with the game-context group; the unshipped rate groups are refused."""
    wanted = [name for name in _UNPORTED_RATE_GROUPS if getattr(features, name)]
    if wanted:
        raise NotImplementedError(f"the weekly rate features {wanted} are not ported; the oracle never shipped them")
    if not features.game_context:
        return {player_id: dict(player_rates) for player_id, player_rates in rates.items()}
    metrics = index_team_metrics(team_context)
    team_of = teams(team_context)
    matchups: dict[str, Matchup] = {}
    at = WeekRef(season, week)
    adjusted: dict[str, dict[str, float]] = {}
    for player_id, player_rates in rates.items():
        neutral = _neutral_groups(player_rates)
        team = team_of.get(player_id)
        if team is None:
            adjusted[player_id] = neutral
            continue
        matchup = matchups.get(team)
        if matchup is None:
            matchup = matchup_for(team, at, metrics, priors)
            matchups[team] = matchup
        adjusted[player_id] = {
            **neutral,
            "rushing_yards_per_carry": player_rates["rushing_yards_per_carry"] * 1.0 * matchup.rushing,
            "receiving_yards_per_target": neutral["receiving_yards_per_target"] * matchup.passing,
            "passing_yards_per_attempt": player_rates["passing_yards_per_attempt"] * 1.0 * matchup.passing,
        }
    return adjusted
