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
ended. So in the same pass, a game the week's answer still has scheduled or under way FALLBACK_AFTER
(3 h 30 m) or more past its stored kickoff, with no final held, is asked about on its own, and so is a
game of the stored schedule (`provider_games`) the answer leaves out, named in the line as absent from
the week feed and written only from its own answer: Tank01's box score for that
game (`getNFLBoxScore`, whose answer carries the game's `gameStatusCode` and `gameStatus` as the week's
does), at most FALLBACK_CAP a pass, the longest waiting first, on what is left of the pass's request
budget. Each answer is kept verbatim under its own source (BOX_SCORE_SOURCE) and read through the same
mapper; its status is the game's for this pass. An answer that names another game or carries no status
is refused: kept, its game left at the week's status, and the pass's line FAILED, as a refused snapshot
fails its parse. The fallback's calls count against the pass's budget, not against HOURLY_CAP, which is
the week feed's.

A REFUSAL THAT REPEATS (Lane 107, B76; Lane 110, B86). A game whose newest REFUSAL_CAP kept box scores (the
answers asked about it, `asked_game_id`, whatever game they name, or none) are one refused answer is not
asked again: the pass names it once, "refused 3 times, waiting on the final", and still fails its line,
until the final is held another way or GIVE_UP_AFTER has passed. A box score kept before that column counts
for the game its answer names.
A GAME THAT MOVED (Lane 107, B77; Lane 110, B77b). The game id carries its date, so a game moved to another
day (a week 18 Saturday game, a postponement) leaves its old row in the stored schedule until the schedule
ingest marks it superseded (`superseded_by`), and a marked row is never read here. Until then a stored game
whose club the answer carries under another id is never absent, only named in the line as superseded by
that id.

A FINAL IS HELD by the one rule, the `club_week_finals` view (revision 0014): the weekly result, a
Tank01 final, or a line with the club, which the API's week facts and the run's states read too."""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass, replace
from datetime import datetime, timedelta
from typing import Final

import httpx
from sqlalchemy import Connection, func, select, text

from research.db.schema import CAPTURE_SNAPSHOTS, CLUB_WEEK_FINALS, PROVIDER_GAMES
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
# A game the week's feed still has scheduled or under way, or leaves out, this long past its kickoff is
# asked about on its own (Lane 101). 3 h 30 m (fix round 1), so the 00:00 ET pass reaches an 8:15 pm ET
# kickoff (3 h 45 m old then) before the 05:00 UTC nightly; a game still going is written as under way.
FALLBACK_AFTER: Final = timedelta(hours=3, minutes=30)
# At most this many per-game calls a pass (the games in that state on a game night, B75).
FALLBACK_CAP: Final = 2
# A game with no final this long after its kickoff stops being asked about (Lane 84 review): past the
# weekly stats of Tuesday or Wednesday evening, its final will not come from the hourly status.
GIVE_UP_AFTER: Final = timedelta(days=4)
# A box score refused this many times with one answer (the same digest) is not asked again (B76): the
# line still fails each pass, naming it, until the final comes another way or GIVE_UP_AFTER passes.
REFUSAL_CAP: Final = 3
_HOUR: Final = timedelta(hours=1)
# The status pass's advisory lock (pg_advisory_xact_lock), released with its transaction.
_LOCK_KEY: Final = 80_0001
_LOCK: Final = text("select pg_advisory_xact_lock(:key)")


# Every call kept, the same answer twice included: the hour's calls are counted from these rows. A box
# score names the game it was asked about (B86); the week's call names none.
_INSERT: Final = text(
    f"insert into {CAPTURE_SNAPSHOTS.fullname} (source, captured_at, digest, payload, asked_game_id) "
    "values (:source, :captured_at, :digest, cast(:payload as jsonb), :asked)"
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
class Absence:
    """The stored schedule's games of the week the answer leaves out, as not yet final (MEDIUM-2), and
    the stored games it supersedes (B77): a game whose club the answer carries under another id, the
    date in its id moved (a week 18 Saturday game, a postponement), each with that new id."""

    games: list[GameSummary]
    superseded: list[tuple[str, str]]


def absent_games(conn: Connection, season: int, week: int, answered: Sequence[GameSummary]) -> Absence:
    """A stored game the answer leaves out is absent, unless either of its clubs appears in the answer
    under any id: then it is superseded by that game, and never asked about by its dead id (B77)."""
    t = PROVIDER_GAMES
    query = select(t.c.game_id, t.c.home_team, t.c.away_team).where(
        t.c.season == season, t.c.week == week, t.c.superseded_by.is_(None)
    )
    ids = {game.game_id for game in answered}
    by_club = {
        source_team_code(club): game.game_id for game in answered for club in (game.home_nfl_team, game.away_nfl_team)
    }
    games: list[GameSummary] = []
    superseded: list[tuple[str, str]] = []
    for r in conn.execute(query.order_by(t.c.game_id)):
        if r.game_id in ids:
            continue
        new_id = by_club.get(source_team_code(str(r.home_team))) or by_club.get(source_team_code(str(r.away_team)))
        if new_id is not None:
            superseded.append((str(r.game_id), new_id))
        else:
            games.append(GameSummary(str(r.game_id), week, "scheduled", str(r.home_team), str(r.away_team), "", ""))
    return Absence(games, superseded)


@dataclass(frozen=True)
class _Fallback:
    """One pass's per-game answers: the statuses they gave, their requests, what they said."""

    statuses: Mapping[str, GameStatus]
    requests: int
    notes: tuple[str, ...]
    failed: bool


