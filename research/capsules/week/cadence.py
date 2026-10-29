"""WHEN A WEEK READ IS WRITTEN AGAIN: the roll-over writes every board player's read for the coming week in one
nightly pass (Lane 256, `rollover`), and after it an hourly pass after the status capture and the nightly
rewrite only the reads whose week moved.

- No read for his week yet (the roll-over, or a player new to the board since): `FIRST`, nightly.
- The last one fell to its facts block (every writer failed him, or it was demoted for a shared sentence):
  `UNWRITTEN`, nightly and hourly, at most once an hour (`RETRY_GAP`) until one is written (Lane 276), the
  day's hourly dollars the only stop (`nightly.week_reads.HOURLY_DAY_USD`). Within the roll-over pass a
  fallen read is asked again at once (`nightly.week_reads.ROLLOVER_ROUNDS`).
- His status changed since it was written (Lane 63's capture marks it): `STATUS_CHANGED`, nightly and hourly.
  A rewrite that falls keeps the written read (Lane 275 fix round 1, `kept_read`), so its status still differs;
  the status rewrites that fell since that read was written (Lane 293: never a rule-stale one's) are capped at
  `STATUS_REWRITES_A_DAY` a Central day (`status_rewrite_capped`, fix round 2), and a written read's attempts restart at one, so a success never
  spends the next change's tries. A capped read is asked again at the first pass of the next Central day.
- The written read breaks a rule the writer holds reads to now (`RULE_STALE`, Lane 275 fix round 1: a read
  written while the rules asked for the published projection names it; Lane 286: every rule of the body alone,
  `rules.body_rule_violations`, so a read that says "your roster" is written again), nightly only and at most
  once a Central day, after every other reason; a rewrite that falls keeps the old read shown.

The read stands through a move of the published projection (Lane 275, the founder 2026-10-28: "it's normal for
the projection to change on fantasy sites without the read changing"). The read never states the projection
(`rules`, H4), so a move leaves nothing in it wrong; the card's Wk cell prints the live figure and its "Proj at
the read" the one the read was written with (`StoredWeekRead.projection_points`, still stored). Rewriting on a
move had rewritten the whole board mid-week (330 reads on the night of 2026-10-21, Lane 256) and hid reads
behind a withhold until the nightly.

- The written read states a fact tonight's sheet does not bear out (`FACT_STALE`, Lane 299,
  `fact_rules.fact_violations`): his place on this week's depth chart (a read written from the week-one chart, or
  whose place has moved since), a game's figure tied to the wrong week, a kickoff forecast that has moved, an
  undated Opp rank or his points a game the cells no longer print. Nightly only, at most once a Central day, ahead
  of the rule-stale ones; a rewrite that falls keeps the old read shown. Week 8's charts moved 4 to 13 board
  players' places a night after the roll-over, and a few dozen reads quote a forecast figure before a game day,
  so about $0.10 to $0.15 a night with the rounds once the backlog is written.

Anything else (a new projection, a forecast no read quotes, a chart that moves no place a read states) waits for
one of those, so a quiet week costs nothing.
"""

from dataclasses import replace
from datetime import date, datetime, timedelta
from typing import Final

from research.capsules.store import WRITTEN_SOURCE
from research.capsules.week.fact_rules import fact_violations
from research.capsules.week.rules import body_rule_violations
from research.capsules.week.sheet import CENTRAL, WeekSheet
from research.capsules.week.store import StoredWeekRead

