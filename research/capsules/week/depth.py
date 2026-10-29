"""HIS PLACE ON THIS WEEK'S DEPTH CHART: the newest weekly chart his club had released by the write (Lane 299).

The sheet had read the season capsule's depth chart (`capsules.facts.depth_reads.depth_slots_for`), which is the
week-one chart taken on the eve of the first kickoff, so in week 8 every read stated a September order as this
week's: "Rachaad White's second job behind Jacory Croskey-Merritt" when Washington's week 8 chart listed him
first. The week sheet now reads the weekly charts (`nflverse_depth_chart_weeks`, from 2025 the dated snapshots)
that the in-season pass loads: for each club and position, the newest snapshot loaded by the write, whatever week
the ingest filed it under (a club on its bye has its snapshot after its last game filed under its next game's week,
the Lane 299 review's M1), and on it each player's best place at his position (the chart ranks a
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
    newest load (the later week on a tie), each player at his best place on it."""
    newest: dict[tuple[str, str], tuple[datetime, int]] = {}
    for team, position, week, _pid, _name, _place, loaded in rows:
        key = (product_team_code(team), position)
        if key not in newest or (loaded, week) > newest[key]:
            newest[key] = (loaded, week)
    best: dict[tuple[str, str], dict[str, tuple[str, int]]] = defaultdict(dict)
    for team, position, week, pid, name, place, loaded in rows:
        key = (product_team_code(team), position)
        if newest[key] != (loaded, week):
            continue
        held = best[key].get(pid)
        if held is None or place < held[1]:
            best[key][pid] = (name, place)
    return {
        key: WeeklyChart(
            newest[key][0],
            tuple(sorted(((pid, name, place) for pid, (name, place) in listed.items()), key=lambda r: (r[2], r[0]))),
        )
        for key, listed in best.items()
    }


def weekly_charts(conn: Connection, season: int, as_of: datetime) -> dict[tuple[str, str], WeeklyChart]:
    """Every club's newest weekly chart by position loaded by `as_of`: the newest snapshot is found in the store
    (the review's L7), so a pass reads one snapshot a room, never the season's history."""
    rows = conn.execute(
        text(
            "with newest as (select distinct on (team, position) team, position, week, as_of "
            "from research.nflverse_depth_chart_weeks where season = :s and as_of <= :at "
            "order by team, position, as_of desc, week desc) "
            "select c.team, c.position, c.week, c.player_id, coalesce(p.name, c.player_id) as name, c.depth_order, "
            "c.as_of from research.nflverse_depth_chart_weeks c join newest n on n.team = c.team "
            "and n.position = c.position and n.week = c.week and n.as_of = c.as_of "
            "left join research.players p on p.id = c.player_id where c.season = :s"
        ),
        {"s": season, "at": as_of},
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
