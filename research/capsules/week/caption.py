"""THE READ'S CAPTIONS ON THE PAGE (Lane 66h): when it was written, in Central time, and the week it is for;
and, for a read his status has moved past, when the new one is due.

"Written Fri Oct 16, 9:00 pm CT, for week 6", the page's one stamp format (Lane 139, C12). The status read
it stands on is not named here: the run is built once a night, so a stamp baked into it was thirteen hours old at
the Sunday 1 pm games (Lane 222, B186); the web names the status read its own build took, and the next one
(`web/src/lib/player/read-byline.ts`), from `designations.json` and the run's schedule. A read written
against another status than his current one stays on the page under "His status changed since this read was
written. A new read is due by Sun Oct 18, 1:00 am CT." (the re-review's F5; Lane 275, the founder 2026-10-28:
"we should always show a read"): the hourly pass after the status capture writes the new one (`HOURLY_PASS_HOURS_ET`, the capture's schedule in `infra/research-schedule.sh`).
"""

from datetime import datetime, time, timedelta
from typing import Final
from zoneinfo import ZoneInfo

from research.capsules.week.rollover import next_nightly
from research.capsules.week.sheet import CENTRAL, central_stamp

EASTERN: Final = ZoneInfo("America/New_York")
# The hourly capture's hours, Eastern (`research-capture-harvest`, "0 0,2,6-23 * * *" America/New_York): the
# hourly week-reads pass runs at the end of each (the web's `player/status-held.ts` mirrors them).
HOURLY_PASS_HOURS_ET: Final = (0, 2, *range(6, 24))


def written_caption(written_at: datetime, week: int) -> str:
    """The caption for a read written at `written_at` for `week`, in the page's one stamp format (Lane 139,
    C12)."""
    return f"Written {central_stamp(written_at)}, for week {week}"


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


def first_pass_of_next_day(as_of: datetime) -> datetime:
    """The first pass, hourly or nightly, on the Central day after `as_of`'s: when a read whose status rewrites
    are spent for the day (`cadence.status_rewrite_capped`) is asked again."""
    midnight = datetime.combine(as_of.astimezone(CENTRAL).date() + timedelta(days=1), time(), CENTRAL)
    return min(next_hourly_pass(midnight), next_nightly(midnight))


def status_changed_caption(as_of: datetime, capped: bool = False) -> str:
    """The caption over a week read his status has moved past, with the next write: the next hourly pass, or,
    once the day's status rewrites are spent (`capped`, Lane 275 fix round 2), the next day's first pass."""
    due = central_stamp(first_pass_of_next_day(as_of) if capped else next_hourly_pass(as_of))
    return f"His status changed since this read was written. A new read is due by {due}."


# The words a web build before Lane 274 shows over a read whose published projection moved (Lane 66v). The run
# no longer withholds such a read (Lane 275): it carries these words only for that web, and they go once no web
# reads `movedCaption`.
PROJECTION_MOVED_CAPTION: Final = "The published projection moved since this read was written."