_STATUS_WORDS: Final[dict[GameStatus, str]] = {"final": "final", "in_progress": "under way", "scheduled": "scheduled"}


def _store(conn: Connection, source: str, body: object, now: datetime, asked: str | None = None) -> None:
    """Every call kept verbatim, its own row with the game it asked about, and its source marked checked at
    the pass."""
    row = {
        "source": source,
        "captured_at": now,
        "digest": digest_of(body),
        "payload": js_json_stringify(body),
        "asked": asked,
    }
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
    _store(conn, BOX_SCORE_SOURCE, body, now, asked=game.game_id)
    status = box_score_status(body, game, week)
    if status is None:
        return None, f"FAILED, {game.game_id} box score refused: it is not that game with a status"
    return status, f"{game.game_id} box score {_STATUS_WORDS[status]}"


def box_score_status(body: object, game: GameSummary, week: int) -> GameStatus | None:
    """The asked game's status in its box score, None when the answer is refused: the mapper refuses it,
    or it names another game."""
    read = map_box_score_game(body, week)
    return None if read is None or read.game_id != game.game_id else read.status


# A game's newest kept box scores: the ones asked about it (B86), and before that column, the ones whose
# answer names it (`gameID`).
_GAME_BOX_SCORES: Final = text(
    f"select digest, payload from {CAPTURE_SNAPSHOTS.fullname} "
    "where source = :source and coalesce(asked_game_id, payload ->> 'gameID') = :game "
    "order by captured_at desc, id desc limit :cap"
)


def refused_out(conn: Connection, game: GameSummary, week: int) -> bool:
    """The game's newest REFUSAL_CAP kept box scores are one answer (the same digest) and it is refused, by
    the mapper or for naming another game or none: the provider has said the same unreadable thing that
    many times (B76, B86)."""
    params = {"source": BOX_SCORE_SOURCE, "game": game.game_id, "cap": REFUSAL_CAP}
    kept = conn.execute(_GAME_BOX_SCORES, params).all()
    if len(kept) < REFUSAL_CAP or len({row.digest for row in kept}) != 1:
        return False
    return box_score_status(kept[0].payload, game, week) is None


def _refused_note(game: GameSummary) -> str:
    return f"FAILED, {game.game_id} box score refused {REFUSAL_CAP} times, waiting on the final"


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
    absent = absent_games(conn, season, week, games)
    lagging = lagging_games([*games, *absent.games], kickoffs, held, week, now)
    capped = [game for game in lagging if refused_out(conn, game, week)]
    askable = [game for game in lagging if game not in capped]
    asked = to_ask(askable, budget.after(1))
    fallback = _fallback(conn, client, asked, week, now)
    answered = [game for game in absent.games if game.game_id in fallback.statuses]
    read = [replace(game, status=fallback.statuses.get(game.game_id, game.status)) for game in [*games, *answered]]
    superseded = [f"{old} superseded by {new}" for old, new in absent.superseded]
    missing = [f"{game.game_id} absent from the week feed" for game in lagging if game in absent.games]
    rows = status_observations(read, season, week, now)
    written = record_team_observations(conn, rows)
    finals = sum(1 for row in rows if row.value == FINAL_VALUE)
    requests = 1 + fallback.requests
    head = f"week {week}, {len(rows)} clubs read, {finals} final, {requests} request{'' if requests == 1 else 's'}"
    unasked = [f"{left} lagging, not asked this pass"] if (left := len(askable) - len(asked)) else []
    notes = [*superseded, *missing, *fallback.notes, *map(_refused_note, capped), *unasked]
    return StatusResult(requests, written, "; ".join([head, *notes]), fallback.failed or bool(capped))
