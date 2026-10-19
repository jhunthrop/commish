"""WHEN A WEEK READ IS WRITTEN AGAIN: the nightly writes a read for every player on a board, and an hourly
pass after the status capture rewrites the reads whose week moved.

- No read for his week yet (a new week, or his first): `FIRST`, nightly.
- The last one fell to its facts block (the writer could not serve him, or it was demoted for a shared
  sentence): `UNWRITTEN`, nightly, and at most once an hour and three times a Central day (`RETRY_GAP`,
  `RETRIES_A_DAY`), so a read that keeps failing never spends a day's budget.
- His status changed since it was written (Lane 63's capture marks it): `STATUS_CHANGED`, nightly and hourly.
- The published projection the card prints moved, by any tenth (Lane 66v: a read quotes the card's figure,
  so one it no longer prints is stale): `PROJECTION_MOVED`, nightly only (the page is prerendered, so an
  hourly rewrite would not be seen before the nightly's; the page withholds the moved read meanwhile).

Anything else (a new forecast, a new depth chart) waits for one of those, so a quiet week costs nothing.
"""

from datetime import date, datetime, timedelta
from typing import Final

from research.capsules.page_figures import projection_tenth
from research.capsules.store import WRITTEN_SOURCE
from research.capsules.week.sheet import CENTRAL, WeekSheet
from research.capsules.week.store import StoredWeekRead

RETRY_GAP: Final = timedelta(hours=1)
RETRIES_A_DAY: Final = 3
FIRST: Final = "first"
UNWRITTEN: Final = "unwritten"
STATUS_CHANGED: Final = "status"
PROJECTION_MOVED: Final = "projection"
# What an hourly pass writes: only the reads whose status moved (the coordinator's M3, narrowed by the Lane
# 66v ruling: the page is prerendered, so a projection rewrite is not seen before the nightly writes it).
HOURLY_REASONS: Final = frozenset({STATUS_CHANGED})


def central_day(instant: datetime) -> date:
    return instant.astimezone(CENTRAL).date()


def projection_moved(now: float | None, then: float | None) -> bool:
    """Whether the card's published projection (`now`) prints another figure than the one a read was
    written with (`then`), each read as the card's tenth (a row kept before the tenth was stored too)."""
    if now is None or then is None:
        return (now is None) != (then is None)
    return projection_tenth(now) != projection_tenth(then)


def _projection_moved(sheet: WeekSheet, stored: StoredWeekRead) -> bool:
    return projection_moved(None if sheet.projection is None else sheet.projection.points, stored.projection_points)


def attempts_today(stored: StoredWeekRead | None, now: datetime) -> int:
    """The attempts the stored row counts on `now`'s Central day."""
    return 0 if stored is None or stored.attempt_day != central_day(now) else stored.attempts


def _retry_allowed(stored: StoredWeekRead, now: datetime) -> bool:
    return stored.written_at <= now - RETRY_GAP and attempts_today(stored, now) < RETRIES_A_DAY


def due_reason(sheet: WeekSheet, stored: StoredWeekRead | None, now: datetime, *, hourly: bool = False) -> str | None:
    """Why `sheet`'s read is written at `now`, or None when the stored read for his week stands."""
    if stored is None or stored.season != sheet.season or stored.week != sheet.week:
        reason: str | None = FIRST
    elif stored.status != sheet.status.status:
        reason = STATUS_CHANGED
    elif _projection_moved(sheet, stored):
        reason = PROJECTION_MOVED
    elif stored.source != WRITTEN_SOURCE and _retry_allowed(stored, now):
        reason = UNWRITTEN
    else:
        reason = None
    return reason if not hourly or reason in HOURLY_REASONS else None
