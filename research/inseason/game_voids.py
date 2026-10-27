"""AN OPERATOR'S VOID OF ONE GAME, so a game that will never be whole never blocks its week (Lane 249, B255).

A week grades once every game the game table lists for it is whole (`week_complete`). A game cancelled
but kept in `games.csv` with no result (BUF at CIN, 2022 week 17), or dropped from the file and left as a
stale `nflverse_games` row (the ingest only upserts), would hold its week forever and fail every pass from
the overdue line. The operator voids it:

    uv run python -m research.inseason void-game --season S --week W --game ID --reason TEXT --by WHO [--lift]

The command checks the game is the game table's for that season and week (regular season, the games
the check reads), refuses any act on a week already graded (a grade is final), a void of a game that
was played (a score, or a club's final: its late lines are an outage, not a cancellation), a void of a
voided game and a lift of one not voided, writes one row to
`research.game_voids` and prints what it did. Rows are never updated or deleted: a lift is a later row
with `lifted` true, and a game's standing is its latest row at or before the pass. A void binds the
game in the week it was voided in: a game moved to another week since is checked again.

It runs from a shell or, with gcloud lapsed, through `ops.yml` (job `inseason`, args
`research.inseason,void-game,--season,S,--week,W,--game,ID,--reason,TEXT,--by,WHO`, no comma in the
reason). No schedule runs it.
"""

from dataclasses import dataclass
from datetime import datetime
from typing import Any, Final

from sqlalchemy import Connection, Row, insert, text

from research.db.schema import GAME_VOIDS
from research.errors import ResearchError
from research.model.instants import js_iso, ms_instant
from research.pipeline.nflverse.config import SEASON_TYPE
from research.pipeline.nflverse.schedule import ScheduleMetric, ScheduleSource

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
select away_team, home_team, home_score, away_score from research.nflverse_games
where game_id = :g and season = :s and week = :w and game_type = :game_type
"""

_FINALS: Final = """
select count(*) from research.team_week_observations
where season = :s and week = :w and team in (:away, :home) and source = :source and metric = :metric
  and as_of <= :now
"""

_GRADED: Final = "select exists (select 1 from research.register_grade_rows where season = :s and week = :w)"


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


def void_ops_command(season: int, week: int, game_id: str) -> str:
    """The same void through `ops.yml`, for when the laptop's gcloud login has lapsed."""
    return (
        f"gh workflow run ops.yml -f job=inseason -f args=research.inseason,{VOID_COMMAND},--season,{season},"
        f"--week,{week},--game,{game_id},--reason,<why>,--by,<who>"
    )


def _checked(request: VoidRequest) -> VoidRequest:
    reason, by = request.reason.strip(), request.voided_by.strip()
    if not reason or len(reason) > REASON_LIMIT:
        raise VoidError(f"give the reason with --reason (at most {REASON_LIMIT} characters).")
    if not by or len(by) > BY_LIMIT:
        raise VoidError(f"name who voids it with --by (at most {BY_LIMIT} characters).")
    return VoidRequest(request.season, request.week, request.game_id.strip(), reason, by, request.lift)


def _act(request: VoidRequest) -> str:
    return "lift" if request.lift else "void"


def _played(conn: Connection, request: VoidRequest, game: Row[Any], now: datetime) -> bool:
    """Whether the game was played: nflverse_games holds a score, or either club holds its final for
    the week as of `now` (the result the stats step writes, `ScheduleMetric.GAME_RESULT`)."""
    if game.home_score is not None or game.away_score is not None:
        return True
    params = {
        "s": request.season,
        "w": request.week,
        "away": game.away_team,
        "home": game.home_team,
        "source": ScheduleSource.KICKOFF,
        "metric": ScheduleMetric.GAME_RESULT,
        "now": now,
    }
    return bool(conn.execute(text(_FINALS), params).scalar_one())


def record_void(conn: Connection, request: VoidRequest, now: datetime) -> str:
    """One void or lift written at `now`, after the checks; the line saying what was done. Raises
    `VoidError`, writing nothing, when the game is not the week's regular season game, the week is
    already graded (a grade is final), a void names a game that was played (late lines are an outage,
    not a cancellation), or the game's standing refuses the act."""
    asked = _checked(request)
    params = {"g": asked.game_id, "s": asked.season, "w": asked.week, "game_type": SEASON_TYPE}
    game = conn.execute(text(_GAME), params).first()
    where = f"season {asked.season} week {asked.week}"
    if game is None:
        raise VoidError(f"{asked.game_id} is not a regular season game of {where} in nflverse_games; nothing written.")
    label = f"{asked.game_id} ({game.away_team} at {game.home_team})"
    if conn.execute(text(_GRADED), {"s": asked.season, "w": asked.week}).scalar_one():
        raise VoidError(
            f"{where} is graded and a grade is final, so the {_act(asked)} would change nothing; nothing written."
        )
    if not asked.lift and _played(conn, asked, game, now):
        raise VoidError(
            f"{label} was played (a score in nflverse_games or a club's final in the store): its late stat lines "
            "are an outage to wait out, not a cancellation; nothing written."
        )
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
