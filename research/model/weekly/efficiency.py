"""LAYER 2, EFFICIENCY: each player's per-opportunity rates, regressed toward his position's prior.

Ported from `research-ts/src/projections/model/efficiency.ts`, and `compose.ts`, which multiplies
layer 1's volume by these rates into a per-game stat line.
"""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from types import MappingProxyType
from typing import Final, Literal

from research.model.domain import Position, StatLine
from research.model.jsmath import js_max
from research.model.reads.observations import PlayerWeekUsage, SeasonStatLine
from research.model.weekly.opportunity import PredictedOpportunity

HISTORICAL_ROSTER_FLOOR: Final = 2003

Denominator = Literal["targets", "carries", "pass_attempts", "plays"]
DENOMINATORS: Final[tuple[Denominator, ...]] = ("targets", "carries", "pass_attempts", "plays")

# `RATES`, in declaration order: name -> (numerator field, denominator).
RATES: Final[Mapping[str, tuple[str, Denominator]]] = MappingProxyType(
    {
        "receptions_per_target": ("receptions", "targets"),
        "receiving_yards_per_target": ("receiving_yards", "targets"),
        "receiving_touchdowns_per_target": ("receiving_touchdowns", "targets"),
        "rushing_yards_per_carry": ("rushing_yards", "carries"),
        "rushing_touchdowns_per_carry": ("rushing_touchdowns", "carries"),
        "passing_yards_per_attempt": ("passing_yards", "pass_attempts"),
        "passing_touchdowns_per_attempt": ("passing_touchdowns", "pass_attempts"),
        "interceptions_per_attempt": ("interceptions", "pass_attempts"),
        "fumbles_lost_per_play": ("fumbles_lost", "plays"),
    }
)
RATE_NAMES: Final = tuple(RATES)
TOUCHDOWN_RATES: Final = (
    "receiving_touchdowns_per_target",
    "rushing_touchdowns_per_carry",
    "passing_touchdowns_per_attempt",
)

PlayerRates = Mapping[str, float]


@dataclass(frozen=True, slots=True)
class EfficiencyPriors:
    by_position: Mapping[Position, PlayerRates]
    regression: PlayerRates
    experience_multiplier: Mapping[Position, float] | None = field(default=None)


def experience_cohort(season: int, first_roster_season: int | None) -> str:
    """`experienceCohort`."""
    if first_roster_season is None:
        return "other"
    career_year = season - first_roster_season + 1
    if career_year < 1:
        return "other"
    if first_roster_season <= HISTORICAL_ROSTER_FLOOR and career_year <= 6:  # noqa: PLR2004 - the cohort's own bound
        return "other"
    return "year4to6" if 4 <= career_year <= 6 else "other"  # noqa: PLR2004 - the cohort's own bounds


def _experience_multiplier(
    position: Position,
    player_id: str,
    season: int,
    first_roster_season: Mapping[str, int] | None,
    priors: EfficiencyPriors,
) -> float:
    if first_roster_season is None or priors.experience_multiplier is None:
        return 1.0
    if experience_cohort(season, first_roster_season.get(player_id)) != "year4to6":
        return 1.0
    multiplier = priors.experience_multiplier.get(position)
    if multiplier is None or not (multiplier > 0) or multiplier == float("inf"):
        return 1.0
    return multiplier


def opportunities_for(row: PlayerWeekUsage, denominator: Denominator) -> float | None:
    """`opportunitiesFor`: one count, or the sum of the known three for `plays`."""
    if denominator == "targets":
        return row.targets
    if denominator == "carries":
        return row.carries
    if denominator == "pass_attempts":
        return row.pass_attempts
    known = [count for count in (row.targets, row.carries, row.pass_attempts) if count is not None]
    if not known:
        return None
    total = 0.0
    for count in known:
        total += count
    return total


@dataclass(slots=True)
class _Totals:
    numerators: dict[str, float]
    denominators: dict[Denominator, float | None]


def _empty_totals() -> _Totals:
    return _Totals(dict.fromkeys(RATE_NAMES, 0.0), dict.fromkeys(DENOMINATORS))


def predict_rates(
    history: Sequence[SeasonStatLine],
    usage: Sequence[PlayerWeekUsage],
    season: int,
    week: int,
    positions: Mapping[str, Position],
    priors: EfficiencyPriors,
    first_roster_season: Mapping[str, int] | None = None,
) -> dict[str, dict[str, float]]:
    """`predictRates`."""

    def visible(row_season: int, row_week: int) -> bool:
        return season - 1 <= row_season <= season and not (row_season == season and row_week >= week)

    lines: dict[str, StatLine] = {}
    for row in history:
        if visible(row.season, row.line.week):
            lines[f"{row.season}|{row.line.week}|{row.line.player_id}"] = row.line
    totals: dict[str, _Totals] = {}
    for usage_row in usage:
        if not visible(usage_row.season, usage_row.week):
            continue
        line = lines.get(f"{usage_row.season}|{usage_row.week}|{usage_row.player_id}")
        if line is None:
            continue
        running = totals.get(usage_row.player_id) or _empty_totals()
        for denominator in DENOMINATORS:
            opportunities = opportunities_for(usage_row, denominator)
            if opportunities is None:
                continue
            previous = running.denominators[denominator]
            running.denominators[denominator] = (0.0 if previous is None else previous) + opportunities
        for name, (numerator, denominator) in RATES.items():
            if opportunities_for(usage_row, denominator) is None:
                continue
            running.numerators[name] += getattr(line, numerator)
        totals[usage_row.player_id] = running
    predictions: dict[str, dict[str, float]] = {}
    for player_id in sorted(totals):
        position = positions.get(player_id)
        if position is None:
            continue
        player = totals[player_id]
        role_prior = priors.by_position[position]
        multiplier = _experience_multiplier(position, player_id, season, first_roster_season, priors)
        rates: dict[str, float] = {}
        for name, (_, denominator) in RATES.items():
            opportunities = player.denominators[denominator]
            k = priors.regression[name]
            prior = role_prior[name]
            value = (
                prior
                if opportunities is None or opportunities <= 0
                else (player.numerators[name] + k * prior) / (opportunities + k)
            )
            rates[name] = js_max(0.0, value * multiplier)
        predictions[player_id] = rates
    return predictions


def predicted_volume(opportunity: PredictedOpportunity) -> tuple[float, float, float]:
    """`predictedVolume`: (targets, carries, pass attempts) per game."""
    return (
        opportunity.target_share * opportunity.team_targets,
        opportunity.carry_share * opportunity.team_carries,
        opportunity.pass_attempt_share * opportunity.team_pass_attempts,
    )


def compose_stat_line(player_id: str, week: int, opportunity: PredictedOpportunity, rates: PlayerRates) -> StatLine:
    """`composeStatLine`."""
    targets, carries, pass_attempts = predicted_volume(opportunity)
    plays = targets + carries + pass_attempts
    return StatLine(
        player_id,
        week,
        receptions=targets * rates["receptions_per_target"],
        receiving_yards=targets * rates["receiving_yards_per_target"],
        receiving_touchdowns=targets * rates["receiving_touchdowns_per_target"],
        rushing_yards=carries * rates["rushing_yards_per_carry"],
        rushing_touchdowns=carries * rates["rushing_touchdowns_per_carry"],
        passing_yards=pass_attempts * rates["passing_yards_per_attempt"],
        passing_touchdowns=pass_attempts * rates["passing_touchdowns_per_attempt"],
        interceptions=pass_attempts * rates["interceptions_per_attempt"],
        fumbles_lost=plays * rates["fumbles_lost_per_play"],
    )
