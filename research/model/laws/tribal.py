"""THE TRIBAL LAWS: what the fantasy community says, as conditions on a player's completed season.

Ported from `research-ts/src/projections/laws/populations.ts`: each law's condition and position
gate, and `factsForSeason`, the facts every condition reads, gated at the next season's schedule
publication (20 May).
"""

from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from types import MappingProxyType
from typing import Final

from sqlalchemy import Connection

from research.model.domain import Position, ScoringRules, StatLine, compute_fantasy_points, round_points
from research.model.reads.observations import (
    STAT_LINE_SOURCE,
    ObservationQuery,
    admits_derived_for_live_surface,
    observations_as_of,
    season_span,
    stat_lines_as_of,
    stat_lines_for_measurement,
)
from research.model.reads.teams import player_teams_as_of
from research.pipeline.nflverse.participation import ParticipationMetric
from research.pipeline.nflverse.pbp import PBP_PLAYER_SOURCE, PbpPlayerMetric
from research.pipeline.observations import PlayerWeekObservation

WORKLOAD_CLIFF_TOUCHES: Final = 300
AGE_CLIFF_YEARS: Final = 28
TEAMMATE_PRIMARY_RECEIVER_SHARE: Final = 0.2
TARGET_SHARE_PERSISTENCE_MIN: Final = 0.24
TD_REGRESSION_MULTIPLIER: Final = 1.5
MIN_GAMES_FOR_TD_MEDIAN: Final = 8
POINTS_PER_GAME_CALIPER: Final = 2
SKILL_POSITIONS: Final = ("QB", "RB", "WR", "TE")
_MAY: Final = 5
_SCHEDULE_DAY: Final = 20


def schedule_published_as_of(season: int) -> datetime:
    """`schedulePublishedAsOf`: 20 May of the season, the instant its schedule is knowable."""
    return datetime(season, _MAY, _SCHEDULE_DAY, tzinfo=UTC)


@dataclass(frozen=True, slots=True)
class LawConditionFacts:
    touches: float | None
    age: float | None
    best_teammate_target_share: float | None
    incoming_coach_tenure_is_zero: bool | None
    incoming_coach_prior_pass_rate_over_expected: float | None
    target_share: float | None
    touchdown_points_share: float | None
    touchdown_points_share_threshold: float | None


def _rb_workload_cliff(facts: LawConditionFacts) -> bool | None:
    return None if facts.touches is None else facts.touches >= WORKLOAD_CLIFF_TOUCHES


def _rb_age_curve(facts: LawConditionFacts) -> bool | None:
    return None if facts.age is None else facts.age >= AGE_CLIFF_YEARS


def _wr_target_competition(facts: LawConditionFacts) -> bool | None:
    if facts.target_share is None or facts.best_teammate_target_share is None:
        return None
    best = facts.best_teammate_target_share
    return best >= TEAMMATE_PRIMARY_RECEIVER_SHARE and best >= facts.target_share


def _play_caller_fingerprint(facts: LawConditionFacts) -> bool | None:
    if facts.incoming_coach_tenure_is_zero is None:
        return None
    if not facts.incoming_coach_tenure_is_zero:
        return False
    prior = facts.incoming_coach_prior_pass_rate_over_expected
    return None if prior is None else prior > 0


def _target_share_persistence(facts: LawConditionFacts) -> bool | None:
    return None if facts.target_share is None else facts.target_share >= TARGET_SHARE_PERSISTENCE_MIN


def _td_regression(facts: LawConditionFacts) -> bool | None:
    if facts.touchdown_points_share is None or facts.touchdown_points_share_threshold is None:
        return None
    return facts.touchdown_points_share >= facts.touchdown_points_share_threshold


@dataclass(frozen=True, slots=True)
class LawEntry:
    id: str
    position: str
    claim: str
    expected_sign: int
    eligible: Callable[[Position], bool]
    condition: Callable[[LawConditionFacts], bool | None]
    model_path: str | None


def _is_rb(position: Position) -> bool:
    return position == "RB"


def _is_wr(position: Position) -> bool:
    return position == "WR"


def _is_wr_or_te(position: Position) -> bool:
    return position in ("WR", "TE")


def is_skill_position(position: Position) -> bool:
    return position in SKILL_POSITIONS


