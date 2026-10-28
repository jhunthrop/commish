"""THE CAPTURE ARCHIVE (`src/projections/capture.ts`, `capture-feeds.ts`, the capture-harvest job).

Tank01 publishes several facts only as a current snapshot (injury designations, depth charts,
headlines, the pre-game line, inactives); nobody archives them, so this does. Each feed's
response is stored verbatim in `capture_snapshots` with the instant it was captured and a digest
of its canonical form; a feed whose digest equals its latest stored one writes nothing. A single
feed's failure is an outcome, never a fabricated row and never the whole pass's failure.

THE HARVEST (`capture-harvest-job.ts`) runs five cheap, daily-value feeds against a fixed per-run
budget of ten requests. The game lines feed asks for every game day still ahead in the week the
provider schedule places next (Lane 66a, `week_game_dates`), one request a day, so a Tuesday pass
already holds Sunday's figures; with no stored schedule it asks for the capture's own day, as the
TypeScript did. Its follow-on event (enqueuing peek-document rebuilds for the players
whose designation or headlines moved) is a capsule concern and lands with the capsules in phase C.
"""

import hashlib
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from datetime import date, datetime, time
from typing import Final, Literal
from zoneinfo import ZoneInfo

from sqlalchemy import Connection, select, text

from research.db.schema import CAPTURE_CHECKS, CAPTURE_SNAPSHOTS, PROVIDER_GAMES, PROVIDER_WEEKS
from research.pipeline.budget import FixedBudget, RequestBudget
from research.pipeline.jscompat import js_iso, js_json_stringify, js_object_keys
from research.pipeline.nflverse.team_codes import NFL_TEAM_ABBREVIATIONS
from research.pipeline.tank01.client import Paths, Tank01Client, Tank01Error
from research.pipeline.tank01.mapping import ADP_TYPE
from research.pipeline.tank01.player_clubs import ListRead, refresh_player_clubs
from research.pipeline.tank01.projections import (
    PROJECTIONS_SOURCE,
    ProjectionRead,
    projection_answer,
    projection_week_due,
)
from research.pipeline.tolerated import TOLERATED_FAILURES

Cadence = Literal["daily", "game-day", "game-week", "weekly"]
Status = Literal["captured", "unchanged", "fresh", "off-cadence", "budget-refused", "unpublished", "failed"]

_GAME_DAYS_UTC: Final = (0, 1, 4, 5, 6)  # JavaScript's getUTCDay: Sunday 0, Monday 1, Thursday to Saturday.
CAPTURE_HARVEST_REQUEST_BUDGET: Final = 10
# A game-day status pass asks the two status feeds one request each (Lane 263), and never more.
CAPTURE_STATUS_REQUEST_BUDGET: Final = 2
# The game lines feed, which `tank01.lines` reads into the `tank01_lines` source.
BETTING_ODDS_SOURCE: Final = "tank01_betting_odds"
# The provider dates a game by its Eastern day.
_EASTERN: Final = ZoneInfo("America/New_York")


@dataclass(frozen=True)
class CaptureContext:
    season: int
    week: int
    day: str
    teams: tuple[str, ...]
    # The game days still ahead in the coming week (YYYYMMDD, Eastern), empty without a schedule.
    game_dates: tuple[str, ...] = ()


@dataclass(frozen=True)
class CaptureRequest:
    path: str
    query: dict[str, str]


@dataclass(frozen=True)
class ReadEffect:
    """What a feed's read wrote beside its snapshot: its line, or a refusal, which fails the feed (the job
    fails and alerts) while the snapshot stands."""

    note: str
    refused: bool = False


@dataclass(frozen=True)
class CaptureFeed:
    source: str
    cadence: Cadence
    requests: Callable[[CaptureContext], list[CaptureRequest]]
    # For a feed whose answer is judged before it is stored (the weekly projection): given the pass's
    # context and the answer (a body, or the provider's failure), the outcome it is instead of a capture,
    # with its reason, else None. Such an answer is stored nowhere and records no check, so it is never
    # a read.
    screen: Callable[[CaptureContext, object], tuple[Status, str] | None] | None = None
    # For a feed a table is written from as it is read (the player list's clubs, Lane 122): given the
    # connection and the answer read (captured or unchanged), in the feed's own savepoint, what it did.
    on_read: Callable[[Connection, object], ReadEffect] | None = None


