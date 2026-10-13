"""THE DISCOVERED LAWS' FACTS: every quantity a template can condition on, for a player's completed
season and the one before it.

Ported from `research-ts/src/projections/laws/discovery-facts.ts`.
"""

from collections.abc import Callable, Mapping
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import Connection

from research.model.domain import Position, ScoringRules
from research.model.laws.tribal import (
    is_skill_position,
    points_per_game,
    schedule_published_as_of,
    season_participation,
    season_scoring,
    target_share_of,
)
from research.model.laws.tribal_facts import incoming_coach_facts_by_team, season_teams
from research.model.preseason.availability import age_at_season
from research.model.reads.observations import ObservationQuery, WeekRange, observations_as_of, season_span, usage_as_of
from research.model.reads.preseason import preseason_rosters_as_of
from research.model.reads.teams import team_observations_as_of
from research.pipeline.nflverse.participation import NflverseSource, ParticipationMetric
from research.pipeline.nflverse.pbp import PBP_SOURCE, PbpMetric
from research.pipeline.nflverse.schedule import ScheduleMetric, ScheduleSource, regular_season_games_per_team
from research.pipeline.observations import LAST_POSSIBLE_WEEK
from research.pipeline.vegas import VEGAS_SOURCE, VegasMetric

QUANTITY_NAMES = (
    "touches",
    "age",
    "target_share",
    "touchdown_points_share",
    "red_zone_touch_share",
    "target_depth",
    "snap_share",
    "incoming_coach_tenure_seasons",
    "incoming_coach_prior_pass_rate_over_expected",
    "experience_year",
    "team_pace_seconds_per_play",
    "incoming_team_win_total",
    "incoming_team_win_total_delta",
    "inside_ten_touch_share",
    "team_air_yards_share",
    "games_played",
    "draft_pick",
    "points_per_game",
)


@dataclass(frozen=True, slots=True)
class DiscoveryQuantityValues:
    touches: float | None
    age: float | None
    target_share: float | None
    touchdown_points_share: float | None
    red_zone_touch_share: float | None
    target_depth: float | None
    snap_share: float | None
    incoming_coach_tenure_seasons: float | None
    incoming_coach_prior_pass_rate_over_expected: float | None
    experience_year: float | None
    team_pace_seconds_per_play: float | None
    incoming_team_win_total: float | None
    incoming_team_win_total_delta: float | None
    inside_ten_touch_share: float | None
    team_air_yards_share: float | None
    games_played: float | None
    draft_pick: float | None
    points_per_game: float | None


@dataclass(frozen=True, slots=True)
class DiscoveryFacts:
    position: Position
    current: DiscoveryQuantityValues
    prior: DiscoveryQuantityValues | None


@dataclass(frozen=True, slots=True)
class _Usage:
    pbp_carries: float = 0.0
    pbp_targets: float = 0.0
    red_zone_touches: float = 0.0
    inside_ten_touches: float = 0.0
    air_yards: float = 0.0
    air_yard_targets: float = 0.0
    has_pbp_evidence: bool = False


def _season_usage(conn: Connection, season: int, as_of: datetime) -> dict[str, _Usage]:
    out: dict[str, _Usage] = {}
    for row in usage_as_of(conn, season_span(season, as_of)):
        held = out.get(row.player_id, _Usage())
        t = row.touches
        out[row.player_id] = _Usage(
            held.pbp_carries + (0 if t is None else t.carries),
            held.pbp_targets + (0 if t is None else t.targets),
            held.red_zone_touches + (0 if t is None else t.red_zone_carries + t.red_zone_targets),
            held.inside_ten_touches + (0 if t is None else t.inside_ten_carries + t.inside_ten_targets),
            held.air_yards + (0 if t is None else t.air_yards),
            held.air_yard_targets + (0 if t is None else t.air_yard_targets),
            held.has_pbp_evidence or t is not None,
        )
    return out


def _season_snap_counts(conn: Connection, season: int, as_of: datetime) -> dict[str, tuple[float, float]]:
    out: dict[str, tuple[float, float]] = {}
    query = ObservationQuery(season, WeekRange(1, LAST_POSSIBLE_WEEK), as_of, NflverseSource.SNAP_COUNTS)
    for row in observations_as_of(conn, query):
        if row.metric not in (ParticipationMetric.OFFENSIVE_SNAPS, ParticipationMetric.TEAM_OFFENSIVE_SNAPS):
            continue
        snaps, team_snaps = out.get(row.player_id, (0.0, 0.0))
        out[row.player_id] = (
            snaps + (row.value if row.metric == ParticipationMetric.OFFENSIVE_SNAPS else 0),
            team_snaps + (row.value if row.metric == ParticipationMetric.TEAM_OFFENSIVE_SNAPS else 0),
        )
    return out


def _band_share(usage: _Usage | None, in_band: Callable[[_Usage], float]) -> float | None:
    if usage is None or not usage.has_pbp_evidence:
        return None
    denominator = usage.pbp_carries + usage.pbp_targets
    return in_band(usage) / denominator if denominator > 0 else None


def _target_depth(usage: _Usage | None) -> float | None:
    if usage is None or not usage.has_pbp_evidence:
        return None
    return usage.air_yards / usage.air_yard_targets if usage.air_yard_targets > 0 else None


def _team_pace(conn: Connection, season: int, as_of: datetime) -> dict[str, float]:
    sums: dict[str, tuple[float, int]] = {}
    for row in team_observations_as_of(conn, season, WeekRange(1, LAST_POSSIBLE_WEEK), as_of, PBP_SOURCE):
        if row.metric != PbpMetric.PACE_SECONDS_PER_PLAY:
            continue
        total, weeks = sums.get(row.team, (0.0, 0))
        sums[row.team] = (total + row.value, weeks + 1)
    return {team: total / weeks for team, (total, weeks) in sums.items()}


