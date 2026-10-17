"""WHEN A WEEK READ IS WRITTEN AGAIN: the nightly writes a read for every player on a board, and rewrites
it only when the week in front of him moved.

- No read for his week yet (a new week, or his first): `FIRST`.
- The last one fell to its facts block (the writer could not serve him, or it was demoted for a shared
  sentence): `UNWRITTEN`, retried every night until written.
- His status changed since it was written (Lane 63's capture marks it: a designation added, changed or
  cleared): `STATUS_CHANGED`.
- The published projection moved by more than `PROJECTION_MOVE_POINTS` since it was written:
  `PROJECTION_MOVED`.

Anything else (a new forecast, a new depth chart) waits for one of those, so a quiet week costs nothing.
"""

from typing import Final

from research.capsules.store import WRITTEN_SOURCE
from research.capsules.week.sheet import WeekSheet
from research.capsules.week.store import StoredWeekRead

PROJECTION_MOVE_POINTS: Final = 1.0
FIRST: Final = "first"
UNWRITTEN: Final = "unwritten"
STATUS_CHANGED: Final = "status"
PROJECTION_MOVED: Final = "projection"
REASONS: Final = (FIRST, UNWRITTEN, STATUS_CHANGED, PROJECTION_MOVED)


def _projection_moved(sheet: WeekSheet, stored: StoredWeekRead) -> bool:
    now = None if sheet.projection is None else sheet.projection.points
    then = stored.projection_points
    if now is None or then is None:
        return (now is None) != (then is None)
    return abs(now - then) > PROJECTION_MOVE_POINTS


def due_reason(sheet: WeekSheet, stored: StoredWeekRead | None) -> str | None:
    """Why `sheet`'s read is written tonight, or None when the stored read for his week stands."""
    if stored is None or stored.season != sheet.season or stored.week != sheet.week:
        return FIRST
    if stored.source != WRITTEN_SOURCE:
        return UNWRITTEN
    if stored.status != sheet.status.status:
        return STATUS_CHANGED
    if _projection_moved(sheet, stored):
        return PROJECTION_MOVED
    return None
