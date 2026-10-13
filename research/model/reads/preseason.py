"""THE PRESEASON STORE'S READS: week-one rosters, published rankings, and the universe's positions.

Ported from `research-ts/src/projections/preseason/store.ts` and `backtest.ts`'s `allPositions`.
"""

from dataclasses import dataclass
from datetime import date, datetime
from typing import Final

from sqlalchemy import Connection, text

from research.model.domain import Position
from research.model.instants import FAR_FUTURE, ms_instant
from research.pipeline.nflverse.players import projected_position


@dataclass(frozen=True, slots=True)
class PreseasonRosterRow:
    season: int
    team: str
    player_id: str
    position: str
    status: str
    birth_date: str | None
    draft_year: int | None
    draft_pick: int | None
    draft_club: str | None
    as_of: datetime


@dataclass(frozen=True, slots=True)
class PreseasonRankingRow:
    season: int
    source: str
    player_id: str
    rank: float
    as_of: datetime


_ROSTERS_AS_OF: Final = """
select distinct on (player_id) season, team, player_id, position, status, birth_date, draft_year, draft_pick, draft_club, as_of
from research.preseason_rosters
where season = :season and as_of <= :as_of
order by player_id asc, as_of desc
"""

_RANKINGS_AS_OF: Final = """
select distinct on (player_id) season, source, player_id, rank, as_of
from research.preseason_rankings
where season = :season and source = :source and as_of <= :as_of {players}
order by player_id asc, as_of desc
"""


def _iso_date(value: date | None) -> str | None:
    """The research schema's `date` as the ISO text the legacy column held."""
    return None if value is None else value.isoformat()


def preseason_rosters_as_of(conn: Connection, season: int, as_of: datetime) -> list[PreseasonRosterRow]:
    """`preseasonRostersAsOf`: each player's latest week-one roster row at the instant."""
    rows = conn.execute(text(_ROSTERS_AS_OF), {"season": season, "as_of": as_of})
    return [
        PreseasonRosterRow(
            row.season,
            row.team,
            row.player_id,
            row.position,
            row.status,
            _iso_date(row.birth_date),
            row.draft_year,
            row.draft_pick,
            row.draft_club,
            ms_instant(row.as_of),
        )
        for row in rows
    ]


def preseason_roster_statuses_for(conn: Connection, season: int) -> dict[str, str]:
    """`preseasonRosterStatusesFor`: every stamp, each player's latest status."""
    return {row.player_id: row.status for row in preseason_rosters_as_of(conn, season, FAR_FUTURE)}


def preseason_rankings_as_of(
    conn: Connection, season: int, source: str, as_of: datetime, player_ids: list[str] | None = None
) -> list[PreseasonRankingRow]:
    """`preseasonRankingsAsOf` (and `preseasonRankingsFor` when `player_ids` is given): each
    player's latest published rank at the instant, across every generation the source holds."""
    if player_ids is not None and len(player_ids) == 0:
        return []
    params: dict[str, object] = {"season": season, "source": source, "as_of": as_of}
    clause = ""
    if player_ids is not None:
        clause = "and player_id = any(:players)"
        params["players"] = player_ids
    rows = conn.execute(text(_RANKINGS_AS_OF.format(players=clause)), params)
    return [PreseasonRankingRow(row.season, row.source, row.player_id, row.rank, ms_instant(row.as_of)) for row in rows]


def first_roster_seasons_through(conn: Connection, through_season: int) -> dict[str, int]:
    """`firstRosterSeasonsThrough`: each player's first week-one roster season."""
    rows = conn.execute(
        text(
            "select player_id, min(season) as first_season from research.preseason_rosters "
            "where season <= :through group by player_id"
        ),
        {"through": through_season},
    )
    return {row.player_id: int(row.first_season) for row in rows if row.first_season is not None}


def all_positions(conn: Connection) -> dict[str, Position]:
    """`allPositions`: every universe player the engine projects, by id, in the table's order."""
    rows = conn.execute(text("select id, position from research.players"))
    positions: dict[str, Position] = {}
    for row in rows:
        position = projected_position(row.position)
        if position is not None:
            positions[row.id] = position
    return positions