def player_list_clubs(conn: Connection, answer: object) -> ReadEffect:
    """The list's clubs onto the stored players (`player_clubs`), in the snapshot's transaction."""
    refresh = refresh_player_clubs(conn, answer)
    return ReadEffect(refresh.line(), refused=not refresh.applied)


def screen_player_list(_context: CaptureContext, answer: object) -> tuple[Status, str] | None:
    """A player list with no players is a failure, never stored: stored, it would read as everyone's
    return date cleared. The provider's own failure stays the plain failure it is."""
    if isinstance(answer, Exception) or (isinstance(answer, list) and answer):
        return None
    return "failed", "the player list answered no players"


# THE RETURN DATES (Lane 110, B79). The player list is the one feed that carries each listed player's
# expected return (`injury.injReturnDate`, YYYYMMDD), one request for every player; the hourly injury
# list carries none. The harvest reads it once a day, and again on a game day's morning (`return_dates_due`,
# Lane 160); the Thursday pass reads it before the freeze (`read_player_list`); the API reads the date beside
# each designation (`api/internal/boards/designations.go`). The same read refreshes each listed player's
# club on `provider_players` (Lane 122, `player_clubs`).
PLAYER_LIST_SOURCE: Final = "tank01_player_list"
PLAYER_LIST_FEED: Final = CaptureFeed(
    PLAYER_LIST_SOURCE,
    "weekly",
    lambda _c: [CaptureRequest(Paths.PLAYER_LIST, {})],
    screen_player_list,
    player_list_clubs,
)

CAPTURE_FEEDS: tuple[CaptureFeed, ...] = (
    CaptureFeed(
        "tank01_injuries",
        "daily",
        lambda c: [CaptureRequest(Paths.TEAM_ROSTER, {"teamAbv": t, "getStats": "false"}) for t in c.teams],
    ),
    CaptureFeed("tank01_depth_charts", "daily", lambda _c: [CaptureRequest(Paths.DEPTH_CHARTS, {})]),
    CaptureFeed("tank01_changelog", "daily", lambda _c: [CaptureRequest(Paths.CHANGELOG, {})]),
    CaptureFeed("tank01_news", "daily", lambda _c: [CaptureRequest(Paths.NEWS, {"fantasyNews": "true"})]),
    CaptureFeed(
        BETTING_ODDS_SOURCE,
        "game-week",
        lambda c: [CaptureRequest(Paths.BETTING_ODDS, {"gameDate": d}) for d in (c.game_dates or (c.day,))],
    ),
    CaptureFeed("tank01_dfs_salaries", "game-day", lambda c: [CaptureRequest(Paths.DFS, {"date": c.day})]),
    CaptureFeed("tank01_adp", "weekly", lambda _c: [CaptureRequest(Paths.ADP, {"adpType": ADP_TYPE})]),
    # The pass's own week, screened as the daily read is (B73): a week not published yet is never stored.
    CaptureFeed(
        PROJECTIONS_SOURCE,
        "daily",
        lambda c: [CaptureRequest(Paths.PROJECTIONS, {"week": str(c.week)})],
        lambda c, answer: screen_projection(ProjectionRead(c.week, ahead=True), answer),
    ),
    CaptureFeed("tank01_injuries_by_date", "daily", lambda _c: [CaptureRequest(Paths.INJURIES_BY_DATE, {})]),
    CaptureFeed("tank01_inactives", "game-day", lambda c: [CaptureRequest(Paths.INACTIVES, {"week": str(c.week)})]),
    PLAYER_LIST_FEED,
)

# The harvest's deliberate subset: single-request feeds a player card or capsule reads.
HARVEST_FEED_SOURCES: Final = frozenset(
    {"tank01_injuries_by_date", "tank01_news", "tank01_depth_charts", "tank01_inactives", BETTING_ODDS_SOURCE}
)


