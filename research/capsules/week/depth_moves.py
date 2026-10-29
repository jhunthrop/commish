"""HIS DEPTH-CHART MOVE (Lane 300): his place on his club's newest weekly chart against the chart before it.

The depth chart reaches the writer when it moved (`bites.depth_bites`), so the sheet needs the place he held on
the chart his club released before the newest (`week.depth`, Lane 299's weekly charts): for each club and
position, the newest chart week loaded by the write (as `week.depth` reads it, a club on its bye included), and
the latest chart of an earlier week. A player on only one of them has no move.
"""

from collections.abc import Mapping
from datetime import datetime

from sqlalchemy import Connection, text

from research.capsules.week.depth import WeeklyChart, charts_from_rows

_ROWS = text(
    "select team, position, week, player_id, player_id as name, depth_order, as_of "
    "from research.nflverse_depth_chart_weeks where season = :s and as_of <= :at"
)


def _places(chart: WeeklyChart) -> dict[str, int]:
    return {pid: place for pid, _name, place in chart.listed}


def depth_moves(conn: Connection, season: int, as_of: datetime) -> dict[str, float]:
    """Each player's place on the chart before his club's newest, where it differs from his newest place."""
    rows = [
        (r.team, r.position, r.week, r.player_id, r.name, r.depth_order, r.as_of)
        for r in conn.execute(_ROWS, {"s": season, "at": as_of})
    ]
    newest = charts_from_rows(rows)
    newest_week: dict[tuple[str, str], int] = {}
    for team, position, chart_week, *_ in rows:
        key = (team, position)
        newest_week[key] = max(newest_week.get(key, chart_week), chart_week)
    before = charts_from_rows([row for row in rows if row[2] < newest_week[(row[0], row[1])]])
    return _moved(newest, before)


def _moved(
    newest: Mapping[tuple[str, str], WeeklyChart], before: Mapping[tuple[str, str], WeeklyChart]
) -> dict[str, float]:
    out: dict[str, float] = {}
    for key, chart in newest.items():
        prior = before.get(key)
        if prior is None:
            continue
        then = _places(prior)
        for pid, place in _places(chart).items():
            if pid in then and then[pid] != place:
                out[pid] = float(then[pid])
    return out
