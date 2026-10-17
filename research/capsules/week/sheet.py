"""ONE PLAYER'S WEEK, STAMPED: the facts the week-ahead read is written from, and the sheet the writer reads.

Every fact carries the stamp of the read it came from, and none may be stamped after the write
(`WeekSheet.__post_init__`): the published projection's capture, the injury report's capture, the game
figures' read, the forecast's read, the stat lines' newest stamp behind the opponent's allowances, and
the published board's. The kickoff is the schedule's and the depth chart the newest release the facts
pass holds.

THE PROJECTION IS PUBLISHED, NEVER OURS. Until a round of our weekly number passes and the served path
says so (`PROJECTION_BASIS`), the week's number is the projection published for the week, and the sheet
says so in those words beside it, every time. The sheet never prints the game's spread or a sportsbook
word: the club's expected points are the one game figure it carries.

Numbers print as the season sheet prints them (JavaScript's `String`), so a figure the read quotes
traces to the sheet word for word (`capsules.grounding`).
"""

from collections.abc import Mapping
from dataclasses import dataclass, field
from datetime import datetime
from typing import Final
from zoneinfo import ZoneInfo

from research.capsules.facts.team_names import NFL_TEAM_NAMES, team_name_forms
from research.capsules.render_depth import slot_word
from research.capsules.render_season import week_list
from research.capsules.render_words import IN_OUR_RECORDS, ordinal, signed, week_of
from research.capsules.season_voice import SeasonClock
from research.model.jsmath import js_to_fixed
from research.pipeline.jscompat import js_number, js_string

CENTRAL: Final = ZoneInfo("America/Chicago")
# The week's number is the published projection until the served path flips this (the founder's ruling:
# no weekly number of ours until a round passes). The prompt and the rules read it.
PROJECTION_BASIS: Final = "published"
# The statuses that keep him off the field this week (the contract's words, `model.designations`).
CANNOT_PLAY: Final = frozenset({"out", "injured_reserve", "suspended", "pup", "nfi"})
STATUS_WORDS: Final[Mapping[str, str]] = {
    "questionable": "Questionable",
    "doubtful": "Doubtful",
    "out": "Out",
    "injured_reserve": "on injured reserve",
    "suspended": "suspended",
    "pup": "on the physically unable to perform list",
    "nfi": "on the non-football injury list",
}
LAST_FANTASY_WEEK: Final = 17
_ROOF_WORDS: Final[Mapping[str, str]] = {
    "dome": "indoors, under a fixed roof",
    "retractable": "under a retractable roof, open or closed on the day",
}


def central_day_and_time(instant: datetime, *, short: bool = False) -> str:
    """An instant as the page says it, in Central time: "Sunday 3:05 pm" ("Sun 3:05 pm" when short)."""
    local = instant.astimezone(CENTRAL)
    day = local.strftime("%a" if short else "%A")
    hour = local.hour % 12 or 12
    return f"{day} {hour}:{local.minute:02d} {'am' if local.hour < 12 else 'pm'}"  # noqa: PLR2004 - noon


def _points(value: float) -> str:
    return js_string(js_number(js_to_fixed(value, 1)))


@dataclass(frozen=True, slots=True)
class WeekGame:
    """His club's game: the week, the opponent (the board's code), home or away, the kickoff."""

    week: int
    opponent: str
    home: bool
    kickoff: datetime


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
    """The venue's roof, and for an open sky the kickoff hour's forecast (a value it does not hold is None)."""

    roof: str | None
    temperature_f: float | None
    wind_mph: float | None
    precipitation_chance: float | None
    precipitation_kind: str | None
    read_at: datetime | None


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
    """His designation on the newest injury report (the contract's word, None for none) and its capture."""

    status: str | None
    captured_at: datetime | None