# The game-day status pass's feeds (Lane 263): the injury designations and the game-day inactives, which is all a
# status read needs; news, depth charts, odds, the projection and the player list stay with the hourly harvest.
STATUS_FEED_SOURCES: Final = frozenset({"tank01_injuries_by_date", "tank01_inactives"})


def status_feeds(feeds: Sequence[CaptureFeed] = CAPTURE_FEEDS) -> list[CaptureFeed]:
    return [feed for feed in feeds if feed.source in STATUS_FEED_SOURCES]


def harvest_feeds(feeds: Sequence[CaptureFeed] = CAPTURE_FEEDS) -> list[CaptureFeed]:
    return [feed for feed in feeds if feed.source in HARVEST_FEED_SOURCES]


def cadence_allows(cadence: Cadence, at: datetime, context: CaptureContext | None = None) -> bool:
    """A game-week feed is due whenever a game is ahead in the week, else on game days as a game-day
    feed is."""
    if cadence == "game-week" and context is not None and context.game_dates:
        return True
    if cadence not in ("game-day", "game-week"):
        return True
    return (at.isoweekday() % 7) in _GAME_DAYS_UTC


def week_game_dates(games: Sequence[tuple[int, date]], at: datetime) -> tuple[str, ...]:
    """The game days of the earliest week with a game on or after today (Eastern), from today on."""
    today = at.astimezone(_EASTERN).date()
    ahead = [(week, day) for week, day in games if day >= today]
    if not ahead:
        return ()
    week = min(w for w, _ in ahead)
    return tuple(sorted({day.strftime("%Y%m%d") for w, day in ahead if w == week}))


def stored_week_game_dates(conn: Connection, season: int, at: datetime) -> tuple[str, ...]:
    """`week_game_dates` over the provider schedule's dated games of the season."""
    table = PROVIDER_GAMES
    query = select(table.c.week, table.c.game_date).where(
        table.c.season == season, table.c.game_date.is_not(None), table.c.superseded_by.is_(None)
    )
    return week_game_dates([(int(r.week), r.game_date) for r in conn.execute(query)], at)


def _canonical(value: object) -> object:
    if isinstance(value, list):
        return [_canonical(item) for item in value]
    if not isinstance(value, dict):
        return value
    return {key: _canonical(value[key]) for key in sorted(js_object_keys(value))}


def digest_of(payload: object) -> str:
    """sha256 of the canonical JSON: keys sorted, JavaScript's own stringification."""
    return hashlib.sha256(js_json_stringify(_canonical(payload)).encode("utf-8")).hexdigest()


def _latest_digest(conn: Connection, source: str) -> str | None:
    table = CAPTURE_SNAPSHOTS
    query = (
        select(table.c.digest)
        .where(table.c.source == source)
        .order_by(table.c.captured_at.desc(), table.c.id.desc())
        .limit(1)
    )
    return conn.execute(query).scalar_one_or_none()


@dataclass(frozen=True)
class FeedOutcome:
    source: str
    status: Status
    requests: int
    reason: str | None = None
    # What the read wrote beside its snapshot (the player list's club count), for the job's line.
    note: str | None = None


@dataclass(frozen=True)
class CaptureResult:
    feeds: list[FeedOutcome]
    reason: str | None = None


# The feed's last successful check (Lane 63): an unchanged list writes no snapshot, so the check says
# when the list was last read. Never moved back by an older pass.
_CHECKED = text(
    f"insert into {CAPTURE_CHECKS.fullname} (source, checked_at) values (:source, :checked_at) "
    "on conflict (source) do update set checked_at = greatest(excluded.checked_at, "
    f"{CAPTURE_CHECKS.name}.checked_at)"
)

_INSERT = text(
    f"insert into {CAPTURE_SNAPSHOTS.fullname} (source, captured_at, digest, payload) "
    "values (:source, :captured_at, :digest, cast(:payload as jsonb))"
)


