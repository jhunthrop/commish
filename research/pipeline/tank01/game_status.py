"""THE GAME STATUSES FROM THE HOURLY CAPTURE (Lane 80): a game is final the hour after it ends.

The weekly pass brings a game's result with the week's stats on Tuesday or Wednesday; until then the
screens could only say a game had kicked off. The hourly capture now asks Tank01's week of games
(`getNFLGamesForWeek`, whose `gameStatus` says Scheduled, live or Final) once a pass, and only while
a game of the current week that kicked off has no final in the store: a game day and the night after
it, never a quiet day. A game the passes missed, after a deploy, a lapse or an expired login, is still
asked about at the next pass (Lane 84), until its final is held or GIVE_UP_AFTER has passed since its
kickoff. Each answer is kept verbatim in `capture_snapshots` (append-only, every call its own row, so
the calls an hour are counted from the store) and read into the
`tank01_game_status` team-week source, one `game_status` observation per club stamped at the pass:
0 scheduled, 1 under way, 2 final. The feed carries no score, so none is written; the final score
comes with the weekly stats as before.

THE BUDGET. One week request a pass, on what the harvest left of its request budget, and never more than
HOURLY_CAP in any hour: a pass that finds the cap reached or the budget spent asks nothing and says
so, and the count and the call are taken under an advisory lock. With the season's game days and a
game's few hours to its final, that is about 20 calls a week, and with the 9:30 am Eastern games
abroad and the late-season Saturdays some 390 a regular season, inside the purchased quota. A game
that never gets a final (a cancellation, or a missed weekly result) is asked about once a pass, some
18 calls a day, until the next week kicks off or GIVE_UP_AFTER has passed, so never into the offseason.

A WEEK FEED THAT LAGS (Lane 101, B75). The week's feed has said Scheduled hours after a Monday night game
ended. So in the same pass, a game the week's answer still has scheduled or under way FALLBACK_AFTER or
more past its stored kickoff, with no final held, is asked about on its own: Tank01's box score for that
game (`getNFLBoxScore`, whose answer carries the game's `gameStatusCode` and `gameStatus` as the week's
does), at most FALLBACK_CAP a pass, the longest waiting first, on what is left of the pass's request
budget. Each answer is kept verbatim under its own source (BOX_SCORE_SOURCE) and read through the same
mapper; its status is the game's for this pass. An answer that names another game or carries no status
is refused: kept, its game left at the week's status, and the pass's line FAILED, as a refused snapshot
fails its parse. The fallback's calls count against the pass's budget, not against HOURLY_CAP, which is
the week feed's.

A FINAL IS HELD by the one rule, the `club_week_finals` view (revision 0014): the weekly result, a
Tank01 final, or a line with the club, which the API's week facts and the run's states read too."""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass, replace
from datetime import datetime, timedelta
from typing import Final

import httpx
from sqlalchemy import Connection, func, select, text

from research.db.schema import CAPTURE_SNAPSHOTS, CLUB_WEEK_FINALS
from research.errors import ResearchError
from research.pipeline.budget import FixedBudget
from research.pipeline.jscompat import js_json_stringify
from research.pipeline.kickoffs import TeamKickoff, stored_kickoffs
from research.pipeline.nflverse.team_codes import source_team_code
from research.pipeline.observations import TeamWeekObservation, record_team_observations
from research.pipeline.tank01.capture import FeedOutcome, digest_of, record_checks
from research.pipeline.tank01.client import Paths, Tank01Client
from research.pipeline.tank01.mapping import SEASON_TYPE, GameStatus, GameSummary, map_box_score_game, map_games

