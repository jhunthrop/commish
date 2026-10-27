"""THE SEASON A WEEKLY PASS WORKS ON: the season whose schedule holds today, read from the store.

Fix round 2 (the review's N3). The pass once took the product season, a constant that moves by hand
once a year; a late move would have every pass of the new season look for last season's weeks, find
none, report "skipped" and exit 0, losing the new register's first freezes with no alert. The season
now comes from the stored nflverse kickoffs: the season whose regular season, opened `LEAD` early
(the week-one freeze) and held `TAIL` late (the last grades), contains the pass's instant. A date no
stored schedule places is a failed pass, naming the newest schedule the store holds.

Fix round 3 (the review's R1): the weekly crons fire September through February, and a season's
stored schedule closes ten days after its last kickoff, so most of January and February sits between
a closed season and the next. The pass then reports its season `closed` (or, early in September,
`not open yet`) and exits 0. It fails only when the season the calendar names (the year of a date
from September on, the year before for January to August) has no stored schedule at all, which is
the late-ingest case N3 exists for.
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
# The last week grades once its games' stats are in (Lane 244) and is overdue four days after its last kickoff.
TAIL: Final = timedelta(days=10)
# A season is named by the year its September falls in.
SEASON_START_MONTH: Final = 9


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


def calendar_season(now: datetime) -> int:
    """The season a date belongs to on the calendar: September on is that year's, earlier the year before."""
    return now.year if now.month >= SEASON_START_MONTH else now.year - 1


def stored_span(spans: list[SeasonSpan], season: int) -> SeasonSpan | None:
    return next((span for span in spans if span.season == season), None)


def out_of_window_reason(span: SeasonSpan, now: datetime) -> str:
    """Why a date the calendar's stored season does not place is no pass to make."""
    if now < span.first_kickoff - LEAD:
        return (
            f"the {span.season} register opens {js_iso(span.first_kickoff - LEAD)}, two weeks before its first kickoff"
        )
    return (
        f"the {span.season} register is closed: its last week kicked off {js_iso(span.last_kickoff)} and graded by then"
    )


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
