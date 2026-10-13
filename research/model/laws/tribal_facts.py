"""`factsForSeason` (`laws/populations.ts`): each player's completed season as the tribal laws'
conditions read it. `buildPopulations`, the matched populations the laws are measured on, serves only
the law discovery fit, which is not ported (see `harness`), so it is not kept here."""

import math
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import Connection

from research.model.domain import Position, ScoringRules
from research.model.laws.tribal import (
    MIN_GAMES_FOR_TD_MEDIAN,
    TD_REGRESSION_MULTIPLIER,
    LawConditionFacts,
    SeasonParticipation,
    SeasonScoring,
    is_skill_position,
    points_per_game,
    schedule_published_as_of,
    season_participation,
    season_scoring,
    target_share_of,
)
from research.model.preseason.availability import age_at_season
from research.model.reads.observations import WeekRange
from research.model.reads.preseason import preseason_rosters_as_of
from research.model.reads.teams import player_teams_as_of, team_observations_as_of
from research.pipeline.nflverse.context import CoachMetric
from research.pipeline.nflverse.schedule import ScheduleSource
from research.pipeline.observations import LAST_POSSIBLE_WEEK

_WHOLE_SEASON = WeekRange(1, LAST_POSSIBLE_WEEK)


def season_teams(conn: Connection, season: int, as_of: datetime) -> dict[str, str]:
    """`seasonTeams`: each player's team in the latest week he was listed."""
    latest: dict[str, tuple[int, str]] = {}
    for row in player_teams_as_of(conn, season, _WHOLE_SEASON, as_of):
        held = latest.get(row.player_id)
        if held is None or row.week > held[0]:
            latest[row.player_id] = (row.week, row.team)
    return {player_id: team for player_id, (_, team) in latest.items()}


def best_teammate_target_shares(
    conn: Connection,
    season: int,
    as_of: datetime,
    positions: Mapping[str, Position],
    participation: Mapping[str, SeasonParticipation],
) -> dict[str, float]:
    """`bestTeammateTargetShares`: the largest season target share among his WR/TE teammates."""
    by_week_team: dict[str, list[str]] = {}
    for row in player_teams_as_of(conn, season, _WHOLE_SEASON, as_of):
        if positions.get(row.player_id) not in ("WR", "TE"):
            continue
        by_week_team.setdefault(f"{row.week}|{row.team}", []).append(row.player_id)
    teammates: dict[str, dict[str, None]] = {}
    for roster in by_week_team.values():
        for player_id in roster:
            known = teammates.setdefault(player_id, {})
            for other in roster:
                if other != player_id:
                    known[other] = None
    best: dict[str, float] = {}
    for player_id, others in teammates.items():
        top = 0.0
        for other in others:
            share = target_share_of(participation.get(other))
            if share is not None and share > top:
                top = share
        best[player_id] = top
    return best


@dataclass(frozen=True, slots=True)
class IncomingCoachFacts:
    tenure_seasons: float | None
    prior_pass_rate_over_expected: float | None


def incoming_coach_facts_by_team(conn: Connection, next_season: int, as_of: datetime) -> dict[str, IncomingCoachFacts]:
    """`incomingCoachFactsByTeam`: next season's week-one play-caller facts, per club."""
    out: dict[str, IncomingCoachFacts] = {}
    for row in team_observations_as_of(conn, next_season, 1, as_of, ScheduleSource.SCHEDULE):
        if row.metric not in (CoachMetric.TENURE_SEASONS, CoachMetric.PRIOR_PASS_RATE_OVER_EXPECTED):
            continue
        held = out.get(row.team) or IncomingCoachFacts(None, None)
        out[row.team] = IncomingCoachFacts(
            row.value if row.metric == CoachMetric.TENURE_SEASONS else held.tenure_seasons,
            row.value
            if row.metric == CoachMetric.PRIOR_PASS_RATE_OVER_EXPECTED
            else held.prior_pass_rate_over_expected,
        )
    return out


def _median(values: list[float]) -> float:
    ordered = sorted(values)
    mid = math.floor(len(ordered) / 2)
    return (ordered[mid - 1] + ordered[mid]) / 2 if len(ordered) % 2 == 0 else ordered[mid]


def td_share_thresholds(
    scoring: Mapping[str, SeasonScoring], positions: Mapping[str, Position]
) -> dict[Position, float]:
    """`tdShareThresholds`: 1.5 times each position's median touchdown share among regulars."""
    shares: dict[Position, list[float]] = {}
    for player_id, entry in scoring.items():
        position = positions.get(player_id)
        if (
            position is None
            or not is_skill_position(position)
            or entry.points <= 0
            or entry.games < MIN_GAMES_FOR_TD_MEDIAN
        ):
            continue
        shares.setdefault(position, []).append(entry.touchdown_points / entry.points)
    return {position: TD_REGRESSION_MULTIPLIER * _median(values) for position, values in shares.items()}


@dataclass(frozen=True, slots=True)
class SeasonFacts:
    position: Position
    points_per_game: float
    facts: LawConditionFacts


def facts_for_season(
    conn: Connection, season: int, positions: Mapping[str, Position], rules: ScoringRules, admit_derived: bool
) -> dict[str, SeasonFacts]:
    """`factsForSeason`, read at the next season's schedule publication."""
    as_of = schedule_published_as_of(season + 1)
    scoring = season_scoring(conn, season, as_of, positions, rules, admit_derived)
    participation = season_participation(conn, season, as_of, admit_derived)
    teams = season_teams(conn, season, as_of)
    roster = preseason_rosters_as_of(conn, season, as_of)
    coach_facts = incoming_coach_facts_by_team(conn, season + 1, as_of)
    birth_dates = {row.player_id: row.birth_date for row in roster}
    teammate_shares = best_teammate_target_shares(conn, season, as_of, positions, participation)
    thresholds = td_share_thresholds(scoring, positions)
    out: dict[str, SeasonFacts] = {}
    for player_id, position in positions.items():
        scored = scoring.get(player_id)
        ppg = points_per_game(scored)
        if scored is None or ppg is None:
            continue
        participated = participation.get(player_id)
        team = teams.get(player_id)
        coach = None if team is None else coach_facts.get(team)
        tenure = None if coach is None else coach.tenure_seasons
        out[player_id] = SeasonFacts(
            position,
            ppg,
            LawConditionFacts(
                touches=None if participated is None else participated.carries + scored.receptions,
                age=age_at_season(birth_dates.get(player_id), season),
                best_teammate_target_share=teammate_shares.get(player_id),
                incoming_coach_tenure_is_zero=None if tenure is None else tenure == 0,
                incoming_coach_prior_pass_rate_over_expected=None
                if coach is None
                else coach.prior_pass_rate_over_expected,
                target_share=target_share_of(participated),
                touchdown_points_share=scored.touchdown_points / scored.points if scored.points > 0 else None,
                touchdown_points_share_threshold=thresholds.get(position),
            ),
        )
    return out
