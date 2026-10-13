"""THE POINT-IN-TIME READS OF CLUB FACTS: team observations, who played for whom, kickoffs.

Ported from `research-ts/src/projections/team-store.ts`, with `team-context.ts`'s lookups.
"""

from collections.abc import Callable, Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Final

from sqlalchemy import Connection, text

from research.model.instants import ms_instant
from research.model.reads.observations import Weeks, _week_bounds
from research.pipeline.nflverse.schedule import ScheduleMetric, ScheduleSource
from research.pipeline.observations import PlayerWeekTeam, TeamWeekObservation

_TEAM_OBSERVATIONS_AS_OF: Final = """
select distinct on (week, team, source, metric) season, week, team, source, metric, value, as_of
from research.team_week_observations
where season = :season and week >= :first and week <= :last and as_of <= :as_of {source}
order by week asc, team asc, source asc, metric asc, as_of desc
"""

_PLAYER_TEAMS_AS_OF: Final = """
select distinct on (week, player_id) season, week, player_id, team, as_of
from research.player_week_teams
where season = :season and week >= :first and week <= :last and as_of <= :as_of
order by week asc, player_id asc, as_of desc
"""

_KICKOFFS: Final = """
select week, min(as_of) as earliest from research.team_week_observations
where season = :season and source = :source and metric = :metric {week}
group by week
"""


def team_observations_as_of(
    conn: Connection, season: int, week: Weeks, as_of: datetime, source: str | None = None
) -> list[TeamWeekObservation]:
    """`teamObservationsAsOf`."""
    first, last = _week_bounds(week)
    params: dict[str, object] = {"season": season, "first": first, "last": last, "as_of": as_of}
    clause = ""
    if source is not None:
        clause = "and source = :source"
        params["source"] = source
    rows = conn.execute(text(_TEAM_OBSERVATIONS_AS_OF.format(source=clause)), params)
    return [
        TeamWeekObservation(row.season, row.week, row.team, row.source, row.metric, row.value, ms_instant(row.as_of))
        for row in rows
    ]


def player_teams_as_of(conn: Connection, season: int, week: Weeks, as_of: datetime) -> list[PlayerWeekTeam]:
    """`playerTeamsAsOf`."""
    first, last = _week_bounds(week)
    rows = conn.execute(text(_PLAYER_TEAMS_AS_OF), {"season": season, "first": first, "last": last, "as_of": as_of})
    return [PlayerWeekTeam(row.season, row.week, row.player_id, row.team, ms_instant(row.as_of)) for row in rows]


def kickoff_instants_by_week(conn: Connection, season: int) -> dict[int, datetime]:
    """`kickoffInstantsByWeek`: each week's earliest kickoff instant."""
    params = {"season": season, "source": ScheduleSource.KICKOFF, "metric": ScheduleMetric.KICKOFF_INSTANT}
    rows = conn.execute(text(_KICKOFFS.format(week="")), params)
    return {int(row.week): ms_instant(row.earliest) for row in rows if row.earliest is not None}


def first_kickoff_for(conn: Connection, season: int) -> datetime | None:
    """`firstKickoffFor`: week one's earliest kickoff instant, or None without a schedule."""
    params = {"season": season, "source": ScheduleSource.KICKOFF, "metric": ScheduleMetric.KICKOFF_INSTANT}
    rows = list(conn.execute(text(_KICKOFFS.format(week="and week = 1")), params))
    return ms_instant(rows[0].earliest) if rows and rows[0].earliest is not None else None


@dataclass(frozen=True, slots=True)
class WeekRef:
    season: int
    week: int


@dataclass(frozen=True, slots=True)
class TeamContext:
    """`TeamContext`: who played where, and what was known about each club."""

    player_teams: tuple[PlayerWeekTeam, ...]
    team_observations: tuple[TeamWeekObservation, ...]


TeamMetricLookup = Callable[[str, WeekRef, str], float | None]


def index_team_metrics(context: TeamContext) -> TeamMetricLookup:
    """`indexTeamMetrics`: a later row for the same key overwrites an earlier one."""
    by_key: dict[str, float] = {}
    for row in context.team_observations:
        by_key[f"{row.team}|{row.season}|{row.week}|{row.metric}"] = row.value

    def lookup(team: str, at: WeekRef, metric: str) -> float | None:
        return by_key.get(f"{team}|{at.season}|{at.week}|{metric}")

    return lookup


def context_window(season: int, week: int, last_possible_week: int) -> list[WeekRef]:
    """`contextWindow`: every week of the prior season, then this season's weeks before `week`."""
    prior = [WeekRef(season - 1, index + 1) for index in range(last_possible_week)]
    this = [WeekRef(season, index + 1) for index in range(max(0, week - 1))]
    return [*prior, *this]


def latest_teams(player_teams: Sequence[PlayerWeekTeam]) -> dict[str, str]:
    """`latestTeams`: the team of each player's highest week (seasons are not compared)."""
    latest_week: dict[str, int] = {}
    team: dict[str, str] = {}
    for row in player_teams:
        known = latest_week.get(row.player_id)
        if known is not None and known >= row.week:
            continue
        latest_week[row.player_id] = row.week
        team[row.player_id] = row.team
    return team
