"""WHEN A PLAYER ON A SEASON-LONG LIST IS DUE BACK, AND THE WEEK IT IS READ AGAINST (Lane 153).

The status read (`designations.read_statuses`) takes the return rule's two inputs here, as the API's
`returnDates` and `Season.weekEnd` read them:

- THE RETURN DAYS. The daily player list (`tank01_player_list`, the harvest's day read) carries each
  injured player's expected return (`injury.injReturnDate`, YYYYMMDD); the hourly injury list carries
  none. Its newest capture within `NOTE_WINDOW` of the status list dates it. A date reads only strictly:
  the list names him under the same status, the day is a real one, and it is no earlier than the list's
  own Eastern day (an earlier one is a date the provider let pass). The provider's `injDate` is never
  read. The list is never loaded whole (some 4 MB): the store picks out the dated entries.
- HIS CLUB'S GAME. The day of his club's kickoff in the current week, Eastern (Lane 153 fix round 1): the
  earliest week whose last kickoff falls today or later (the nflverse schedule's kickoff observations, the
  latest per club as the API reads it). A club on a bye this week has none.
- HIS CLUB. The board's club, `provider_players.team` (`board_clubs`), the column the API's board reads
  (`api/internal/boards/market.go` `columns`, `pp.team`) and the daily list's read writes
  (`pipeline/tank01/player_clubs.refresh_player_clubs`, Lane 122), never the list entry's own `team`: the two
  readers then name the same game day for a player traded mid-week, and for one the club refresh refused
  (more than its ceiling of changes) both keep his previous club until it lands (Lane 160, B139). A free
  agent has no club there, so no game day: his day is carried, as the API's.
"""

from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Final

from sqlalchemy import Connection, func, select, text

from research.db.schema import PROVIDER_PLAYERS
from research.model.designations import status_of
from research.nightly.reads.schedule import EASTERN
from research.pipeline.nflverse.schedule import ScheduleMetric, ScheduleSource
from research.pipeline.nflverse.team_codes import product_team_code

PLAYER_LIST_SOURCE: Final = "tank01_player_list"
# The API's maxCaptureEntries: a list dating more players than this is refused, never cut.
MAX_DATED: Final = 5000
_DATE_LENGTH: Final = 8


class ReturnDaysError(ValueError):
    """The player list does not read as a list, or dates more players than the cap."""


@dataclass(frozen=True, slots=True)
class ListedReturn:
    """One player's entry on the player list: his code in the provider's words and the date it gives."""

    code: str
    date: str


def eastern_day(instant: datetime) -> date:
    """The Eastern calendar day an instant falls on."""
    return instant.astimezone(EASTERN).date()


def return_day(entry: ListedReturn | None, status: str, listed_at: datetime) -> date | None:
    """The API's ReturnOnOf: the entry's day when it names him under `status` and reads strictly, no
    earlier than the list's own Eastern day; None otherwise, never a guess."""
    if entry is None or status_of(entry.code) != status or len(entry.date) != _DATE_LENGTH or not entry.date.isdigit():
        return None
    try:
        day = datetime.strptime(entry.date, "%Y%m%d").date()
    except ValueError:
        return None
    return None if day < eastern_day(listed_at) else day


_LISTED: Final = text(
    "with newest as (select payload, captured_at from research.capture_snapshots "
    "where source = :source and captured_at <= :before order by captured_at desc limit 1) "
    "select n.captured_at, jsonb_typeof(n.payload) = 'array' as list, btrim(coalesce(e->>'playerID', '')) as id, "
    "coalesce(e->'injury'->>'designation', '') as code, btrim(coalesce(e->'injury'->>'injReturnDate', '')) as day "
    "from newest n left join lateral jsonb_array_elements(case when jsonb_typeof(n.payload) = 'array' "
    "then n.payload else '[]'::jsonb end) as e on jsonb_typeof(e) = 'object' and jsonb_typeof(e->'injury') = 'object' "
    "and btrim(coalesce(e->'injury'->>'injReturnDate', '')) <> '' limit :most"
)


@dataclass(frozen=True, slots=True)
class ReturnList:
    """The player list's newest capture near the status list: its stamp and each dated entry by id."""

    listed_at: datetime
    entries: Mapping[str, ListedReturn]


def listed_returns(conn: Connection, status_at: datetime, window: timedelta) -> ReturnList | None:
    """The newest player list at or before `status_at + window`, None with none or one older than
    `status_at - window` (too far from the status list to date it)."""
    rows = conn.execute(
        _LISTED, {"source": PLAYER_LIST_SOURCE, "before": status_at + window, "most": MAX_DATED + 1}
    ).all()
    if not rows:
        return None
    listed_at = rows[0].captured_at
    if not rows[0].list:
        raise ReturnDaysError(f"the player list of {listed_at.isoformat()} is not a list")
    if len(rows) > MAX_DATED:
        raise ReturnDaysError(f"the player list dates over {MAX_DATED} players")
    if listed_at < status_at - window:
        return None
    entries = {r.id: ListedReturn(r.code, r.day) for r in rows if r.id}
    return ReturnList(listed_at, entries)


# The current week (the earliest whose latest kickoff is today or later, Eastern) and each club's game in
# it: each club-week's latest kickoff observation, the API's read (boards.kickoffs).
_CLUB_DAYS: Final = text(
    "with kickoffs as (select season, week, team, max(as_of) as as_of "
    "from research.team_week_observations where source = :source and metric = :metric "
    "group by season, week, team), "
    "current_week as (select season, week from kickoffs group by season, week "
    "having max(as_of) >= :today order by max(as_of) limit 1) "
    "select k.team, k.as_of from kickoffs k join current_week w using (season, week)"
)


def club_game_days(conn: Connection, now: datetime) -> Mapping[str, date]:
    """Each club's game day in the current week at `now`, Eastern, by the product's club code (LAR, WSH;
    Lane 153 fix round 1). A club on a bye this week, or every club once no game is left, is absent."""
    today = datetime.combine(eastern_day(now), datetime.min.time(), EASTERN)
    rows = conn.execute(
        _CLUB_DAYS,
        {"source": ScheduleSource.KICKOFF, "metric": ScheduleMetric.KICKOFF_INSTANT, "today": today},
    ).all()
    return {product_team_code(r.team): eastern_day(r.as_of) for r in rows}


def board_clubs(conn: Connection, player_ids: Iterable[str]) -> Mapping[str, str]:
    """Each player's club on the board, by provider id, in the product's codes (LAR, WSH): the stored
    `provider_players.team` the API's board reads as his club. A free agent (no club) or a player the store
    does not hold is absent."""
    ids = sorted(set(player_ids))
    if not ids:
        return {}
    table = PROVIDER_PLAYERS
    club = func.upper(func.btrim(table.c.team))
    rows = conn.execute(select(table.c.id, club.label("team")).where(table.c.id.in_(ids), table.c.team.is_not(None)))
    return {str(r.id): product_team_code(str(r.team)) for r in rows if r.team}