@dataclass(frozen=True)
class CapturePass:
    """One capture pass's fixed inputs: when it captures, for which season and week, which clubs,
    which feeds, and which of them a freshness key already covers."""

    captured_at: datetime
    season: int
    week: int
    teams: tuple[str, ...] = NFL_TEAM_ABBREVIATIONS
    feeds: Sequence[CaptureFeed] = CAPTURE_FEEDS
    is_fresh: Callable[[str], bool] = lambda _key: False
    game_dates: tuple[str, ...] = ()


def _due(
    feeds: Sequence[CaptureFeed], at: datetime, is_fresh: Callable[[str], bool], context: CaptureContext
) -> tuple[list[CaptureFeed], list[FeedOutcome]]:
    due: list[CaptureFeed] = []
    skipped: list[FeedOutcome] = []
    for feed in feeds:
        if not cadence_allows(feed.cadence, at, context):
            skipped.append(FeedOutcome(feed.source, "off-cadence", 0))
        elif is_fresh(f"commish:capture:attempted:{feed.source}"):
            skipped.append(FeedOutcome(feed.source, "fresh", 0))
        else:
            due.append(feed)
    return due, skipped


def _capture_feed(
    conn: Connection, client: Tank01Client, feed: CaptureFeed, context: CaptureContext, at: datetime
) -> FeedOutcome:
    """One feed, in its own savepoint: a database refusal rolls back this feed alone, and a
    tolerated failure (the provider, the payload, the database) is this feed's outcome, as the
    TypeScript records it and carries on. Anything else is a bug and is re-raised."""
    requests = feed.requests(context)
    try:
        with conn.begin_nested():
            bodies = [client.get(r.path, r.query) for r in requests]
            payload: object = bodies[0] if len(bodies) == 1 else bodies
            if (screened := _screen(feed, context, payload)) is not None:
                return FeedOutcome(feed.source, screened[0], len(requests), screened[1])
            digest = digest_of(payload)
            if digest == _latest_digest(conn, feed.source):
                return _read_outcome(conn, feed, payload, FeedOutcome(feed.source, "unchanged", len(requests)))
            row = {"source": feed.source, "captured_at": at, "digest": digest, "payload": js_json_stringify(payload)}
            conn.execute(_INSERT, row)
            return _read_outcome(conn, feed, payload, FeedOutcome(feed.source, "captured", len(requests)))
    except TOLERATED_FAILURES as error:
        screened = _screen(feed, context, error)
        failed: tuple[Status, str] = ("failed", str(error))
        status, reason = failed if screened is None else screened
        return FeedOutcome(feed.source, status, len(requests), reason)


def _read_outcome(conn: Connection, feed: CaptureFeed, payload: object, read: FeedOutcome) -> FeedOutcome:
    """A read's outcome after its `on_read` write: its note beside it, or a refused write's failure."""
    if feed.on_read is None:
        return read
    effect = feed.on_read(conn, payload)
    if effect.refused:
        return FeedOutcome(read.source, "failed", read.requests, effect.note)
    return FeedOutcome(read.source, read.status, read.requests, note=effect.note)


def _screen(feed: CaptureFeed, context: CaptureContext, answer: object) -> tuple[Status, str] | None:
    return None if feed.screen is None else feed.screen(context, answer)


def screen_projection(read: ProjectionRead, answer: object) -> tuple[Status, str] | None:
    """The week ahead's not-yet-published answer is its own outcome, logged and retried the next hour,
    never a failure. A slot's, two hours before kickoff, is a failure, and so is a slot's empty body;
    neither is stored, so the slot reads again in its window. The week ahead's empty body is not yet
    published either. Every other answer is stored, and the parser refuses drift."""
    kind = projection_answer(answer)
    if kind is None:
        return None
    if read.ahead:
        return "unpublished", f"week {read.week} not published yet"
    if isinstance(answer, Tank01Error):
        return None
    said = "no players" if kind == "unpublished" else "an empty body"
    return "failed", f"week {read.week} answered {said} two hours before its kickoff"


