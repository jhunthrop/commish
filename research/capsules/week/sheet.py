"""ONE PLAYER'S WEEK, STAMPED: the facts the week-ahead read is written from (`render` prints them).

Every fact carries the stamp of the read it came from, and none may be stamped after the write
(`WeekSheet.__post_init__`): the schedule row behind the kickoff, the published projection's capture
and the one before it, the injury report's capture, the game figures' read, the venue's read and the
forecast's, the stat lines behind his last games, his rate and the opponent's allowances, the depth
chart's release, and the published board's.

THE PROJECTION IS PUBLISHED, NEVER OURS. Until a round of our weekly number passes and the served path
says so (`PROJECTION_BASIS`), the week's number is the projection published for the week, and the sheet
says so in those words beside it, every time. The sheet never prints the game's spread or a sportsbook
word: the club's expected points are the one game figure it carries.
"""

from collections.abc import Mapping
from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Final
from zoneinfo import ZoneInfo

from research.capsules.facts.team_names import team_name_forms
from research.capsules.page_figures import page_tenth, page_tenth_text
from research.capsules.season_voice import SeasonClock
from research.capsules.week.angles import Angle

CENTRAL: Final = ZoneInfo("America/Chicago")
# The week's number is the published projection until the served path flips this (the founder's ruling:
# no weekly number of ours until a round passes). The prompt and the rules read it.
PROJECTION_BASIS: Final = "published"
# The statuses that keep him off the field this week (the contract's words, `model.designations`).
CANNOT_PLAY: Final = frozenset({"out", "injured_reserve", "suspended", "pup", "nfi"})
# The statuses no read may tell a manager to start him under: those, and Doubtful (the coordinator's H2).
NO_START: Final = CANNOT_PLAY | {"doubtful"}
STATUS_WORDS: Final[Mapping[str, str]] = {
    "questionable": "Questionable",
    "doubtful": "Doubtful",
    "out": "Out",
    "injured_reserve": "on injured reserve",
    "suspended": "suspended",
    "pup": "on the physically unable to perform list",
    "nfi": "on the non-football injury list",
}
# A player designated to return this week (Lane 153), by the list he returns from: the one sentence the sheet
# and the facts block say it in, with his day ("Sun Oct 25").
RETURNING_FROM_WORDS: Final[Mapping[str, str]] = {
    "injured_reserve": "Designated to return from injured reserve",
    "pup": "Designated to return from the physically unable to perform list",
    "nfi": "Designated to return from the non-football injury list",
    "suspended": "Back from his suspension",
}


def returning_words(status: "Status") -> str | None:
    """ "Designated to return from injured reserve, expected back Sun Oct 25.": the sheet's one sentence for a
    player designated to return this week, None for any other status."""
    if status.returning is None or status.returning_from is None:
        return None
    day = status.returning
    return f"{RETURNING_FROM_WORDS[status.returning_from]}, expected back {day:%a} {day:%b} {day.day}."


# The two orders a board place comes from, and the words a read says it in (the coordinator's M2).
REST_OF_SEASON: Final = "rest_of_season"
ORDER_WORDS: Final[Mapping[bool, str]] = {True: "our rest-of-season order", False: "our preseason order"}


def central_day_and_time(instant: datetime, *, short: bool = False) -> str:
    """An instant as the page says it, in Central time: "Sunday 3:05 pm" ("Sun 3:05 pm" when short)."""
    local = instant.astimezone(CENTRAL)
    return f"{local.strftime('%a' if short else '%A')} {_clock(local)}"


def _clock(local: datetime) -> str:
    """A local time of day as the page says it: "3:05 pm"."""
    hour = local.hour % 12 or 12
    return f"{hour}:{local.minute:02d} {'am' if local.hour < 12 else 'pm'}"  # noqa: PLR2004 - noon


# The zone's short name after a page stamp (Lane 139, C12), as the web's `stampAt` names Central.
CENTRAL_SHORT: Final = "CT"