def _incoming_win_totals(conn: Connection, next_season: int, incoming_as_of: datetime) -> dict[str, float]:
    return {
        row.team: row.value
        for row in team_observations_as_of(conn, next_season, 1, incoming_as_of, VEGAS_SOURCE)
        if row.metric == VegasMetric.WIN_TOTAL
    }


def _actual_wins(conn: Connection, season: int, as_of: datetime) -> dict[str, float]:
    tallies: dict[str, tuple[float, int]] = {}
    for row in team_observations_as_of(conn, season, WeekRange(1, LAST_POSSIBLE_WEEK), as_of, ScheduleSource.KICKOFF):
        if row.metric != ScheduleMetric.GAME_RESULT:
            continue
        wins, games = tallies.get(row.team, (0.0, 0))
        tallies[row.team] = (wins + row.value, games + 1)
    required = regular_season_games_per_team(season)
    return {team: wins for team, (wins, games) in tallies.items() if games == required}


def _quantities_for_season(  # noqa: PLR0913, PLR0917 - the oracle's own parameters, in its order, for a line-by-line read
    conn: Connection,
    season: int,
    as_of: datetime,
    incoming_as_of: datetime,
    positions: Mapping[str, Position],
    rules: ScoringRules,
    admit_derived: bool,
) -> dict[str, DiscoveryQuantityValues]:
    scoring = season_scoring(conn, season, as_of, positions, rules, admit_derived)
    participation = season_participation(conn, season, as_of, admit_derived)
    teams = season_teams(conn, season, as_of)
    roster = preseason_rosters_as_of(conn, season, as_of)
    coach_facts = incoming_coach_facts_by_team(conn, season + 1, as_of)
    birth_dates = {row.player_id: row.birth_date for row in roster}
    usage = _season_usage(conn, season, as_of)
    snaps = _season_snap_counts(conn, season, as_of)
    pace = _team_pace(conn, season, as_of)
    win_totals = _incoming_win_totals(conn, season + 1, incoming_as_of)
    actual_wins = _actual_wins(conn, season, as_of)
    team_air_yards: dict[str, float] = {}
    for player_id, aggregate in usage.items():
        team = teams.get(player_id)
        if team is not None and aggregate.has_pbp_evidence:
            team_air_yards[team] = team_air_yards.get(team, 0.0) + aggregate.air_yards
    draft_years = {row.player_id: row.draft_year for row in roster}
    draft_picks = {row.player_id: row.draft_pick for row in roster}
    out: dict[str, DiscoveryQuantityValues] = {}
    for player_id in positions:
        scored = scoring.get(player_id)
        ppg = points_per_game(scored)
        if scored is None or ppg is None:
            continue
        participated = participation.get(player_id)
        team = teams.get(player_id)
        coach = None if team is None else coach_facts.get(team)
        usage_agg = usage.get(player_id)
        draft_year = draft_years.get(player_id)
        win_total = None if team is None else win_totals.get(team)
        wins = None if team is None else actual_wins.get(team)
        snap_counts = snaps.get(player_id)
        team_air = None if team is None else team_air_yards.get(team)
        out[player_id] = DiscoveryQuantityValues(
            touches=None if participated is None else participated.carries + scored.receptions,
            age=age_at_season(birth_dates.get(player_id), season),
            target_share=target_share_of(participated),
            touchdown_points_share=scored.touchdown_points / scored.points if scored.points > 0 else None,
            red_zone_touch_share=_band_share(usage_agg, lambda u: u.red_zone_touches),
            target_depth=_target_depth(usage_agg),
            snap_share=snap_counts[0] / snap_counts[1] if snap_counts is not None and snap_counts[1] > 0 else None,
            incoming_coach_tenure_seasons=None if coach is None else coach.tenure_seasons,
            incoming_coach_prior_pass_rate_over_expected=None if coach is None else coach.prior_pass_rate_over_expected,
            experience_year=None if draft_year is None else season - draft_year + 1,
            team_pace_seconds_per_play=None if team is None else pace.get(team),
            incoming_team_win_total=win_total,
            incoming_team_win_total_delta=None if win_total is None or wins is None else win_total - wins,
            inside_ten_touch_share=_band_share(usage_agg, lambda u: u.inside_ten_touches),
            team_air_yards_share=(
                usage_agg.air_yards / team_air
                if usage_agg is not None and usage_agg.has_pbp_evidence and team_air is not None and team_air > 0
                else None
            ),
            games_played=scored.games,
            draft_pick=draft_picks.get(player_id),
            points_per_game=ppg,
        )
    return out


def discovery_facts_for_season(  # noqa: PLR0913, PLR0917 - the oracle's own parameters, in its order, for a line-by-line read
    conn: Connection,
    season: int,
    positions: Mapping[str, Position],
    rules: ScoringRules,
    admit_derived: bool,
    incoming_as_of: datetime,
) -> dict[str, DiscoveryFacts]:
    """`discoveryFactsForSeason`."""
    as_of = schedule_published_as_of(season + 1)
    current = _quantities_for_season(conn, season, as_of, incoming_as_of, positions, rules, admit_derived)
    prior = _quantities_for_season(conn, season - 1, as_of, incoming_as_of, positions, rules, admit_derived)
    out: dict[str, DiscoveryFacts] = {}
    for player_id, values in current.items():
        position = positions.get(player_id)
        if position is None or not is_skill_position(position):
            continue
        out[player_id] = DiscoveryFacts(position, values, prior.get(player_id))
    return out
