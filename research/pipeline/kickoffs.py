"""THE STORED KICKOFFS, per club and week: the instants the schedule ingest wrote (`nflverse_kickoff`,
`kickoff_instant`, stamped at the kickoff itself). The depth chart stamps and the kickoff slots of the
benchmark captures read them, so both agree with the store on when every game starts."""

from dataclasses import dataclass
from datetime import datetime
from typing import Final

from sqlalchemy import Connection, text

from research.db.schema import TEAM_WEEK_OBSERVATIONS
from research.pipeline.nflverse.schedule import ScheduleMetric, ScheduleSource


@dataclass(frozen=True, slots=True)
class TeamKickoff:
    season: int
    week: int
    team: str
    at: datetime


_KICKOFFS: Final = text(
    f"select season, week, team, min(as_of) as at from {TEAM_WEEK_OBSERVATIONS.fullname} "
    "where season = :season and source = :source and metric = :metric group by season, week, team "
    "order by at, team"
)


def stored_kickoffs(conn: Connection, season: int) -> list[TeamKickoff]:
    """Every club-game of `season` with its kickoff, earliest first."""
    params = {"season": season, "source": ScheduleSource.KICKOFF, "metric": ScheduleMetric.KICKOFF_INSTANT}
    return [TeamKickoff(int(r.season), int(r.week), str(r.team), r.at) for r in conn.execute(_KICKOFFS, params)]


def week_bounds(kickoffs: list[TeamKickoff]) -> dict[int, tuple[datetime, datetime]]:
    """Each week's first and last kickoff."""
    bounds: dict[int, tuple[datetime, datetime]] = {}
    for k in kickoffs:
        first, last = bounds.get(k.week, (k.at, k.at))
        bounds[k.week] = (min(first, k.at), max(last, k.at))
    return bounds
