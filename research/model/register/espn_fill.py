"""A FREEZE WITH NO ESPN YARDSTICK TAKES THE FIRST READ BEFORE KICKOFF (Amendment 6, Lane 146).

ESPN's figure is a yardstick, never an input to the order, so a read taken after the order was set
cannot move it; the only thing that differs is ESPN's own number, and the row keeps the read's instant
(`espn_read_at`) beside the freeze's. The week's standing freeze (its latest, the one graded) is filled
only when it kept no ESPN figure on any row, from the first read taken after it and strictly before the
week's first kickoff, and only on its rows whose `espn_points` is NULL. A freeze that kept ESPN's read
is never touched, so a player ESPN did not project on that read stays NULL, and a filled freeze is
never filled again. A read at or after the first kickoff never fills.
"""

from dataclasses import dataclass
from datetime import datetime
from typing import Final

from sqlalchemy import Connection, text

from research.model.instants import js_iso
from research.model.register.freeze import first_espn_read_between
from research.model.register.grade import latest_freeze_for

_KEPT: Final = """
select exists (select 1 from research.register_freeze_rows
               where season = :s and week = :w and frozen_at = :f and espn_points is not null)
"""
_FILL: Final = """
update research.register_freeze_rows f set espn_points = r.ppr_points, espn_read_at = r.read_at
from research.espn_projection_rows r
join research.players p on p.espn_id = r.espn_id
where f.season = :s and f.week = :w and f.frozen_at = :f and f.espn_points is null
  and r.season = :s and r.week = :w and r.read_at = :r and p.id = f.player_id
"""


@dataclass(frozen=True, slots=True)
class EspnFill:
    """What the fill did to a week's standing freeze: the rows filled from the read at `read_at`, or
    why it filled nothing (`reason`, None when it filled)."""

    week: int
    filled: int
    read_at: datetime | None
    reason: str | None


def fill_empty_espn_yardstick(conn: Connection, season: int, week: int, kickoff: datetime) -> EspnFill:
    """Fill the week's standing freeze from the first ESPN read after it and before `kickoff`, if the
    freeze kept no ESPN figure at all."""
    frozen_at = latest_freeze_for(conn, season, week)
    if frozen_at is None:
        return EspnFill(week, 0, None, f"no freeze holds week {week} yet")
    kept = conn.execute(text(_KEPT), {"s": season, "w": week, "f": frozen_at}).scalar_one()
    if kept:
        return EspnFill(week, 0, None, f"the freeze at {js_iso(frozen_at)} kept ESPN's read")
    read = first_espn_read_between(conn, season, week, frozen_at, kickoff)
    if read.read_at is None:
        return EspnFill(
            week,
            0,
            None,
            f"no ESPN read after the freeze at {js_iso(frozen_at)} and before the first kickoff {js_iso(kickoff)}",
        )
    filled = conn.execute(text(_FILL), {"s": season, "w": week, "f": frozen_at, "r": read.read_at}).rowcount
    if not filled:
        return EspnFill(week, 0, read.read_at, f"the read at {js_iso(read.read_at)} lists no player the freeze holds")
    return EspnFill(week, filled, read.read_at, None)
