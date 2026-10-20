"""THE READ'S CAPTIONS ON THE PAGE (Lane 66h): when it was written, in Central time, and the week it is for;
and, for a read his status has moved past, when the new one is due.

"Written Fri 9:00 pm Central, for week 6". The page prints it under the read, so a reader knows its age
and its week without a date (copy rule: things are placed by week, never by a month). A read written
against another status than his current one is withheld behind "His status changed since this read was
written. A new read is due by Sun 1:00 am Central." (the re-review's F5): the hourly pass after the
status capture writes it (`HOURLY_PASS_HOURS_ET`, the capture's schedule in `infra/research-schedule.sh`).
"""

from datetime import datetime, time, timedelta
from typing import Final
from zoneinfo import ZoneInfo

from research.capsules.week.sheet import central_day_and_time

EASTERN: Final = ZoneInfo("America/New_York")
# The hourly capture's hours, Eastern (`research-capture-harvest`, "0 2,6-23 * * *" America/New_York): the
# hourly week-reads pass runs at the end of each.
HOURLY_PASS_HOURS_ET: Final = (2, *range(6, 24))


def written_caption(written_at: datetime, week: int) -> str:
    """The caption for a read written at `written_at` for `week`."""
    return f"Written {central_day_and_time(written_at, short=True)} Central, for week {week}"


def next_hourly_pass(after: datetime) -> datetime:
    """The first hourly pass strictly after `after`."""
    local = after.astimezone(EASTERN)
    for day in range(2):
        date = local.date() + timedelta(days=day)
        for hour in HOURLY_PASS_HOURS_ET:
            at = datetime.combine(date, time(hour), EASTERN)
            if at > local:
                return at
    raise AssertionError("unreachable: every day has a pass")


def status_changed_caption(as_of: datetime) -> str:
    """The caption over the season read when his status moved past the week read, with the next write."""
    due = central_day_and_time(next_hourly_pass(as_of), short=True)
    return f"His status changed since this read was written. A new read is due by {due} Central."


# A read whose published projection the card no longer prints (Lane 66v): withheld at the run's build, and
# on the page once the card's live read prints another figure, the season read showing beneath it.
PROJECTION_MOVED_CAPTION: Final = "The published projection moved since this read was written."
