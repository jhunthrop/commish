"""HIS PLACE ON THIS WEEK'S DEPTH CHART: the newest weekly chart his club had released by the write (Lane 299).

The sheet had read the season capsule's depth chart (`capsules.facts.depth_reads.depth_slots_for`), which is the
week-one chart taken on the eve of the first kickoff, so in week 8 every read stated a September order as this
week's: "Rachaad White's second job behind Jacory Croskey-Merritt" when Washington's week 8 chart listed him
first. The week sheet now reads the weekly charts (`nflverse_depth_chart_weeks`, from 2025 the dated snapshots)
that the in-season pass loads: for each club and position, the chart of the latest week it was released for, up
to the sheet's week, loaded by the write, and on it each player's best place at his position (the chart ranks a
position across its slots, "WR_1", "WR_2"). A player his club's current chart leaves off has no place: no read
says where he sits. Only before any weekly chart is loaded (the preseason) does the week-one chart stand in.
"""

from collections import defaultdict
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Final

from sqlalchemy import Connection, text

from research.capsules.week.sheet import DepthPlace
from research.pipeline.nflverse.team_codes import product_team_code

# The teammates the sheet names around him, as the capsule's chart does (`depth_role._MAX_NEIGHBORS`).
MAX_AROUND: Final = 4


@dataclass(frozen=True, slots=True)
class WeeklyChart:
    """One club's chart at one position: its release and each listed player's (id, name, place), best first."""

    released_at: datetime
    listed: tuple[tuple[str, str, int], ...]


def charts_from_rows(
    rows: Sequence[tuple[str, str, int, str, str, int, datetime]],
) -> dict[tuple[str, str], WeeklyChart]:
    """Each (club, position)'s chart from rows of (club, position, week, player id, name, place, loaded): the
    latest week's latest load, each player at his best place on it."""
    newest: dict[tuple[str, str], tuple[int, datetime]] = {}
    for team, position, week, _pid, _name, _place, loaded in rows:
        key = (product_team_code(team), position)
        if key not in newest or (week, loaded) > newest[key]:
            newest[key] = (week, loaded)
    best: dict[tuple[str, str], dict[str, tuple[str, int]]] = defaultdict(dict)
    for team, position, week, pid, name, place, loaded in rows:
        key = (product_team_code(team), position)
        if newest[key] != (week, loaded):
            continue
        held = best[key].get(pid)
        if held is None or place < held[1]:
            best[key][pid] = (name, place)
    return {
        key: WeeklyChart(
            newest[key][1],
            tuple(sorted(((pid, name, place) for pid, (name, place) in listed.items()), key=lambda r: (r[2], r[0]))),
        )
        for key, listed in best.items()
    }


def weekly_charts(conn: Connection, season: int, week: int, as_of: datetime) -> dict[tuple[str, str], WeeklyChart]:
    """Every club's newest weekly chart by position, for weeks up to `week`, loaded by `as_of`."""
    rows = conn.execute(
        text(
            "select c.team, c.position, c.week, c.player_id, coalesce(p.name, c.player_id) as name, c.depth_order, "
            "c.as_of from research.nflverse_depth_chart_weeks c left join research.players p on p.id = c.player_id "
            "where c.season = :s and c.week <= :w and c.as_of <= :at"
        ),
        {"s": season, "w": week, "at": as_of},
    ).all()
    return charts_from_rows([(r.team, r.position, r.week, r.player_id, r.name, r.depth_order, r.as_of) for r in rows])


def weekly_place(
    charts: Mapping[tuple[str, str], WeeklyChart], club: str, position: str, player_id: str
) -> DepthPlace | None:
    """His place on his club's newest chart at his position, with up to `MAX_AROUND` teammates in its order;
    None when the chart leaves him off or his club has none."""
    chart = charts.get((club, position))
    if chart is None:
        return None
    mine = next((place for pid, _name, place in chart.listed if pid == player_id), None)
    if mine is None:
        return None
    around = tuple((name, float(place)) for pid, name, place in chart.listed if pid != player_id)[:MAX_AROUND]
    return DepthPlace(float(mine), around, chart.released_at)
