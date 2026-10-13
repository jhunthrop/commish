"""THE DOMAIN THE MODEL SPEAKS: positions, a stat line, scoring rules, a roster's slots.

Ported from `research-ts/src/domain/{player,scoring,roster}.ts` and `src/scoring/compute.ts`.
`compute_fantasy_points` adds its terms in the TypeScript's order, left to right, because a sum
of floats is only reproducible in the order it was written.
"""

import math
from dataclasses import dataclass, fields, replace
from types import MappingProxyType
from typing import Final, Literal

from research.model.jsmath import js_round

Position = Literal["QB", "RB", "WR", "TE", "K", "DEF"]
POSITIONS: Final[tuple[Position, ...]] = ("QB", "RB", "WR", "TE", "K", "DEF")


@dataclass(frozen=True, slots=True)
class StatLine:
    """`StatLine`: the fourteen fields every line carries, then the optional ones (None = absent)."""

    player_id: str
    week: int
    passing_yards: float = 0.0
    passing_touchdowns: float = 0.0
    interceptions: float = 0.0
    rushing_yards: float = 0.0
    rushing_touchdowns: float = 0.0
    receiving_yards: float = 0.0
    receiving_touchdowns: float = 0.0
    receptions: float = 0.0
    fumbles_lost: float = 0.0
    field_goals_made: float = 0.0
    extra_points_made: float = 0.0
    sacks: float = 0.0
    defensive_interceptions: float = 0.0
    defensive_touchdowns: float = 0.0
    targets: float | None = None
    carries: float | None = None
    pass_attempts: float | None = None
    pass_completions: float | None = None
    field_goals_attempted: float | None = None
    points_allowed: float | None = None
    offensive_snaps: float | None = None
    offensive_snap_share: float | None = None
    two_point_conversions: float | None = None
    field_goals_missed: float | None = None
    extra_points_missed: float | None = None
    kick_return_touchdowns: float | None = None
    punt_return_touchdowns: float | None = None
    yards_allowed: float | None = None
    defensive_fumbles_recovered: float | None = None
    safeties: float | None = None

    def with_values(self, **values: float | None) -> "StatLine":
        return replace(self, **values)


# `STAT_FIELDS`, in the TypeScript's canonical order.
STAT_FIELDS: Final = (
    "passing_yards",
    "passing_touchdowns",
    "interceptions",
    "rushing_yards",
    "rushing_touchdowns",
    "receiving_yards",
    "receiving_touchdowns",
    "receptions",
    "fumbles_lost",
    "field_goals_made",
    "extra_points_made",
    "sacks",
    "defensive_interceptions",
    "defensive_touchdowns",
)
STAT_LINE_FIELDS: Final = tuple(field.name for field in fields(StatLine))


def camel_to_snake(name: str) -> str:
    """`passingYards` -> `passing_yards`."""
    return "".join(f"_{char.lower()}" if char.isupper() else char for char in name)


def snake_to_camel(name: str) -> str:
    """`passing_yards` -> `passingYards`."""
    head, *rest = name.split("_")
    return head + "".join(part.capitalize() for part in rest)


@dataclass(frozen=True, slots=True)
class ScoringRules:
    """`ScoringRules` (`Omit<ScoringSettings, "leagueId">`)."""

    points_per_passing_yard: float
    points_per_passing_touchdown: float
    points_per_interception: float
    points_per_rushing_yard: float
    points_per_rushing_touchdown: float
    points_per_receiving_yard: float
    points_per_receiving_touchdown: float
    points_per_reception: float
    points_per_fumble_lost: float
    te_reception_bonus: float
    points_per_field_goal: float
    points_per_extra_point: float
    points_per_sack: float
    points_per_defensive_interception: float
    points_per_defensive_touchdown: float
    points_per_two_point_conversion: float
    points_per_field_goal_missed: float
    points_per_extra_point_missed: float
    points_per_return_touchdown: float
    points_per_defensive_fumble_recovery: float
    points_per_safety: float


STANDARD_SCORING: Final = ScoringRules(
    points_per_passing_yard=0.04,
    points_per_passing_touchdown=4,
    points_per_interception=-2,
    points_per_rushing_yard=0.1,
    points_per_rushing_touchdown=6,
    points_per_receiving_yard=0.1,
    points_per_receiving_touchdown=6,
    points_per_reception=0,
    points_per_fumble_lost=-2,
    te_reception_bonus=0,
    points_per_field_goal=3,
    points_per_extra_point=1,
    points_per_sack=1,
    points_per_defensive_interception=2,
    points_per_defensive_touchdown=6,
    points_per_two_point_conversion=2,
    points_per_field_goal_missed=-1,
    points_per_extra_point_missed=0,
    points_per_return_touchdown=6,
    points_per_defensive_fumble_recovery=2,
    points_per_safety=2,
)
PPR_SCORING: Final = replace(STANDARD_SCORING, points_per_reception=1)
HALF_PPR_SCORING: Final = replace(STANDARD_SCORING, points_per_reception=0.5)