def central_stamp(instant: datetime) -> str:
    """An instant as a page stamp says it, in Central time with the day's date (Lane 139, C12): "Wed Oct 21,
    11:12 am CT", the web's one stamp format (`format/clock.ts stampAt`)."""
    local = instant.astimezone(CENTRAL)
    return f"{local.strftime('%a %b')} {local.day}, {_clock(local)} {CENTRAL_SHORT}"


def points_text(value: float) -> str:
    """A figure in points as the page prints it, to the tenth by the site's one rule (`page_figures`)."""
    return page_tenth_text(value)


@dataclass(frozen=True, slots=True)
class WeekGame:
    """His club's game: the week, the opponent (the board's code), home or away, the kickoff, and the
    schedule row's read."""

    week: int
    opponent: str
    home: bool
    kickoff: datetime
    scheduled_at: datetime | None = None


@dataclass(frozen=True, slots=True)
class PublishedProjection:
    """The week's published projection in PPR points at its capture, and the snapshot's figure before it."""

    points: float
    captured_at: datetime
    previous_points: float | None
    previous_captured_at: datetime | None


@dataclass(frozen=True, slots=True)
class ExpectedScore:
    """The game's expected points for his club and its opponent, at the figures' read."""

    club_points: float
    opponent_points: float
    read_at: datetime


@dataclass(frozen=True, slots=True)
class Weather:
    """The venue's roof at the game's read, and for an open sky the kickoff hour's forecast at its read (a
    value it does not hold is None)."""

    roof: str | None
    temperature_f: float | None
    wind_mph: float | None
    precipitation_chance: float | None
    precipitation_kind: str | None
    read_at: datetime | None
    roof_read_at: datetime | None = None


@dataclass(frozen=True, slots=True)
class Allowed:
    """The opponent's PPR points allowed a game to his position this season and its rank (1 the fewest)."""

    rank: int
    of: int
    points_a_game: float
    position: str
    through: int
    read_at: datetime


@dataclass(frozen=True, slots=True)
class Status:
    """His designation on the newest injury report (the contract's word, None for none), its capture (when
    the list last changed) and the capture job's last check of that list (None when the store records
    none)."""

    status: str | None
    captured_at: datetime | None
    checked_at: datetime | None = None
    # Designated to return this week (the return rule, Lane 153): the day he is due back and the season-long
    # list he returns from. His status is then this week's question (`RETURNING_STATUS`): he may play.
    returning: date | None = None
    returning_from: str | None = None

    @property
    def returning_this_week(self) -> bool:
        return self.returning is not None and self.returning_from is not None

    def seen_at(self, written_at: datetime) -> datetime | None:
        """The newest instant the list is known to have stood, at or before the write: its last check when
        that came by then, else its capture."""
        if self.checked_at is not None and self.captured_at is not None and self.checked_at <= written_at:
            return max(self.captured_at, self.checked_at)
        return self.captured_at


@dataclass(frozen=True, slots=True)
class DepthPlace:
    slot: float
    around: tuple[tuple[str, float], ...]
    released_at: datetime | None = None


@dataclass(frozen=True, slots=True)
class GameLine:
    week: int
    opponent: str
    home: bool
    points: float


@dataclass(frozen=True, slots=True)
class BoardPlace:
    """His place in our published order: the rest of the season from `from_week`, or the preseason board."""

    rank: int
    position_rank: int
    points: float | None
    basis: str
    from_week: int | None
    published_at: datetime

    @property
    def rest_of_season(self) -> bool:
        return self.basis == REST_OF_SEASON and self.from_week is not None

    @property
    def order_words(self) -> str:
        return ORDER_WORDS[self.rest_of_season]


@dataclass(frozen=True, slots=True)
class LastRead:
    """The read before this one for the same week: when it was written, and what it was written with."""

    written_at: datetime
    projection_points: float | None
    status: str | None