def capture_once(
    conn: Connection,
    client: Tank01Client,
    capture: CapturePass,
    budget: RequestBudget,
) -> CaptureResult:
    """`captureOnce`: due feeds, one budget reservation, each feed captured, unchanged or failed."""
    day = js_iso(capture.captured_at)[:10].replace("-", "")
    context = CaptureContext(capture.season, capture.week, day, capture.teams, capture.game_dates)
    due, skipped = _due(capture.feeds, capture.captured_at, capture.is_fresh, context)
    if not due:
        return CaptureResult(skipped)
    reservation = budget.reserve(sum(len(feed.requests(context)) for feed in due))
    if not reservation.granted:
        return CaptureResult(
            [*skipped, *(FeedOutcome(feed.source, "budget-refused", 0) for feed in due)],
            f"The upstream request budget refused the capture pass ({reservation.denial or 'denied'}).",
        )
    outcomes = [_capture_feed(conn, client, feed, context, capture.captured_at) for feed in due]
    record_checks(conn, outcomes, capture.captured_at)
    return CaptureResult([*skipped, *outcomes])


def record_checks(conn: Connection, outcomes: Sequence[FeedOutcome], at: datetime) -> None:
    """Each feed read this pass, captured or unchanged, marked checked at the pass's instant."""
    checked = [{"source": o.source, "checked_at": at} for o in outcomes if o.status in ("captured", "unchanged")]
    if checked:
        conn.execute(_CHECKED, checked)


def current_nfl_week(conn: Connection, season: int) -> int:
    """`currentNflWeek`: the earliest week not yet final, or week 1 when the table is empty."""
    query = (
        select(PROVIDER_WEEKS.c.week)
        .where(PROVIDER_WEEKS.c.season == season, PROVIDER_WEEKS.c.status != "final")
        .order_by(PROVIDER_WEEKS.c.week)
        .limit(1)
    )
    week = conn.execute(query).scalar_one_or_none()
    return 1 if week is None else int(week)


def week_projection_feed(read: ProjectionRead) -> CaptureFeed:
    """The weekly projection of one week: a kickoff slot's own, or the week ahead's daily read, whose
    not-yet-published answer is logged and retried the next hour, never a failure (`projections`)."""
    return CaptureFeed(
        PROJECTIONS_SOURCE,
        "daily",
        lambda _c: [CaptureRequest(Paths.PROJECTIONS, {"week": str(read.week)})],
        lambda _c, answer: screen_projection(read, answer),
    )


def run_capture_harvest(conn: Connection, client: Tank01Client, fired_at: datetime, season: int) -> CaptureResult:
    """The capture-harvest job's capture: five feeds, a ten-request ceiling, no freshness keys; as a
    sixth, one week's projection when one is due (`projections.projection_week_due`: a kickoff slot's
    week in its window not yet captured, else the week ahead's first read of the day from 06:00
    Eastern, never both in one pass). The lines feed takes one request per game day left in the
    week, so a pass is at most ten requests: four single feeds, the projection, and a holiday week's
    five game days. Parsing the stored projections is the caller's next transaction
    (`projections.parse_stored_projections`), so a refused snapshot never rolls back what this pass
    captured. The player list, for the return dates (B79) and each listed player's club (Lane 122), is
    read after the game status on what is left (`capture_return_dates`)."""
    read = projection_week_due(conn, season, fired_at)
    feeds = [*harvest_feeds(), *([] if read is None else [week_projection_feed(read)])]
    capture = CapturePass(
        fired_at,
        season,
        current_nfl_week(conn, season),
        feeds=feeds,
        game_dates=stored_week_game_dates(conn, season, fired_at),
    )
    return capture_once(conn, client, capture, FixedBudget(CAPTURE_HARVEST_REQUEST_BUDGET))


def run_capture_status(conn: Connection, client: Tank01Client, fired_at: datetime, season: int) -> CaptureResult:
    """The game-day status capture (Lane 263): the injury designations and the inactives, a two-request ceiling,
    no freshness keys. Run every 15 minutes in the game-day windows (`infra/research-schedule.sh`)."""
    capture = CapturePass(fired_at, season, current_nfl_week(conn, season), feeds=status_feeds())
    return capture_once(conn, client, capture, FixedBudget(CAPTURE_STATUS_REQUEST_BUDGET))