POINTS_ALLOWED_TIERS: Final = ((0, 5), (6, 4), (13, 3), (17, 1), (27, 0), (34, -1), (45, -3), (math.inf, -5))
YARDS_ALLOWED_TIERS: Final = (
    (99, 5),
    (199, 3),
    (299, 2),
    (349, 0),
    (399, -1),
    (449, -3),
    (499, -5),
    (549, -6),
    (math.inf, -7),
)


def _tier_points(value: float, tiers: tuple[tuple[float, int], ...]) -> float:
    for ceiling, points in tiers:
        if value <= ceiling:
            return float(points)
    return 0.0


def round_points(n: float) -> float:
    """`roundPoints`: two decimals, `Math.round(n * 100) / 100`."""
    return js_round(n * 100) / 100


def _defense_tier_points(line: StatLine, position: Position) -> float:
    if position != "DEF":
        return 0.0
    allowed = 0.0 if line.points_allowed is None else _tier_points(line.points_allowed, POINTS_ALLOWED_TIERS)
    yards = 0.0 if line.yards_allowed is None else _tier_points(line.yards_allowed, YARDS_ALLOWED_TIERS)
    return allowed + yards


def _or_zero(value: float | None) -> float:
    return 0.0 if value is None else value


def compute_fantasy_points(line: StatLine, position: Position, rules: ScoringRules) -> float:
    """`computeFantasyPoints`, term for term in the TypeScript's order."""
    reception_points = line.receptions * (
        rules.points_per_reception + (rules.te_reception_bonus if position == "TE" else 0)
    )
    total = line.passing_yards * rules.points_per_passing_yard
    total += line.passing_touchdowns * rules.points_per_passing_touchdown
    total += line.interceptions * rules.points_per_interception
    total += line.rushing_yards * rules.points_per_rushing_yard
    total += line.rushing_touchdowns * rules.points_per_rushing_touchdown
    total += line.receiving_yards * rules.points_per_receiving_yard
    total += line.receiving_touchdowns * rules.points_per_receiving_touchdown
    total += reception_points
    total += line.fumbles_lost * rules.points_per_fumble_lost
    total += line.field_goals_made * rules.points_per_field_goal
    total += line.extra_points_made * rules.points_per_extra_point
    total += line.sacks * rules.points_per_sack
    total += line.defensive_interceptions * rules.points_per_defensive_interception
    total += line.defensive_touchdowns * rules.points_per_defensive_touchdown
    total += _or_zero(line.two_point_conversions) * rules.points_per_two_point_conversion
    total += _or_zero(line.field_goals_missed) * rules.points_per_field_goal_missed
    total += _or_zero(line.extra_points_missed) * rules.points_per_extra_point_missed
    total += (
        _or_zero(line.kick_return_touchdowns) + _or_zero(line.punt_return_touchdowns)
    ) * rules.points_per_return_touchdown
    total += _or_zero(line.defensive_fumbles_recovered) * rules.points_per_defensive_fumble_recovery
    total += _or_zero(line.safeties) * rules.points_per_safety
    total += _defense_tier_points(line, position)
    return round_points(total)


RosterSlotType = Literal["QB", "RB", "WR", "TE", "FLEX", "SUPERFLEX", "K", "DEF", "BENCH"]
BENCH_SLOT: Final[RosterSlotType] = "BENCH"


@dataclass(frozen=True, slots=True)
class RosterSlotConfig:
    slot: RosterSlotType
    count: int
    eligible_positions: tuple[Position, ...]


STANDARD_ROSTER_SLOTS: Final = (
    RosterSlotConfig("QB", 1, ("QB",)),
    RosterSlotConfig("RB", 2, ("RB",)),
    RosterSlotConfig("WR", 2, ("WR",)),
    RosterSlotConfig("TE", 1, ("TE",)),
    RosterSlotConfig("FLEX", 1, ("RB", "WR", "TE")),
    RosterSlotConfig("K", 1, ("K",)),
    RosterSlotConfig("DEF", 1, ("DEF",)),
    RosterSlotConfig(BENCH_SLOT, 6, ("QB", "RB", "WR", "TE", "K", "DEF")),
)

SCORING_PRESETS: Final = MappingProxyType(
    {"standard": STANDARD_SCORING, "ppr": PPR_SCORING, "half_ppr": HALF_PPR_SCORING}
)
