"""HIS DEPTH-CHART MOVE (Lane 300): his place on his club's newest weekly chart against the chart before it.

The depth chart reaches the writer when it moved (`bites.depth_bites`), and the line says the move
(`render._depth_line`), so the sheet needs the place he held on the chart his club released before the newest
(`week.depth`, Lane 299's weekly charts). One snapshot a room each, as `week.depth.weekly_charts` reads them (the
Lane 299 review's L7, this lane's review M3): for each club and position the newest snapshot loaded by the write
(a club on its bye files it under the next week), and the newest snapshot of an earlier week. Each player's
place is his best on each, kept by (player, position) so a back listed at RB and FB is never compared across
the two (review L6). A player on only one of them has no move.
"""

from collections.abc import Mapping
from datetime import datetime

from sqlalchemy import Connection, text

_ROWS = text(
    "with newest as (select distinct on (team, position) team, position, week, as_of "
    "from research.nflverse_depth_chart_weeks where season = :s and as_of <= :at "
    "order by team, position, as_of desc, week desc), "
    "prior as (select distinct on (c.team, c.position) c.team, c.position, c.week, c.as_of "
    "from research.nflverse_depth_chart_weeks c join newest n on n.team = c.team and n.position = c.position "
    "where c.season = :s and c.as_of <= :at and c.week < n.week "
    "order by c.team, c.position, c.as_of desc, c.week desc), "
    "picked as (select team, position, week, as_of, true as newest from newest "
    "union all select team, position, week, as_of, false from prior) "
    "select c.position, c.player_id, p.newest, min(c.depth_order) as place "
    "from research.nflverse_depth_chart_weeks c join picked p on p.team = c.team and p.position = c.position "
    "and p.week = c.week and p.as_of = c.as_of where c.season = :s "
    "group by c.position, c.player_id, p.newest"
)

PlayerPosition = tuple[str, str]


def depth_moves(conn: Connection, season: int, as_of: datetime) -> dict[PlayerPosition, float]:
    """Each (player, position)'s place on the chart before his club's newest, where it differs from his newest."""
    newest: dict[PlayerPosition, float] = {}
    before: dict[PlayerPosition, float] = {}
    for row in conn.execute(_ROWS, {"s": season, "at": as_of}):
        (newest if row.newest else before)[(str(row.player_id), str(row.position))] = float(row.place)
    return moved(newest, before)


def moved(
    newest: Mapping[PlayerPosition, float], before: Mapping[PlayerPosition, float]
) -> dict[PlayerPosition, float]:
    """His place before, for each (player, position) on both charts whose place changed."""
    return {key: before[key] for key, place in newest.items() if key in before and before[key] != place}
