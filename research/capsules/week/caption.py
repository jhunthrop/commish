"""THE READ'S CAPTIONS ON THE PAGE (Lane 66h): when it was written, in Central time, and the week it is for;
and, for a read his status has moved past, when the new one is due.

"Written Fri Oct 16, 9:00 pm CT, for week 6", the page's one stamp format (Lane 139, C12), with the status
read the run serves it against when that is newer ("Status read again ..., no change", C13). A read written
against another status than his current one is withheld behind "His status changed since this read was
written. A new read is due by Sun Oct 18, 1:00 am CT." (the re-review's F5): the hourly pass after the
status capture writes it (`HOURLY_PASS_HOURS_ET`, the capture's schedule in `infra/research-schedule.sh`).
"""

from datetime import datetime, time, timedelta
from typing import Final
from zoneinfo import ZoneInfo

from research.capsules.week.sheet import central_stamp

EASTERN: Final = ZoneInfo("America/New_York")
# The hourly capture's hours, Eastern (`research-capture-harvest`, "0 2,6-23 * * *" America/New_York): the
# hourly week-reads pass runs at the end of each.
HOURLY_PASS_HOURS_ET: Final = (2, *range(6, 24))


def written_caption(written_at: datetime, week: int, status_read: datetime | None = None) -> str:
    """The caption for a read written at `written_at` for `week`, in the page's one stamp format (Lane 139,
    C12). With the status read the run serves it against (`status_read`) newer than the write, it says so
    (C13): a read whose status moved is withheld (`status_changed_caption`), so the newer read found none."""
    written = f"Written {central_stamp(written_at)}, for week {week}"
    if status_read is None or status_read <= written_at:
        return written
    return f"{written}. Status read again {central_stamp(status_read)}, no change"


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
    due = central_stamp(next_hourly_pass(as_of))
    return f"His status changed since this read was written. A new read is due by {due}."


# A read whose published projection the card no longer prints (Lane 66v): withheld at the run's build, and
# on the page once the card's live read prints another figure, the season read showing beneath it.
PROJECTION_MOVED_CAPTION: Final = "The published projection moved since this read was written."