RETRY_GAP: Final = timedelta(hours=1)
# Lane 276 (the founder, 2026-10-28: "we should always show a read"): a fallen read is asked every hour of a
# Central day, so the count is the day's hours and the gap and the dollars are what hold it. The worst day: a
# read may spend its six asks (the writer's and the judge's) and the retry writer's draft with the judge's ask on
# it: 6 x (9,000 x $0.15 + 600 x $0.50) / 1M = $0.0099, plus (9,000 x $0.075 + 600 x $0.30) / 1M = $0.0009 and a
# judge's ask of about $0.0004, so $0.011. A pass admits a read at two asks (`week_reads.worst_read_usd`); the
# gateway's reservation, not that check, holds a read in flight to the rest. With the whole board of 536 fallen,
# 536 x 20 passes (the capture's hours) x $0.011 = $118 asked, which the hourly pass's $0.05 and the retries'
# share of the day hold to $0.50 (`week_reads.HOURLY_DAY_USD` $1.50, unchanged, less the status share
# `HOURLY_STATUS_RESERVE_USD` $1.00 the retries never draw on). The day expected: about 2 reads in 100 fall on
# the roll-over night, 11 of 536, at the dearest night's $0.0021 a read for 20 passes, $0.46.
RETRIES_A_DAY: Final = 24
# A written read's status rewrites that fell (Lane 275 fix round 2), its own cap: a held read's row keeps its
# written instant, so no gap holds its rewrites to one an hour, and the quarter-hour game-day passes would ask it
# up to four times an hour under the retries' 24 (Lane 276 merge). Lane 275's three a Central day stands.
STATUS_REWRITES_A_DAY: Final = 3
FIRST: Final = "first"
UNWRITTEN: Final = "unwritten"
STATUS_CHANGED: Final = "status"
RULE_STALE: Final = "rule"
FACT_STALE: Final = "fact"
# The order a nightly writes its due reads in, so a budget stop leaves the rule-stale rewrites for the next night.
PRIORITY: Final = (FIRST, UNWRITTEN, STATUS_CHANGED, FACT_STALE, RULE_STALE)
# What an hourly pass writes: the reads whose status moved (the coordinator's M3), and a read still unwritten,
# asked every hour until one is written (Lane 276).
HOURLY_REASONS: Final = frozenset({STATUS_CHANGED, UNWRITTEN})


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
    return stored.source == WRITTEN_SOURCE and falls_since_written(stored, now) >= STATUS_REWRITES_A_DAY


def kept_read(before: StoredWeekRead, at: datetime, *, status_fall: bool = True) -> StoredWeekRead:
    """A written read kept over a rewrite that fell, or was demoted for a shared shape (Lane 275 fix rounds 1
    and 2, the founder: "we should always show a read"): its body, call, status and stamps as written, and `at`'s
    Central day marked attempted (a read written on an earlier day counts its write as one). Only a status
    rewrite's fall (`status_fall`: the read's status differs from his current one) counts one more toward
    `STATUS_REWRITES_A_DAY` (Lane 293 review, H1): a rule-stale rewrite that falls every nightly round leaves the
    day's status rewrites whole, and the day marked keeps it from being due again until the next one."""
    attempts = max(attempts_today(before, at), 1)
    return replace(before, attempt_day=central_day(at), attempts=attempts + status_fall)


def _rule_stale(stored: StoredWeekRead, now: datetime) -> bool:
    """A written read the current rules refuse, not yet attempted on `now`'s Central day. The check is every week
    rule that judges the stored body alone (`rules.body_rule_violations`: H4's projection named, and Lane 286's
    roster addressed, colon opener and rank stated twice among them): the full validator would read today's
    sheet, whose forecast, status and cells have moved since the write, and refuse reads that were right when
    written."""
    return (
        stored.source == WRITTEN_SOURCE
        and attempts_today(stored, now) == 0
        and bool(body_rule_violations(stored.body, stored.season))
    )


def _fact_stale(sheet: WeekSheet, stored: StoredWeekRead, now: datetime) -> bool:
    """A written read tonight's sheet no longer bears out, not yet attempted on `now`'s Central day (Lane 299)."""
    return (
        stored.source == WRITTEN_SOURCE
        and attempts_today(stored, now) == 0
        and bool(fact_violations(stored.body, sheet))
    )


def due_reason(sheet: WeekSheet, stored: StoredWeekRead | None, now: datetime, *, hourly: bool = False) -> str | None:
    """Why `sheet`'s read is written at `now`, or None when the stored read for his week stands."""
    if stored is None or stored.season != sheet.season or stored.week != sheet.week:
        reason: str | None = FIRST
    elif stored.status != sheet.status.status:
        reason = None if status_rewrite_capped(stored, now) else STATUS_CHANGED
    elif stored.source != WRITTEN_SOURCE and _retry_allowed(stored, now):
        reason = UNWRITTEN
    elif _fact_stale(sheet, stored, now):
        reason = FACT_STALE
    elif _rule_stale(stored, now):
        reason = RULE_STALE
    else:
        reason = None
    return reason if not hourly or reason in HOURLY_REASONS else None