LAW_ENTRIES: Final = (
    LawEntry(
        "rb_workload_cliff",
        "RB",
        "The workload cliff: a running back who racks up 300 or more combined carries and receptions in a season loses points per game the next season.",
        -1,
        _is_rb,
        _rb_workload_cliff,
        None,
    ),
    LawEntry(
        "rb_age_curve",
        "RB",
        "The running back age curve: a running back who is 28 or older at the season opener produces fewer points per game the following season than an otherwise similar younger back.",
        -1,
        _is_rb,
        _rb_age_curve,
        None,
    ),
    LawEntry(
        "wr_target_competition",
        "WR",
        "Another primary receiver on his team: a wide receiver with a WR/TE teammate whose own target share that same season is at least 20% and at least as large as the receiver's own share loses points per game the following season. Simplified: teammates are read from the season being measured, not from a predicted next-season arrival, because next season's roster is not knowable yet when the measurement is taken.",
        -1,
        _is_wr,
        _wr_target_competition,
        "research-ts/src/projections/model/redistribution-fit.ts#fitRedistributionPriors",
    ),
    LawEntry(
        "play_caller_fingerprint",
        "all",
        "The play-caller fingerprint: a pass-catcher (WR or TE) whose team enters a season with a first-year play-caller (the coordinator or head coach who calls the offense's plays) whose own history elsewhere shows a positive pass-rate-over-expected gains points per game. Simplified: 'his team' means the team he played for in the season being measured, because next season's actual roster is not knowable at the time the measurement is taken; a player traded before the coaching change is still measured against his old team.",
        1,
        _is_wr_or_te,
        _play_caller_fingerprint,
        None,
    ),
    LawEntry(
        "target_share_persistence",
        "WR",
        "Target share persistence: a wide receiver commanding 24% or more of his team's targets in a season sustains stronger points per game the following season than his raw scoring alone predicts.",
        1,
        _is_wr,
        _target_share_persistence,
        "research-ts/src/projections/model/opportunity.ts#predictOpportunity",
    ),
    LawEntry(
        "td_regression",
        "all",
        "Touchdown regression: a player whose touchdown points make up at least 1.5x his position's typical share of a regular's own points (players with at least 8 games) in a season loses points per game the following season as touchdown luck reverts. Covers QB, RB, WR and TE; kickers and defenses are excluded because a touchdown-points share is not a meaningful quantity for them.",
        -1,
        is_skill_position,
        _td_regression,
        "research-ts/src/projections/model/efficiency.ts#TOUCHDOWN_RATES",
    ),
)
LAW_BY_ID: Final = MappingProxyType({entry.id: entry for entry in LAW_ENTRIES})


def magnitude_for_law(law_id: str, facts: LawConditionFacts) -> float | None:  # noqa: PLR0911 - one return per law
    """`magnitudeForLaw`."""
    if law_id == "rb_workload_cliff":
        return facts.touches
    if law_id == "rb_age_curve":
        return facts.age
    if law_id == "wr_target_competition":
        return facts.best_teammate_target_share
    if law_id == "target_share_persistence":
        return facts.target_share
    if law_id == "td_regression":
        share, threshold = facts.touchdown_points_share, facts.touchdown_points_share_threshold
        if share is None or threshold is None:
            return None
        return share / threshold if threshold > 0 else share
    if law_id == "play_caller_fingerprint":
        return facts.incoming_coach_prior_pass_rate_over_expected
    return None


@dataclass(frozen=True, slots=True)
class SeasonScoring:
    points: float
    games: int
    touchdown_points: float
    receptions: float


def _touchdown_points(line: StatLine, rules: ScoringRules) -> float:
    total = line.passing_touchdowns * rules.points_per_passing_touchdown
    total += line.rushing_touchdowns * rules.points_per_rushing_touchdown
    total += line.receiving_touchdowns * rules.points_per_receiving_touchdown
    returns = (line.kick_return_touchdowns or 0.0) + (line.punt_return_touchdowns or 0.0)
    total += returns * rules.points_per_return_touchdown
    total += (line.two_point_conversions or 0.0) * rules.points_per_two_point_conversion
    return total


def season_scoring(  # noqa: PLR0913, PLR0917 - the oracle's own parameters, in its order, for a line-by-line read
    conn: Connection,
    season: int,
    as_of: datetime,
    positions: Mapping[str, Position],
    rules: ScoringRules,
    admit_derived: bool,
) -> dict[str, SeasonScoring]:
    """`seasonScoring`: running, rounded season totals per player."""
    span = season_span(season, as_of)
    rows = stat_lines_for_measurement(conn, span) if admit_derived else stat_lines_as_of(conn, span)
    out: dict[str, SeasonScoring] = {}
    for row in rows:
        line = row.line
        position = positions.get(line.player_id)
        if position is None:
            continue
        held = out.get(line.player_id) or SeasonScoring(0.0, 0, 0.0, 0.0)
        out[line.player_id] = SeasonScoring(
            round_points(held.points + compute_fantasy_points(line, position, rules)),
            held.games + 1,
            round_points(held.touchdown_points + _touchdown_points(line, rules)),
            held.receptions + line.receptions,
        )
    return out


