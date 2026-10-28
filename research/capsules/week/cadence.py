"""WHEN A WEEK READ IS WRITTEN AGAIN: the roll-over writes every board player's read for the coming week in one
nightly pass (Lane 256, `rollover`), and after it an hourly pass after the status capture and the nightly
rewrite only the reads whose week moved.

- No read for his week yet (the roll-over, or a player new to the board since): `FIRST`, nightly.
- The last one fell to its facts block (the writer could not serve him, or it was demoted for a shared
  sentence): `UNWRITTEN`, nightly, and at most once an hour and three times a Central day (`RETRY_GAP`,
  `RETRIES_A_DAY`), so a read that keeps failing never spends a day's budget. Within the roll-over pass a
  fallen read is asked again at once (`nightly.week_reads.ROLLOVER_ROUNDS`).
- His status changed since it was written (Lane 63's capture marks it): `STATUS_CHANGED`, nightly and hourly.

The read stands through a move of the published projection (Lane 275, the founder 2026-10-28: "it's normal for
the projection to change on fantasy sites without the read changing"). The read never states the projection
(`rules`, H4), so a move leaves nothing in it wrong; the card's Wk cell prints the live figure and its "Proj at
the read" the one the read was written with (`StoredWeekRead.projection_points`, still stored). Rewriting on a
move had rewritten the whole board mid-week (330 reads on the night of 2026-10-21, Lane 256) and hid reads
behind a withhold until the nightly.

Anything else (a new projection, a new forecast, a new depth chart) waits for one of those, so a quiet week
costs nothing.
"""

from datetime import date, datetime, timedelta
from typing import Final

from research.capsules.store import WRITTEN_SOURCE
from research.capsules.week.sheet import CENTRAL, WeekSheet
from research.capsules.week.store import StoredWeekRead

RETRY_GAP: Final = timedelta(hours=1)
RETRIES_A_DAY: Final = 3
FIRST: Final = "first"
UNWRITTEN: Final = "unwritten"
STATUS_CHANGED: Final = "status"
# What an hourly pass writes: only the reads whose status moved (the coordinator's M3).
HOURLY_REASONS: Final = frozenset({STATUS_CHANGED})


def central_day(instant: datetime) -> date:
    return instant.astimezone(CENTRAL).date()


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
    elif stored.source != WRITTEN_SOURCE and _retry_allowed(stored, now):
        reason = UNWRITTEN
    else:
        reason = None
    return reason if not hourly or reason in HOURLY_REASONS else None
