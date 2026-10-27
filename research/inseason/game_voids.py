"""AN OPERATOR'S VOID OF ONE GAME, so a game that will never be whole never blocks its week (Lane 249, B255).

A week grades once every game the game table lists for it is whole (`week_complete`). A game cancelled
but kept in `games.csv` with no result (BUF at CIN, 2022 week 17), or dropped from the file and left as a
stale `nflverse_games` row (the ingest only upserts), would hold its week forever and fail every pass from
the overdue line. The operator voids it:

    uv run python -m research.inseason void-game --season S --week W --game ID --reason TEXT --by WHO [--lift]

The command checks the game is the game table's for that season and week (regular season, the games
the check reads), refuses a void of a voided game and a lift of one not voided, writes one row to
`research.game_voids` and prints what it did. Rows are never updated or deleted: a lift is a later row
with `lifted` true, and a game's standing is its latest row at or before the pass. A void binds the
game in the week it was voided in: a game moved to another week since is checked again.

It runs from a shell or, with gcloud lapsed, through `ops.yml` (job `inseason`, args
`research.inseason,void-game,--season,S,--week,W,--game,ID,--reason,TEXT,--by,WHO`, no comma in the
reason). No schedule runs it.
"""

from dataclasses import dataclass
from datetime import datetime
from typing import Final

from sqlalchemy import Connection, insert, text

from research.db.schema import GAME_VOIDS
from research.errors import ResearchError
from research.model.instants import js_iso, ms_instant
from research.pipeline.nflverse.config import SEASON_TYPE

VOID_COMMAND: Final = "void-game"
REASON_LIMIT: Final = 200
BY_LIMIT: Final = 80

_LATEST: Final = """
select distinct on (game_id) game_id, week, voided_at, voided_by, reason, lifted
from research.game_voids
where season = :s and voided_at <= :now
order by game_id, voided_at desc
"""

_GAME: Final = """
select away_team, home_team from research.nflverse_games
where game_id = :g and season = :s and week = :w and game_type = :game_type
"""


class VoidError(ResearchError):
    """A void or lift refused before any row is written."""


@dataclass(frozen=True, slots=True)
class GameVoid:
    """A void standing for a game as of an instant."""

    game_id: str
    week: int
    voided_at: datetime
    voided_by: str
    reason: str


@dataclass(frozen=True, slots=True)
class VoidRequest:
    season: int
    week: int
    game_id: str
    reason: str
    voided_by: str
    lift: bool


def _latest_rows(conn: Connection, season: int, now: datetime) -> dict[str, GameVoid | None]:
    """Each game's latest row of the season at or before `now`: its void, or None when lifted."""
    rows = conn.execute(text(_LATEST), {"s": season, "now": now})
    return {
        row.game_id: None
        if row.lifted
        else GameVoid(row.game_id, int(row.week), ms_instant(row.voided_at), row.voided_by, row.reason)
        for row in rows
    }


def voids_in_week(conn: Connection, season: int, week: int, now: datetime) -> dict[str, GameVoid]:
    """The games of a week voided as of `now`, by game id: a lifted void, or one recorded in another
    week, does not stand."""
    standing = _latest_rows(conn, season, now).values()
    return {void.game_id: void for void in standing if void is not None and void.week == week}


def void_command(season: int, week: int, game_id: str) -> str:
    """The command an operator runs to void this game, for the overdue line."""
    return (
        f"python -m research.inseason {VOID_COMMAND} --season {season} --week {week} --game {game_id} "
        "--reason <why> --by <who>"
    )


def _checked(request: VoidRequest) -> VoidRequest:
    reason, by = request.reason.strip(), request.voided_by.strip()
    if not reason or len(reason) > REASON_LIMIT:
        raise VoidError(f"give the reason with --reason (at most {REASON_LIMIT} characters).")
    if not by or len(by) > BY_LIMIT:
        raise VoidError(f"name who voids it with --by (at most {BY_LIMIT} characters).")
    return VoidRequest(request.season, request.week, request.game_id.strip(), reason, by, request.lift)


def record_void(conn: Connection, request: VoidRequest, now: datetime) -> str:
    """One void or lift written at `now`, after the checks; the line saying what was done. Raises
    `VoidError`, writing nothing, when the game is not the week's or its standing refuses the act."""
    asked = _checked(request)
    params = {"g": asked.game_id, "s": asked.season, "w": asked.week, "game_type": SEASON_TYPE}
    game = conn.execute(text(_GAME), params).first()
    where = f"season {asked.season} week {asked.week}"
    if game is None:
        raise VoidError(f"{asked.game_id} is not a regular season game of {where} in nflverse_games; nothing written.")
    label = f"{asked.game_id} ({game.away_team} at {game.home_team})"
    standing = _latest_rows(conn, asked.season, now).get(asked.game_id)
    if asked.lift and (standing is None or standing.week != asked.week):
        raise VoidError(f"{label} has no void standing in {where}; nothing written.")
    if not asked.lift and standing is not None and standing.week == asked.week:
        raise VoidError(
            f"{label} is already voided, at {js_iso(standing.voided_at)} by {standing.voided_by}; nothing written."
        )
    conn.execute(
        insert(GAME_VOIDS).values(
            game_id=asked.game_id,
            voided_at=now,
            season=asked.season,
            week=asked.week,
            voided_by=asked.voided_by,
            reason=asked.reason,
            lifted=asked.lift,
        )
    )
    act = "lifted the void of" if asked.lift else "voided"
    return f"{VOID_COMMAND}: {act} {label}, {where}, at {js_iso(now)} by {asked.voided_by}: {asked.reason}"
