"""THE GAME STATUSES FROM THE HOURLY CAPTURE (Lane 80): a game is final the hour after it ends.

The weekly pass brings a game's result with the week's stats on Tuesday or Wednesday; until then the
screens could only say a game had kicked off. The hourly capture now asks Tank01's week of games
(`getNFLGamesForWeek`, whose `gameStatus` says Scheduled, live or Final) once a pass, and only while
a game that kicked off within the last LOOKBACK has no final in the store: a game day and the night
after it, never a quiet day. Each answer is kept verbatim in `capture_snapshots` (append-only, every
call its own row, so the calls an hour are counted from the store) and read into the
`tank01_game_status` team-week source, one `game_status` observation per club stamped at the pass:
0 scheduled, 1 under way, 2 final. The feed carries no score, so none is written; the final score
comes with the weekly stats as before.

THE BUDGET. One request a pass, and never more than HOURLY_CAP in any hour: a pass that finds the
cap reached asks nothing and says so. With the season's game days and a game's few hours to its
final, that is about 20 calls a week, some 360 a regular season, inside the purchased quota.

A FINAL IS HELD once the store has the club-week's nflverse result, a Tank01 final, or a line for
either side, the rule the API's gameStateAt and the run's states keep (Lane 66s)."""

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Final

from sqlalchemy import Connection, func, select, text

from research.db.schema import CAPTURE_SNAPSHOTS
from research.pipeline.jscompat import js_json_stringify
from research.pipeline.kickoffs import TeamKickoff, stored_kickoffs
from research.pipeline.nflverse.team_codes import source_team_code
from research.pipeline.observations import TeamWeekObservation, record_team_observations
from research.pipeline.tank01.capture import digest_of
from research.pipeline.tank01.client import Paths, Tank01Client
from research.pipeline.tank01.mapping import SEASON_TYPE, GameStatus, map_games

SNAPSHOT_SOURCE: Final = "tank01_games_week"
STATUS_SOURCE: Final = "tank01_game_status"
STATUS_METRIC: Final = "game_status"
STATUS_VALUES: Final[dict[GameStatus, float]] = {"scheduled": 0.0, "in_progress": 1.0, "final": 2.0}
FINAL_VALUE: Final = STATUS_VALUES["final"]
# A game that kicked off this long ago and still has no final stops being asked about: its final
# comes with the weekly stats. A game ends some three and a half hours after its kickoff.
LOOKBACK: Final = timedelta(hours=12)
HOURLY_CAP: Final = 2
_HOUR: Final = timedelta(hours=1)

_HELD: Final = text(
    "select distinct team, week from research.team_week_observations where season = :s and as_of <= :now and "
    "((metric = 'game_result') or (source = :status and metric = :metric and value = :final)) "
    "union select distinct team, week from research.player_week_teams where season = :s and as_of <= :now"
)


# Every call kept, the same answer twice included: the hour's calls are counted from these rows.
_INSERT: Final = text(
    f"insert into {CAPTURE_SNAPSHOTS.fullname} (source, captured_at, digest, payload) "
    "values (:source, :captured_at, :digest, cast(:payload as jsonb))"
)


@dataclass(frozen=True)
class StatusResult:
    """One pass's status read: the requests it made, the clubs it marked, and its line."""

    requests: int
    written: int
    line: str


def finals_held(conn: Connection, season: int, now: datetime) -> frozenset[tuple[str, int]]:
    """The club-weeks (source codes) the store holds a final for at `now`, from either source or a line."""
    rows = conn.execute(
        _HELD, {"s": season, "now": now, "status": STATUS_SOURCE, "metric": STATUS_METRIC, "final": FINAL_VALUE}
    )
    return frozenset((str(r.team), int(r.week)) for r in rows)


def pending_week(kickoffs: Sequence[TeamKickoff], held: frozenset[tuple[str, int]], now: datetime) -> int | None:
    """The week of the earliest club-game kicked off within LOOKBACK with no final held for it (the
    status and the result are written for both sides); None when no game is waiting on its final,
    and the pass asks nothing."""
    by_week: dict[int, set[str]] = {}
    for k in kickoffs:
        if k.at <= now and now - k.at <= LOOKBACK:
            by_week.setdefault(k.week, set()).add(k.team)
    for week in sorted(by_week):
        if any((team, week) not in held for team in by_week[week]):
            return week
    return None


def calls_this_hour(conn: Connection, now: datetime) -> int:
    """The status calls stored in the hour up to `now`: every call is its own snapshot."""
    table = CAPTURE_SNAPSHOTS
    query = select(func.count()).where(
        table.c.source == SNAPSHOT_SOURCE, table.c.captured_at > now - _HOUR, table.c.captured_at <= now
    )
    return int(conn.execute(query).scalar_one())


def status_observations(body: object, season: int, week: int, now: datetime) -> list[TeamWeekObservation]:
    """Each club's game status in the answer, stamped at the pass, in the store's team codes."""
    rows: list[TeamWeekObservation] = []
    for game in map_games(body, week):
        value = STATUS_VALUES[game.status]
        for club in (game.home_nfl_team, game.away_nfl_team):
            rows.append(
                TeamWeekObservation(season, week, source_team_code(club), STATUS_SOURCE, STATUS_METRIC, value, now)
            )
    return rows


def capture_game_status(conn: Connection, client: Tank01Client, season: int, now: datetime) -> StatusResult:
    """The pass's status read: asked only while a game waits on its final, under the hourly cap."""
    week = pending_week(stored_kickoffs(conn, season), finals_held(conn, season, now), now)
    if week is None:
        return StatusResult(0, 0, "no game waiting on its final, 0 requests")
    made = calls_this_hour(conn, now)
    if made >= HOURLY_CAP:
        return StatusResult(0, 0, f"REFUSED, {made} calls this hour, the cap is {HOURLY_CAP}, 0 requests")
    body = client.get(Paths.GAMES_FOR_WEEK, {"week": str(week), "season": str(season), "seasonType": SEASON_TYPE})
    row = {"source": SNAPSHOT_SOURCE, "captured_at": now, "digest": digest_of(body), "payload": js_json_stringify(body)}
    conn.execute(_INSERT, row)
    rows = status_observations(body, season, week, now)
    written = record_team_observations(conn, rows)
    finals = sum(1 for row in rows if row.value == FINAL_VALUE)
    return StatusResult(1, written, f"week {week}, {len(rows)} clubs read, {finals} final, 1 request")
