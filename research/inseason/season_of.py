"""THE SEASON A WEEKLY PASS WORKS ON: the season whose schedule holds today, read from the store.

Fix round 2 (the review's N3). The pass once took the product season, a constant that moves by hand
once a year; a late move would have every pass of the new season look for last season's weeks, find
none, report "skipped" and exit 0, losing the new register's first freezes with no alert. The season
now comes from the stored nflverse kickoffs: the season whose regular season, opened `LEAD` early
(the week-one freeze) and held `TAIL` late (the last grades), contains the pass's instant. A date no
stored schedule places is a failed pass, naming the newest schedule the store holds.
"""

from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Final

from sqlalchemy import Connection, text

from research.model.instants import js_iso
from research.pipeline.nflverse.schedule import ScheduleMetric, ScheduleSource
from research.season import REGULAR_SEASON_WEEKS

# The week-one freeze runs in the days before the opener.
LEAD: Final = timedelta(days=14)
# The last week grades 36 hours after its games and is overdue four days later.
TAIL: Final = timedelta(days=10)


@dataclass(frozen=True, slots=True)
class SeasonSpan:
    season: int
    first_kickoff: datetime
    last_kickoff: datetime


def season_spans(conn: Connection) -> list[SeasonSpan]:
    rows = conn.execute(
        text(
            "select season, min(as_of) as first, max(as_of) as last from research.team_week_observations "
            "where source = :source and metric = :metric and week between 1 and :weeks group by season order by season"
        ),
        {"source": ScheduleSource.KICKOFF, "metric": ScheduleMetric.KICKOFF_INSTANT, "weeks": REGULAR_SEASON_WEEKS},
    )
    return [SeasonSpan(int(r.season), r.first, r.last) for r in rows]


def placed_season(spans: list[SeasonSpan], now: datetime) -> int | None:
    """The season whose regular season, with its lead and tail, contains `now`, or None."""
    return next((s.season for s in spans if s.first_kickoff - LEAD <= now <= s.last_kickoff + TAIL), None)


def unplaced_reason(spans: list[SeasonSpan], now: datetime) -> str:
    newest = spans[-1] if spans else None
    held = (
        "the store holds no season's kickoffs"
        if newest is None
        else f"the newest stored schedule is {newest.season}, {js_iso(newest.first_kickoff)} to {js_iso(newest.last_kickoff)}"
    )
    return (
        f"no stored schedule places {js_iso(now)}: {held}. Ingest the season's schedule "
        "(python -m research.pipeline preseason) or pass --season."
    )