SNAPSHOT_SOURCE: Final = "tank01_games_week"
# The per-game fallback's answers (Lane 101), one snapshot a call.
BOX_SCORE_SOURCE: Final = "tank01_game_box_score"
STATUS_SOURCE: Final = "tank01_game_status"
STATUS_METRIC: Final = "game_status"
STATUS_VALUES: Final[dict[GameStatus, float]] = {"scheduled": 0.0, "in_progress": 1.0, "final": 2.0}
FINAL_VALUE: Final = STATUS_VALUES["final"]
HOURLY_CAP: Final = 2
# A game the week's feed still has scheduled or under way this long past its kickoff is asked about on its
# own (Lane 101): every game is over by then, overtime and a long delay included.
FALLBACK_AFTER: Final = timedelta(hours=4)
# At most this many per-game calls a pass (the games in that state on a game night, B75).
FALLBACK_CAP: Final = 2
# A game with no final this long after its kickoff stops being asked about (Lane 84 review): past the
# weekly stats of Tuesday or Wednesday evening, its final will not come from the hourly status.
GIVE_UP_AFTER: Final = timedelta(days=4)
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
    failed: bool = False


def finals_held(conn: Connection, season: int, now: datetime) -> frozenset[tuple[str, int]]:
    """The club-weeks (source codes) final at `now` by the one rule, the `club_week_finals` view."""
    view = CLUB_WEEK_FINALS
    query = select(view.c.team, view.c.week).where(view.c.season == season, view.c.held_at <= now)
    return frozenset((str(r.team), int(r.week)) for r in conn.execute(query))


def pending_week(kickoffs: Sequence[TeamKickoff], held: frozenset[tuple[str, int]], now: datetime) -> int | None:
    """The current week (the latest with a club-game kicked off by `now`) while any of its kicked-off
    club-games has no final held (the status and the result are written for both sides); None when
    none waits, and the pass asks nothing. A game the passes missed, after a deploy or a lapse, is
    asked about until its final is held (Lane 84), and given up on GIVE_UP_AFTER past its kickoff.
    An earlier week's gap is left to its weekly stats."""
    kicked = [k for k in kickoffs if k.at <= now]
    if not kicked:
        return None
    week = max(k.week for k in kicked)
    waiting = any((k.team, week) not in held and now - k.at <= GIVE_UP_AFTER for k in kicked if k.week == week)
    return week if waiting else None


def calls_this_hour(conn: Connection, now: datetime) -> int:
    """The status calls stored from an hour before `now` on: every call is its own snapshot. No upper
    bound (re-review finding 2): a pass that waited on the lock with an earlier `now` still counts the
    call the pass holding it just stored."""
    table = CAPTURE_SNAPSHOTS
    query = select(func.count()).where(table.c.source == SNAPSHOT_SOURCE, table.c.captured_at > now - _HOUR)
    return int(conn.execute(query).scalar_one())


def status_observations(
    games: Sequence[GameSummary], season: int, week: int, now: datetime
) -> list[TeamWeekObservation]:
    """Each club's game status, stamped at the pass, in the store's team codes."""
    rows: list[TeamWeekObservation] = []
    for game in games:
        value = STATUS_VALUES[game.status]
        for club in (game.home_nfl_team, game.away_nfl_team):
            rows.append(
                TeamWeekObservation(season, week, source_team_code(club), STATUS_SOURCE, STATUS_METRIC, value, now)
            )
    return rows


def lagging_games(
    games: Sequence[GameSummary],
    kickoffs: Sequence[TeamKickoff],
    held: frozenset[tuple[str, int]],
    week: int,
    now: datetime,
) -> list[GameSummary]:
    """The week's games the answer has scheduled or under way FALLBACK_AFTER or more past their stored
    kickoff (the home club's) and within GIVE_UP_AFTER of it, with neither club's final held; the longest
    waiting first. A game with no stored kickoff is never one."""
    kicked = {k.team: k.at for k in kickoffs if k.week == week}
    waiting: list[tuple[datetime, GameSummary]] = []
    for game in games:
        home, away = source_team_code(game.home_nfl_team), source_team_code(game.away_nfl_team)
        at = kicked.get(home)
        if game.status == "final" or at is None or (home, week) in held or (away, week) in held:
            continue
        if FALLBACK_AFTER <= now - at <= GIVE_UP_AFTER:
            waiting.append((at, game))
    return [game for _, game in sorted(waiting, key=lambda pair: (pair[0], pair[1].game_id))]


