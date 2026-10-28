"""WHEN A WEEK READ IS WRITTEN AGAIN: the roll-over writes every board player's read for the coming week in one
nightly pass (Lane 256, `rollover`), and after it an hourly pass after the status capture and the nightly
rewrite only the reads whose week moved.

- No read for his week yet (the roll-over, or a player new to the board since): `FIRST`, nightly.
- The last one fell to its facts block (the writer could not serve him, or it was demoted for a shared
  sentence): `UNWRITTEN`, nightly, and at most once an hour and three times a Central day (`RETRY_GAP`,
  `RETRIES_A_DAY`), so a read that keeps failing never spends a day's budget. Within the roll-over pass a
  fallen read is asked again at once (`nightly.week_reads.ROLLOVER_ROUNDS`).
- His status changed since it was written (Lane 63's capture marks it): `STATUS_CHANGED`, nightly and hourly.
  A rewrite that falls keeps the written read (Lane 275 fix round 1, `kept_read`), so its status still differs;
  the rewrites that fell since that read was written are capped at `RETRIES_A_DAY` a Central day
  (`status_rewrite_capped`, fix round 2), and a written read's attempts restart at one, so a success never
  spends the next change's tries. A capped read is asked again at the first pass of the next Central day.
- The written read breaks a rule the writer holds reads to now (`RULE_STALE`, Lane 275 fix round 1: a read
  written while the rules asked for the published projection names it, `rules.names_the_projection`), nightly
  only and at most once a Central day, after every other reason; a rewrite that falls keeps the old read shown.

The read stands through a move of the published projection (Lane 275, the founder 2026-10-28: "it's normal for
the projection to change on fantasy sites without the read changing"). The read never states the projection
(`rules`, H4), so a move leaves nothing in it wrong; the card's Wk cell prints the live figure and its "Proj at
the read" the one the read was written with (`StoredWeekRead.projection_points`, still stored). Rewriting on a
move had rewritten the whole board mid-week (330 reads on the night of 2026-10-21, Lane 256) and hid reads
behind a withhold until the nightly.

Anything else (a new projection, a new forecast, a new depth chart) waits for one of those, so a quiet week
costs nothing.
"""

from dataclasses import replace
from datetime import date, datetime, timedelta
from typing import Final

from research.capsules.store import WRITTEN_SOURCE
from research.capsules.week.rules import names_the_projection
from research.capsules.week.sheet import CENTRAL, WeekSheet
from research.capsules.week.store import StoredWeekRead

RETRY_GAP: Final = timedelta(hours=1)
RETRIES_A_DAY: Final = 3
FIRST: Final = "first"
UNWRITTEN: Final = "unwritten"
STATUS_CHANGED: Final = "status"
RULE_STALE: Final = "rule"
# The order a nightly writes its due reads in, so a budget stop leaves the rule-stale rewrites for the next night.
PRIORITY: Final = (FIRST, UNWRITTEN, STATUS_CHANGED, RULE_STALE)
# What an hourly pass writes: only the reads whose status moved (the coordinator's M3).
HOURLY_REASONS: Final = frozenset({STATUS_CHANGED})


def central_day(instant: datetime) -> date:
    return instant.astimezone(CENTRAL).date()


def attempts_today(stored: StoredWeekRead | None, now: datetime) -> int:
    """The attempts the stored row counts on `now`'s Central day."""
    return 0 if stored is None or stored.attempt_day != central_day(now) else stored.attempts


def _retry_allowed(stored: StoredWeekRead, now: datetime) -> bool:
    return stored.written_at <= now - RETRY_GAP and attempts_today(stored, now) < RETRIES_A_DAY


def falls_since_written(stored: StoredWeekRead, now: datetime) -> int:
    """The rewrites that fell since a written read was written, on `now`'s Central day: a written row counts its
    write as its one attempt (`nightly.week_reads.stored_row`) and each fallen rewrite after it (`kept_read`)."""
    return max(0, attempts_today(stored, now) - 1)


def status_rewrite_capped(stored: StoredWeekRead, now: datetime) -> bool:
    """Whether a written read's status rewrites are spent for `now`'s Central day (Lane 275 fix round 2)."""
    return stored.source == WRITTEN_SOURCE and falls_since_written(stored, now) >= RETRIES_A_DAY


def kept_read(before: StoredWeekRead, at: datetime) -> StoredWeekRead:
    """A written read kept over a rewrite that fell, or was demoted for a shared shape (Lane 275 fix rounds 1
    and 2, the founder: "we should always show a read"): its body, call, status and stamps as written, one more
    fall counted on `at`'s Central day (a read written on an earlier day counts its write as one)."""
    return replace(before, attempt_day=central_day(at), attempts=max(attempts_today(before, at), 1) + 1)


def _rule_stale(stored: StoredWeekRead, now: datetime) -> bool:
    """A written read the current rules refuse, not yet attempted on `now`'s Central day. The check is the rule
    that changed (H4), on the stored body alone: the full validator would read today's sheet, whose forecast
    and status have moved since the write, and refuse reads that were right when written."""
    return stored.source == WRITTEN_SOURCE and attempts_today(stored, now) == 0 and names_the_projection(stored.body)


def due_reason(sheet: WeekSheet, stored: StoredWeekRead | None, now: datetime, *, hourly: bool = False) -> str | None:
    """Why `sheet`'s read is written at `now`, or None when the stored read for his week stands."""
    if stored is None or stored.season != sheet.season or stored.week != sheet.week:
        reason: str | None = FIRST
    elif stored.status != sheet.status.status:
        reason = None if status_rewrite_capped(stored, now) else STATUS_CHANGED
    elif stored.source != WRITTEN_SOURCE and _retry_allowed(stored, now):
        reason = UNWRITTEN
    elif _rule_stale(stored, now):
        reason = RULE_STALE
    else:
        reason = None
    return reason if not hourly or reason in HOURLY_REASONS else None