@dataclass(frozen=True, slots=True)
class WeekSheet:
    """One player's week. `game` is his next game: this week's, or after a bye (`bye`) the one after it."""

    player_id: str
    name: str
    position: str
    team: str
    season: int
    week: int
    written_at: datetime
    game: WeekGame | None
    bye: bool
    projection: PublishedProjection | None
    expected: ExpectedScore | None
    weather: Weather | None
    allowed: Allowed | None
    status: Status
    depth: DepthPlace | None
    last_games: tuple[GameLine, ...]
    points_per_game: float | None
    games_played: int
    touchdowns: float | None
    through: int
    played: tuple[int, ...]
    missed: tuple[int, ...]
    board: BoardPlace | None
    last_read: LastRead | None = None
    lines_at: datetime | None = None
    basis: str = field(default=PROJECTION_BASIS)
    # What sets his week apart, most unusual first (Lane 300, `angles`), and his depth slot on the release
    # before the newest when it moved (`depth_moves`): empty and None while `ANGLES_ON` is off.
    angles: tuple[Angle, ...] = ()
    depth_moved_from: float | None = None

    def __post_init__(self) -> None:
        late = [name for name, at in self._stamped().items() if at > self.written_at]
        if late:
            raise ValueError(f"{self.name}: {', '.join(late)} stamped after the write at {self.written_at.isoformat()}")

    def _stamped(self) -> dict[str, datetime]:
        p, w = self.projection, self.weather
        stamps = {
            "schedule": None if self.game is None else self.game.scheduled_at,
            "projection": None if p is None else p.captured_at,
            "projection_before": None if p is None else p.previous_captured_at,
            "status": self.status.captured_at,
            "expected": None if self.expected is None else self.expected.read_at,
            "venue": None if w is None else w.roof_read_at,
            "forecast": None if w is None else w.read_at,
            "stat_lines": self.lines_at,
            "allowed": None if self.allowed is None else self.allowed.read_at,
            "depth_chart": None if self.depth is None else self.depth.released_at,
            "board": None if self.board is None else self.board.published_at,
        }
        return {name: at for name, at in stamps.items() if at is not None}

    def stamps(self) -> dict[str, str]:
        """Each fact's stamp, ISO 8601, as the row keeps them."""
        return {name: at.isoformat() for name, at in self._stamped().items()}

    @property
    def facts_at(self) -> datetime | None:
        """The newest stamp of the facts the read was written from."""
        return max(self._stamped().values(), default=None)

    @property
    def can_play(self) -> bool:
        return not self.bye and self.status.status not in CANNOT_PLAY

    @property
    def may_start(self) -> bool:
        """Whether a read may tell a manager to start him this week: not on a bye, not out, not Doubtful."""
        return not self.bye and self.status.status not in NO_START

    @property
    def clock(self) -> SeasonClock:
        return SeasonClock(self.season, self.through, self.played, self.missed)

    @property
    def projection_change(self) -> float | None:
        p = self.projection
        return None if p is None or p.previous_points is None else _rounded(p.points - p.previous_points)

    @property
    def change_since_last_read(self) -> float | None:
        p, last = self.projection, self.last_read
        if p is None or last is None or last.projection_points is None:
            return None
        return _rounded(p.points - last.projection_points)


def _rounded(value: float) -> float:
    return page_tenth(value)


def sheet_names(sheet: WeekSheet) -> tuple[str, ...]:
    """The names a sheet lets its read print: his and his teammates' on the chart and in his angles."""
    around = () if sheet.depth is None else tuple(name for name, _ in sheet.depth.around)
    return (sheet.name, *around, *(name for angle in sheet.angles for name in angle.names))


def week_name_ledger(sheet: WeekSheet) -> tuple[str, ...]:
    """Every name the read may print: his, his teammates on the chart and in his angles, and every club the
    sheet names."""
    clubs = {sheet.team, *(g.opponent for g in sheet.last_games)}
    if sheet.game is not None:
        clubs.add(sheet.game.opponent)
    teammates = () if sheet.depth is None else tuple(name for name, _ in sheet.depth.around)
    teammates = (*teammates, *(name for angle in sheet.angles for name in angle.names))
    forms = [form for club in sorted(clubs) for form in team_name_forms(club)]
    return tuple(dict.fromkeys((sheet.name, *teammates, *forms)))