def points_per_game(entry: SeasonScoring | None) -> float | None:
    """`pointsPerGame`."""
    return round_points(entry.points / entry.games) if entry is not None and entry.games > 0 else None


@dataclass(frozen=True, slots=True)
class SeasonParticipation:
    targets: float
    team_targets: float
    carries: float


_EMPTY_PARTICIPATION: Final = SeasonParticipation(0.0, 0.0, 0.0)
_PARTICIPATION_METRICS: Final = (
    ParticipationMetric.TARGETS,
    ParticipationMetric.TEAM_TARGETS,
    ParticipationMetric.CARRIES,
)


def _published_participation(rows: Sequence[PlayerWeekObservation]) -> dict[str, SeasonParticipation]:
    out: dict[str, SeasonParticipation] = {}
    for row in rows:
        if row.metric not in _PARTICIPATION_METRICS:
            continue
        held = out.get(row.player_id, _EMPTY_PARTICIPATION)
        out[row.player_id] = SeasonParticipation(
            held.targets + (row.value if row.metric == ParticipationMetric.TARGETS else 0),
            held.team_targets + (row.value if row.metric == ParticipationMetric.TEAM_TARGETS else 0),
            held.carries + (row.value if row.metric == ParticipationMetric.CARRIES else 0),
        )
    return out


def _team_week_of(row: PlayerWeekObservation, team_by_player_week: Mapping[str, str]) -> str | None:
    team = team_by_player_week.get(f"{row.player_id}|{row.week}")
    return None if team is None else f"{row.week}|{team}"


def fill_from_play_by_play(
    published: Mapping[str, SeasonParticipation],
    pbp_rows: Sequence[PlayerWeekObservation],
    team_by_player_week: Mapping[str, str],
) -> dict[str, SeasonParticipation]:
    """`fillFromPlayByPlay`: a player the published file never names takes his play-by-play counts."""
    team_week_targets: dict[str, float] = {}
    for row in pbp_rows:
        if row.metric != PbpPlayerMetric.TARGETS:
            continue
        team_week = _team_week_of(row, team_by_player_week)
        if team_week is not None:
            team_week_targets[team_week] = team_week_targets.get(team_week, 0.0) + row.value
    filled = dict(published)
    counted: dict[str, set[str]] = {}
    for row in pbp_rows:
        if row.player_id in published:
            continue
        is_carry = row.metric == PbpPlayerMetric.CARRIES
        is_target = row.metric == PbpPlayerMetric.TARGETS
        if not is_carry and not is_target:
            continue
        team_week = _team_week_of(row, team_by_player_week) if is_target else None
        if is_target and team_week is None:
            continue
        seen = counted.setdefault(row.player_id, set())
        first = team_week is not None and team_week not in seen
        if team_week is not None:
            seen.add(team_week)
        held = filled.get(row.player_id, _EMPTY_PARTICIPATION)
        filled[row.player_id] = SeasonParticipation(
            held.targets + (row.value if is_target else 0),
            held.team_targets + (team_week_targets.get(team_week or "", 0.0) if first else 0),
            held.carries + (row.value if is_carry else 0),
        )
    return filled


def season_participation(
    conn: Connection, season: int, as_of: datetime, admit_derived: bool
) -> dict[str, SeasonParticipation]:
    """`seasonParticipation`."""
    span = season_span(season, as_of)
    published = _published_participation(
        observations_as_of(conn, ObservationQuery(span.season, span.week, as_of, STAT_LINE_SOURCE))
    )
    if not admit_derived or not admits_derived_for_live_surface(season):
        return published
    pbp_rows = observations_as_of(conn, ObservationQuery(span.season, span.week, as_of, PBP_PLAYER_SOURCE))
    teams = {f"{row.player_id}|{row.week}": row.team for row in player_teams_as_of(conn, season, span.week, as_of)}
    return fill_from_play_by_play(published, pbp_rows, teams)


def target_share_of(participated: SeasonParticipation | None) -> float | None:
    """`targetShareOf`."""
    return (
        participated.targets / participated.team_targets
        if participated is not None and participated.team_targets > 0
        else None
    )
