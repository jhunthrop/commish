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

THE BUDGET. One request a pass, on what the harvest left of its request budget, and never more than
HOURLY_CAP in any hour: a pass that finds the cap reached or the budget spent asks nothing and says
so, and the count and the call are taken under an advisory lock. With the season's game days and a
game's few hours to its final, that is about 20 calls a week, and with the 9:30 am Eastern games
abroad and the late-season Saturdays some 390 a regular season, inside the purchased quota.

A FINAL IS HELD by the one rule, the `club_week_finals` view (revision 0014): the weekly result, a
Tank01 final, or a line with the club, which the API's week facts and the run's states read too."""

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Final

from sqlalchemy import Connection, func, select, text

from research.db.schema import CAPTURE_SNAPSHOTS, CLUB_WEEK_FINALS
from research.pipeline.budget import RequestBudget
from research.pipeline.jscompat import js_json_stringify
from research.pipeline.kickoffs import TeamKickoff, stored_kickoffs
from research.pipeline.nflverse.team_codes import source_team_code
from research.pipeline.observations import TeamWeekObservation, record_team_observations
from research.pipeline.tank01.capture import FeedOutcome, digest_of, record_checks
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
# The status pass's advisory lock (pg_advisory_xact_lock), released with its transaction.
_LOCK_KEY: Final = 80_0001
_LOCK: Final = text("select pg_advisory_xact_lock(:key)")


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
    """The club-weeks (source codes) final at `now` by the one rule, the `club_week_finals` view."""
    view = CLUB_WEEK_FINALS
    query = select(view.c.team, view.c.week).where(view.c.season == season, view.c.held_at <= now)
    return frozenset((str(r.team), int(r.week)) for r in conn.execute(query))


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


def capture_game_status(
    conn: Connection, client: Tank01Client, season: int, now: datetime, budget: RequestBudget
) -> StatusResult:
    """The pass's status read: asked only while a game waits on its final, on the harvest's request
    budget, under the hourly cap. The count and the call are taken under a transaction-scoped advisory
    lock, so two passes at once never both count under the cap and both call."""
    week = pending_week(stored_kickoffs(conn, season), finals_held(conn, season, now), now)
    if week is None:
        return StatusResult(0, 0, "no game waiting on its final, 0 requests")
    conn.execute(_LOCK, {"key": _LOCK_KEY})
    made = calls_this_hour(conn, now)
    if made >= HOURLY_CAP:
        return StatusResult(0, 0, f"REFUSED, {made} calls this hour, the cap is {HOURLY_CAP}, 0 requests")
    reservation = budget.reserve(1)
    if not reservation.granted:
        return StatusResult(0, 0, f"REFUSED by the request budget ({reservation.denial}), 0 requests")
    body = client.get(Paths.GAMES_FOR_WEEK, {"week": str(week), "season": str(season), "seasonType": SEASON_TYPE})
    row = {"source": SNAPSHOT_SOURCE, "captured_at": now, "digest": digest_of(body), "payload": js_json_stringify(body)}
    conn.execute(_INSERT, row)
    record_checks(conn, [FeedOutcome(SNAPSHOT_SOURCE, "captured", 1)], now)
    rows = status_observations(body, season, week, now)
    written = record_team_observations(conn, rows)
    finals = sum(1 for row in rows if row.value == FINAL_VALUE)
    return StatusResult(1, written, f"week {week}, {len(rows)} clubs read, {finals} final, 1 request")