@dataclass(frozen=True)
class _Fallback:
    """One pass's per-game answers: the statuses they gave, their requests, what they said."""

    statuses: Mapping[str, GameStatus]
    requests: int
    notes: tuple[str, ...]
    failed: bool


_STATUS_WORDS: Final[dict[GameStatus, str]] = {"final": "final", "in_progress": "under way", "scheduled": "scheduled"}


def _store(conn: Connection, source: str, body: object, now: datetime) -> None:
    """Every call kept verbatim, its own row, and its source marked checked at the pass."""
    row = {"source": source, "captured_at": now, "digest": digest_of(body), "payload": js_json_stringify(body)}
    conn.execute(_INSERT, row)
    record_checks(conn, [FeedOutcome(source, "captured", 1)], now)


def _ask_box_score(
    conn: Connection, client: Tank01Client, game: GameSummary, week: int, now: datetime
) -> tuple[GameStatus | None, str]:
    """One game's box score, kept and read through the mapper. None with the reason when the provider
    failed (nothing to keep) or the kept answer is refused."""
    try:
        body = client.get(Paths.BOX_SCORE, {"gameID": game.game_id})
    except (ResearchError, httpx.HTTPError) as error:
        return None, f"FAILED, {game.game_id} box score: {error}"
    _store(conn, BOX_SCORE_SOURCE, body, now)
    read = map_box_score_game(body, week)
    if read is None or read.game_id != game.game_id:
        return None, f"FAILED, {game.game_id} box score refused: it is not that game with a status"
    return read.status, f"{game.game_id} box score {_STATUS_WORDS[read.status]}"


def to_ask(lagging: Sequence[GameSummary], budget: FixedBudget) -> list[GameSummary]:
    """The lagging games this pass asks about: at most FALLBACK_CAP, and what the budget covers."""
    asked = list(lagging[: min(FALLBACK_CAP, budget.limit)])
    return asked if budget.reserve(len(asked)).granted else []


def _fallback(
    conn: Connection, client: Tank01Client, asked: Sequence[GameSummary], week: int, now: datetime
) -> _Fallback:
    """The games asked about one by one; a failed or refused answer leaves its game at the week's status."""
    statuses: dict[str, GameStatus] = {}
    notes: list[str] = []
    for game in asked:
        status, note = _ask_box_score(conn, client, game, week, now)
        notes.append(note)
        if status is not None:
            statuses[game.game_id] = status
    return _Fallback(statuses, len(asked), tuple(notes), len(statuses) < len(asked))


def capture_game_status(
    conn: Connection, client: Tank01Client, season: int, now: datetime, budget: FixedBudget
) -> StatusResult:
    """The pass's status read: asked only while a game waits on its final, on the harvest's request
    budget, under the hourly cap; then the lagging games' box scores on what is left of that budget.
    The count and the call are taken under a transaction-scoped advisory lock, so two passes at once
    never both count under the cap and both call."""
    kickoffs = stored_kickoffs(conn, season)
    held = finals_held(conn, season, now)
    week = pending_week(kickoffs, held, now)
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
    _store(conn, SNAPSHOT_SOURCE, body, now)
    games = map_games(body, week)
    lagging = lagging_games(games, kickoffs, held, week, now)
    asked = to_ask(lagging, budget.after(1))
    fallback = _fallback(conn, client, asked, week, now)
    read = [replace(game, status=fallback.statuses.get(game.game_id, game.status)) for game in games]
    rows = status_observations(read, season, week, now)
    written = record_team_observations(conn, rows)
    finals = sum(1 for row in rows if row.value == FINAL_VALUE)
    requests = 1 + fallback.requests
    head = f"week {week}, {len(rows)} clubs read, {finals} final, {requests} request{'' if requests == 1 else 's'}"
    unasked = [f"{left} lagging, not asked this pass"] if (left := len(lagging) - len(asked)) else []
    return StatusResult(requests, written, "; ".join([head, *fallback.notes, *unasked]), fallback.failed)