@dataclass(frozen=True, slots=True)
class DepthPlace:
    slot: float
    around: tuple[tuple[str, float], ...]


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
    basis: str = field(default=PROJECTION_BASIS)

    def __post_init__(self) -> None:
        late = [name for name, at in self._stamped().items() if at > self.written_at]
        if late:
            raise ValueError(f"{self.name}: {', '.join(late)} stamped after the write at {self.written_at.isoformat()}")

    def _stamped(self) -> dict[str, datetime]:
        stamps = {
            "projection": None if self.projection is None else self.projection.captured_at,
            "projection_before": None if self.projection is None else self.projection.previous_captured_at,
            "status": self.status.captured_at,
            "expected": None if self.expected is None else self.expected.read_at,
            "forecast": None if self.weather is None else self.weather.read_at,
            "allowed": None if self.allowed is None else self.allowed.read_at,
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
    return js_number(js_to_fixed(value, 1))


def _club(code: str) -> str:
    names = NFL_TEAM_NAMES.get(code)
    return code if names is None else f"{code} ({names[0]} {names[1]})"


def _game_words(game: WeekGame, season: int) -> str:
    where = "at home against" if game.home else "away at"
    kickoff = central_day_and_time(game.kickoff)
    return f"{week_of(game.week, season)}, {where} {_club(game.opponent)}, kicking off {kickoff} Central"


def _game_line(sheet: WeekSheet) -> str:
    game = sheet.game
    this_week = week_of(sheet.week, sheet.season)
    if game is None:
        return f"His game: none on the schedule for {this_week}."
    words = _game_words(game, sheet.season)
    if sheet.bye:
        return (
            f"Bye: {sheet.team} do not play in {this_week}, so he does not play in {this_week} and scores no "
            f"points that week. His next game: {words}."
        )
    return f"His game: {words}."


def _status_line(sheet: WeekSheet) -> str:
    status, this_week = sheet.status.status, week_of(sheet.week, sheet.season)
    if status is None:
        return "Injury report: no designation for him on the latest report."
    word = STATUS_WORDS.get(status, status)
    if status in CANNOT_PLAY:
        return f"Injury report: {word} on the latest report. He cannot play in {this_week}."
    if status == "doubtful":
        return f"Injury report: {word} on the latest report, unlikely to play in {this_week}."
    return f"Injury report: {word} on the latest report, so whether he plays in {this_week} is not settled."


def _projection_line(sheet: WeekSheet) -> str | None:
    p = sheet.projection
    if p is None or sheet.bye:
        return None
    parts = [
        f"Published projection for {week_of(sheet.week, sheet.season)}: {_points(p.points)} points in PPR scoring. "
        "It is a projection published for the week, not ours: call it the published projection."
    ]
    change = sheet.projection_change
    if change is not None and p.previous_points is not None:
        parts.append(
            f"The published figure before it was {_points(p.previous_points)} points, a change of {signed(change)} points."
        )
    since = sheet.change_since_last_read
    if since is not None and sheet.last_read is not None and sheet.last_read.projection_points is not None:
        parts.append(
            f"At our last read for this week it was {_points(sheet.last_read.projection_points)} points, "
            f"a change of {signed(since)} points since."
        )
    return " ".join(parts)


def _expected_line(sheet: WeekSheet) -> str | None:
    e, game = sheet.expected, sheet.game
    if e is None or game is None or sheet.bye:
        return None
    return (
        f"Expected points: {sheet.team} {_points(e.club_points)} points, {game.opponent} "
        f"{_points(e.opponent_points)} points, the game's expected score for each club."
    )


def _weather_line(sheet: WeekSheet) -> str | None:
    w = sheet.weather
    if w is None or sheet.bye:
        return None
    roofed = None if w.roof is None else _ROOF_WORDS.get(w.roof)
    if roofed is not None:
        return f"Venue: {roofed}."
    parts = [
        f"{js_string(round(w.temperature_f))} degrees" if w.temperature_f is not None else None,
        f"wind {js_string(round(w.wind_mph))} mph" if w.wind_mph is not None else None,
        f"a {js_string(round(w.precipitation_chance))}% chance of {w.precipitation_kind or 'rain'}"
        if w.precipitation_chance is not None and w.precipitation_kind not in (None, "none")
        else None,
    ]
    said = [part for part in parts if part is not None]
    if not said:
        return "Venue: outdoors, no forecast yet." if w.roof == "outdoors" else None
    where = ", outdoors" if w.roof == "outdoors" else ""
    return f"Forecast for kickoff{where}: {', '.join(said)}."


def _allowed_line(sheet: WeekSheet) -> str | None:
    a, game = sheet.allowed, sheet.game
    if a is None or game is None or sheet.bye:
        return None
    return (
        f"{game.opponent} against {a.position}s in {sheet.season}: {ordinal(a.rank)} of {a.of}, allowing "
        f"{_points(a.points_a_game)} PPR points a game to {a.position}s through {week_of(a.through, sheet.season)} "
        f"(1st allowed the fewest, {ordinal(a.of)} the most)."
    )


def _depth_line(sheet: WeekSheet) -> str | None:
    d = sheet.depth
    if d is None:
        return None
    around = (
        "No other player at his position is listed."
        if not d.around
        else "Listed with him: " + ", ".join(f"{name} {slot_word(slot)}" for name, slot in d.around) + "."
    )
    return (
        f"Depth chart (the latest we hold): listed {slot_word(d.slot)} among {sheet.team} {sheet.position}s. {around}"
    )


def _season_line(sheet: WeekSheet) -> str:
    reach = (
        "no game of his is in our records yet"
        if not sheet.last_games
        else "; ".join(
            f"{week_of(g.week, sheet.season)} {'against' if g.home else 'at'} {g.opponent}, {_points(g.points)} points"
            for g in sheet.last_games
        )
    )
    games = "game" if sheet.games_played == 1 else "games"
    rate = (
        ""
        if sheet.points_per_game is None
        else f" This season: {_points(sheet.points_per_game)} PPR points a game over {sheet.games_played} {games}"
        + ("" if sheet.touchdowns is None else f", {js_string(sheet.touchdowns)} touchdowns")
        + "."
    )
    missed = "" if not sheet.missed else f" He did not play {week_list(sheet.missed, sheet.season)}."
    return f"His last games, newest first (PPR): {reach}.{rate}{missed}"


def _board_line(sheet: WeekSheet) -> str | None:
    b = sheet.board
    if b is None:
        return None
    place = f"{b.rank} overall, {sheet.position}{b.position_rank}"
    if b.basis == "rest_of_season" and b.from_week is not None:
        points = "" if b.points is None else f"{_points(b.points)} PPR points, "
        return (
            f"Our board for the rest of the season, {week_of(b.from_week, sheet.season)} to "
            f"{week_of(LAST_FANTASY_WEEK, sheet.season)}: {points}{place}."
        )
    return f"Our board (the preseason order): {place}."


def render_week_sheet(sheet: WeekSheet) -> str:
    """The week's facts as the writer reads them, one fact to a line."""
    this_week = week_of(sheet.week, sheet.season)
    reach = (
        f"no week's games are {IN_OUR_RECORDS} yet"
        if sheet.through == 0
        else f"every game through {week_of(sheet.through, sheet.season)} is {IN_OUR_RECORDS}"
    )
    lines = [
        f"Player: {sheet.name}, {sheet.position}, {_club(sheet.team)}.",
        f"Today is {central_day_and_time(sheet.written_at)} Central. This read is for {this_week}, the week in "
        f"front of him, and {reach}.",
        _game_line(sheet),
        _status_line(sheet),
        _projection_line(sheet),
        _expected_line(sheet),
        _weather_line(sheet),
        _allowed_line(sheet),
        _depth_line(sheet),
        _season_line(sheet),
        _board_line(sheet),
    ]
    return "\n".join(line for line in lines if line is not None)


def week_name_ledger(sheet: WeekSheet) -> tuple[str, ...]:
    """Every name the read may print: his, his teammates on the chart, and every club the sheet names."""
    clubs = {sheet.team, *(g.opponent for g in sheet.last_games)}
    if sheet.game is not None:
        clubs.add(sheet.game.opponent)
    teammates = () if sheet.depth is None else tuple(name for name, _ in sheet.depth.around)
    forms = [form for club in sorted(clubs) for form in team_name_forms(club)]
    return tuple(dict.fromkeys((sheet.name, *teammates, *forms)))


def week_facts_lines(sheet: WeekSheet) -> tuple[tuple[str, str], ...]:
    """(label, value) for each fact the facts block states, no sentence among them."""
    lines: list[tuple[str, str]] = [("Week", f"{sheet.week} of {sheet.season}")]
    game = sheet.game
    if game is not None:
        where = "vs" if game.home else "at"
        kickoff = f"{where} {game.opponent}, {central_day_and_time(game.kickoff)} Central"
        lines.append(("Game", f"bye, next game week {game.week} {kickoff}" if sheet.bye else kickoff))
    status = sheet.status.status
    lines.append(("Status", "no designation" if status is None else STATUS_WORDS.get(status, status)))
    if sheet.projection is not None and not sheet.bye:
        lines.append(("Published projection", f"{_points(sheet.projection.points)} points (PPR)"))
    if sheet.allowed is not None and not sheet.bye:
        a = sheet.allowed
        lines.append(
            (
                f"Opponent against {a.position}s",
                f"{ordinal(a.rank)} of {a.of}, {_points(a.points_a_game)} points a game",
            )
        )
    if sheet.last_games:
        lines.append(("Last games", ", ".join(f"{_points(g.points)} points" for g in sheet.last_games)))
    if sheet.board is not None:
        lines.append(("Our board", f"{sheet.board.rank} overall, {sheet.position}{sheet.board.position_rank}"))
    return tuple(lines)


def render_week_facts_block(sheet: WeekSheet) -> str:
    """The facts block as stored: one `Label: value` line per fact, the read the writer could not serve."""
    return "\n".join(f"{label}: {value}" for label, value in week_facts_lines(sheet))
