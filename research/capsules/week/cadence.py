"""WHEN A WEEK READ IS WRITTEN AGAIN: the roll-over writes every board player's read for the coming week in one
nightly pass (Lane 256, `rollover`), and after it an hourly pass after the status capture and the nightly
rewrite only the reads whose week moved.

- No read for his week yet (the roll-over, or a player new to the board since): `FIRST`, nightly.
- The last one fell to its facts block (the writer could not serve him, or it was demoted for a shared
  sentence): `UNWRITTEN`, nightly, and at most once an hour and three times a Central day (`RETRY_GAP`,
  `RETRIES_A_DAY`), so a read that keeps failing never spends a day's budget. Within the roll-over pass a
  fallen read is asked again at once (`nightly.week_reads.ROLLOVER_ROUNDS`).
- His status changed since it was written (Lane 63's capture marks it): `STATUS_CHANGED`, nightly and hourly.
- The published projection the card prints moved past the Proj change tile's threshold (the page's serve rule,
  `projection_moved_past_shown`; Lane 256: a move by a tenth rewrote 330 reads on the night of 2026-10-21 and 263
  on 2026-10-23, the whole board mid-week, so a smaller move keeps the read the roll-over wrote, and the Wk tile's
  "Proj at the read" says the figure it was written with): `PROJECTION_MOVED`, nightly only (the page is
  prerendered, so an hourly rewrite would not be seen before the nightly's; the page withholds the moved read
  meanwhile).

Anything else (a new forecast, a new depth chart) waits for one of those, so a quiet week costs nothing.
"""

from datetime import date, datetime, timedelta
from typing import Final

from research.capsules.page_figures import projection_tenth
from research.capsules.store import WRITTEN_SOURCE
from research.capsules.week.cells import SHOWN_CHANGE_FROM
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


# Tenths in a point: the card's figures are whole tenths, so the serve rule compares them as integers.
_TENTHS: Final = 10


def projection_moved_past_shown(now: float | None, then: float | None) -> bool:
    """Whether the card's published projection (`now`) has moved from a read's (`then`) by the Proj change
    tile's threshold (`cells.SHOWN_CHANGE_FROM`, Lane 162, D04): the page's serve rule, so a move the tile
    calls "under 0.5" never withholds the read (the web's `card.ts projectionMoved`). A figure that appeared
    or went is a move. The rewrite follows the same threshold (Lane 256), so a smaller move keeps the read."""
    if now is None or then is None:
        return (now is None) != (then is None)
    moved = abs(round(projection_tenth(now) * _TENTHS) - round(projection_tenth(then) * _TENTHS))
    return moved >= round(SHOWN_CHANGE_FROM * _TENTHS)


def _projection_moved(sheet: WeekSheet, stored: StoredWeekRead) -> bool:
    now = None if sheet.projection is None else sheet.projection.points
    return projection_moved_past_shown(now, stored.projection_points)


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