# The player list's day opens at 06:00 Eastern, the harvest's first pass of the day.
RETURN_DATES_FROM: Final = time(6)
# On a day with a game of the current week the list is read again from 09:00 Eastern (Lane 160, B138): a
# return date the provider moved overnight reaches the API before the day's first kickoff (13:00 Sunday).
GAME_DAY_RETURN_DATES_FROM: Final = time(9)
# The player list is one request (`PLAYER_LIST_FEED`): the budget of a read outside the harvest's pass.
PLAYER_LIST_REQUESTS: Final = 1

_LIST_CHECKED: Final = text(f"select checked_at from {CAPTURE_CHECKS.fullname} where source = :source")


def latest_player_list(conn: Connection) -> ListRead | None:
    """The newest stored player list, the one the backfill applies (`player_clubs.backfill_player_clubs`)."""
    table = CAPTURE_SNAPSHOTS
    query = (
        select(table.c.captured_at, table.c.payload)
        .where(table.c.source == PLAYER_LIST_SOURCE)
        .order_by(table.c.captured_at.desc(), table.c.id.desc())
        .limit(1)
    )
    row = conn.execute(query).first()
    return None if row is None else ListRead(row.captured_at, row.payload)


def return_dates_opening(now: datetime, game_dates: Sequence[str]) -> datetime | None:
    """The latest opening of the player list's read at or before `now`: 06:00 Eastern each day and, on a
    day `game_dates` holds (YYYYMMDD, Eastern), 09:00 too; None before the day's first."""
    east = now.astimezone(_EASTERN)
    game_day = east.strftime("%Y%m%d") in game_dates
    hours = (RETURN_DATES_FROM, *((GAME_DAY_RETURN_DATES_FROM,) if game_day else ()))
    opened = [o for o in (datetime.combine(east.date(), h, _EASTERN) for h in hours) if o <= east]
    return max(opened, default=None)


def return_dates_due(conn: Connection, now: datetime, season: int) -> bool:
    """The player list is due once an Eastern day from 06:00, and again from 09:00 on a game day of the
    current week (Lane 160), until a pass reads it (captured or unchanged, `capture_checks`). A failed read
    records no check, so the next pass asks again; an operator's full capture after an opening is that
    opening's read too."""
    opens = return_dates_opening(now, stored_week_game_dates(conn, season, now))
    if opens is None:
        return False
    checked = conn.execute(_LIST_CHECKED, {"source": PLAYER_LIST_SOURCE}).scalar_one_or_none()
    return checked is None or checked < opens


def capture_return_dates(
    conn: Connection, client: Tank01Client, now: datetime, season: int, budget: FixedBudget
) -> FeedOutcome | None:
    """The day's read of the player list (B79), and a game day's morning read (Lane 160), last in the
    harvest's pass, on what the capture and the game status left of the pass's ten requests, so it never
    costs a game its final; None when the read is taken or not yet due. A pass with nothing left names it
    left for a later pass (the next hour asks again), never a failure; a provider failure or a list with no
    players is a failure, stored nowhere, and asked again the next hour."""
    if not return_dates_due(conn, now, season):
        return None
    return read_player_list(conn, client, now, season, budget)


def read_player_list(
    conn: Connection, client: Tank01Client, now: datetime, season: int, budget: FixedBudget
) -> FeedOutcome:
    """One read of the player list, due or not: the harvest's (`capture_return_dates`) and the Thursday
    pass's before its freeze (Lane 160, `inseason/season_week.player_list`). The same feed, screen and club
    refresh, so it is stored, checked and counted as the daily read is."""
    if budget.limit < PLAYER_LIST_REQUESTS:
        return FeedOutcome(PLAYER_LIST_SOURCE, "budget-refused", 0, "left for a later pass, this pass's requests spent")
    capture = CapturePass(now, season, current_nfl_week(conn, season), feeds=(PLAYER_LIST_FEED,))
    (outcome,) = capture_once(conn, client, capture, budget).feeds
    return outcome
