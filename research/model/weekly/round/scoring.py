"""ONE WEEK, SCORED: the model's projections, the two benchmarks and the outcome, per player.

Every row the round's statistics read is built here, from one week's input at its moment. The
model is `commish_weekly_v1` (the round's priors, the season-aware team rule) unless a caller names
another arm. Points go through each format's own rules (`compute_fantasy_points`); the outcome is
the week's line as measured (`stat_lines_for_measurement`: published, filled from play-by-play only
in a gap season), read at the far future so a correction counts.
"""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from types import MappingProxyType
from typing import Final

from sqlalchemy import Connection

from research.model.domain import (
    HALF_PPR_SCORING,
    PPR_SCORING,
    STANDARD_SCORING,
    Position,
    ScoringRules,
    StatLine,
    compute_fantasy_points,
)
from research.model.instants import FAR_FUTURE
from research.model.reads.observations import ObservationQuery, SeasonStatLine, stat_lines_for_measurement
from research.model.reads.preseason import preseason_rankings_as_of
from research.model.weekly.inputs import ROUND_READER, FactReader, WeeklyInput, load_week, week_moment
from research.model.weekly.model import SHIPPED_FEATURES, WeeklyPriors, WeeklyProjection, project_week
from research.model.weekly.teams import TeamsOf, latest_teams_by_season

FORMATS: Final[Mapping[str, ScoringRules]] = MappingProxyType(
    {"ppr": PPR_SCORING, "half": HALF_PPR_SCORING, "std": STANDARD_SCORING}
)
SKILL_POSITIONS: Final[tuple[Position, ...]] = ("QB", "RB", "WR", "TE")
ADP_SOURCE: Final = "ffc_adp_ppr_12"


@dataclass(frozen=True, slots=True)
class Arm:
    """Which model is scored: its priors, its team rule and how it reads the player facts."""

    name: str
    priors: WeeklyPriors
    teams_of: TeamsOf = latest_teams_by_season
    reader: FactReader = ROUND_READER


@dataclass(frozen=True, slots=True)
class ScoredRow:
    season: int
    week: int
    player_id: str
    position: Position
    projected: Mapping[str, float]
    actual: Mapping[str, float] | None
    adp: float | None
    form: Mapping[str, float] | None


def points_by_format(line: StatLine, position: Position) -> dict[str, float]:
    return {name: compute_fantasy_points(line, position, rules) for name, rules in FORMATS.items()}


def recent_form(data: WeeklyInput) -> dict[str, dict[str, float]]:
    """Points per game over this season's weeks before the target in which the player recorded a
    line, else over last season's; no opinion without either."""
    this_season: dict[str, list[StatLine]] = {}
    last_season: dict[str, list[StatLine]] = {}
    for row in data.history:
        bucket = this_season if row.season == data.season else last_season
        if row.season == data.season and row.line.week >= data.week:
            continue
        bucket.setdefault(row.line.player_id, []).append(row.line)
    form: dict[str, dict[str, float]] = {}
    for player_id in {*this_season, *last_season}:
        position = data.positions.get(player_id)
        lines = this_season.get(player_id) or last_season.get(player_id)
        if position is None or not lines:
            continue
        totals = dict.fromkeys(FORMATS, 0.0)
        for line in lines:
            for name, value in points_by_format(line, position).items():
                totals[name] += value
        form[player_id] = {name: total / len(lines) for name, total in totals.items()}
    return form


def actual_points(
    conn: Connection, season: int, week: int, positions: Mapping[str, Position]
) -> dict[str, dict[str, float]]:
    rows: Sequence[SeasonStatLine] = stat_lines_for_measurement(conn, ObservationQuery(season, week, FAR_FUTURE))
    return {
        row.line.player_id: points_by_format(row.line, positions[row.line.player_id])
        for row in rows
        if row.line.player_id in positions
    }


@dataclass(frozen=True, slots=True)
class ScoredWeek:
    rows: tuple[ScoredRow, ...]
    projections: tuple[WeeklyProjection, ...]
    data: WeeklyInput


def score_week(conn: Connection, season: int, week: int, arm: Arm) -> ScoredWeek:
    """One week's board under `arm`, with the benchmarks and the outcome beside each player."""
    data = load_week(conn, season, week, week_moment(conn, season, week), arm.reader)
    projections = project_week(data, arm.priors, SHIPPED_FEATURES, arm.teams_of)
    adp = {row.player_id: row.rank for row in preseason_rankings_as_of(conn, season, ADP_SOURCE, data.as_of)}
    form = recent_form(data)
    actual = actual_points(conn, season, week, data.positions)
    rows: list[ScoredRow] = []
    for projection in projections:
        player_id = projection.line.player_id
        position = data.positions[player_id]
        if position not in SKILL_POSITIONS:
            continue
        rows.append(
            ScoredRow(
                season,
                week,
                player_id,
                position,
                points_by_format(projection.line, position),
                actual.get(player_id),
                adp.get(player_id),
                form.get(player_id),
            )
        )
    return ScoredWeek(tuple(rows), tuple(projections), data)
