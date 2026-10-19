"""THE CLUBS AND THE STRENGTH OF EACH CLUB'S SCHEDULE.

The slate is the stats provider's fixtures (`provider_games`, the one store the board's byes are read
from). A club's bye is the one regular-season week it plays no game.

STRENGTH. An opponent's value is his expected wins for the season, as the season's published win
totals set them before the first kickoff (`team_week_observations`, the newest publication at or
before the kickoff, by the publisher's own date). A slate's strength is the mean of its opponents'
values, one per game, so a club met twice counts twice. Rank 1 is the hardest slate. The window of a
slate is the earliest and latest publication date among its opponents' values: the source window per
club. The publisher is provenance (the manifest's sources block); no screen names a sportsbook word.

KICKOFF. A game's kickoff is the fixture's own date and Eastern time ("8:20p"), as the slate and the
player card's game log read the same rows. A kickoff the league has not set yet ("TBD") counts from
the start of its day in Eastern time, the earliest it can be, as the web's stand-in counts it.

STATE (Lane 80). At the run's instant a game is final once the store holds its result (the hourly
game status or the weekly result) or a line from either side (Lane 66s's rule, the API's
gameStateAt), kicked off from its kickoff until then, and upcoming before. REST OF SEASON is a slate's games still upcoming: their opponents' mean, ranked the
same way among the clubs with a game left.
"""

import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import date, datetime, time
from typing import Final, Literal
from zoneinfo import ZoneInfo

from sqlalchemy import Connection, text

from research.capsules.facts.team_names import NFL_TEAM_NAMES
from research.errors import ResearchError
from research.model.backtest import sum_left
from research.pipeline.nflverse.team_codes import NFL_TEAM_ABBREVIATIONS, product_team_code
from research.pipeline.tank01.game_status import finals_held
from research.season import REGULAR_SEASON_WEEKS

WIN_TOTAL_SOURCE: Final = "vegas_win_totals"
WIN_TOTAL_METRIC: Final = "vegas_win_total"
OPPONENT_BASIS: Final = "Expected wins, set before the season"
UNIT: Final = "opponents' average expected wins"
EASTERN: Final = ZoneInfo("America/New_York")
KICKOFF_NOT_SET: Final = "TBD"
_KICKOFF_TIME: Final = re.compile(r"^(\d{1,2}):(\d{2})([ap])$")
_HALF_DAY: Final = 12
METHOD: Final = (
    "the average of each club's opponents' expected wins for the season, one per game, set before the first kickoff"
)
REST_METHOD: Final = (
    "the average of each club's remaining opponents' expected wins, one per game still to play, "
    "set before the first kickoff"
)
GameState = Literal["upcoming", "kicked_off", "final"]
ClubWeek = tuple[str, int]


class ScheduleError(ResearchError):
    """The store cannot place a club's slate or value an opponent; the run fails, naming which."""


@dataclass(frozen=True, slots=True)
class Game:
    week: int
    opponent: str
    home: bool
    kickoff: datetime


@dataclass(frozen=True, slots=True)
class OpponentValue:
    value: float
    published: datetime


@dataclass(frozen=True, slots=True)
class Rest:
    """A slate's games still to play: their opponents' mean and its rank, 1 the hardest."""

    strength: float
    rank: int


@dataclass(frozen=True, slots=True)
class Slate:
    club: str
    games: tuple[Game, ...]
    strength: float
    rank: int
    window: tuple[datetime, datetime]
    # None with no game left to play.
    rest: Rest | None = None


@dataclass(frozen=True, slots=True)
class Club:
    abbr: str
    city: str
    nickname: str
    bye: int | None


def kickoff_of(week: int, game_date: date | None, kickoff_et: str | None) -> datetime:
    """A fixture's kickoff instant from its date and Eastern time; a TBD time is the day's start."""
    if game_date is None or kickoff_et is None:
        raise ScheduleError(f"A week {week} fixture has no date or kickoff time on file.")
    if kickoff_et == KICKOFF_NOT_SET:
        return datetime.combine(game_date, time(), EASTERN)
    match = _KICKOFF_TIME.match(kickoff_et)
    if match is None:
        raise ScheduleError(f"A week {week} fixture has an unreadable kickoff {kickoff_et!r}.")
    hour = int(match[1]) % _HALF_DAY + (_HALF_DAY if match[3] == "p" else 0)
    return datetime.combine(game_date, time(hour, int(match[2])), EASTERN)


def slates_by_club(conn: Connection, season: int) -> dict[str, list[Game]]:
    rows = conn.execute(
        text(
            "select week, home_team, away_team, game_date, kickoff_et from research.provider_games "
            "where season = :s and week between 1 and :last order by week, game_id"
        ),
        {"s": season, "last": REGULAR_SEASON_WEEKS},
    )
    games: dict[str, list[Game]] = {club: [] for club in NFL_TEAM_ABBREVIATIONS}
    for row in rows:
        kickoff = kickoff_of(int(row.week), row.game_date, row.kickoff_et)
        for club, opponent, home in ((row.home_team, row.away_team, True), (row.away_team, row.home_team, False)):
            if club not in games:
                raise ScheduleError(f"{season} fixture names {club}, which is not one of the 32 clubs.")
            games[club].append(Game(int(row.week), opponent, home, kickoff))
    return games


def clubs_of(games: Mapping[str, list[Game]]) -> list[Club]:
    """The 32 clubs, each with its bye: the one week of the season's slate it plays no game."""
    weeks = sorted({game.week for slate in games.values() for game in slate})
    clubs = []
    for abbr in NFL_TEAM_ABBREVIATIONS:
        city, nickname = NFL_TEAM_NAMES[abbr]
        played = {game.week for game in games[abbr]}
        open_weeks = [week for week in weeks if week not in played]
        if len(weeks) == REGULAR_SEASON_WEEKS and len(open_weeks) != 1:
            raise ScheduleError(f"{abbr} has {len(open_weeks)} open weeks in a full slate, not one.")
        bye = open_weeks[0] if len(weeks) == REGULAR_SEASON_WEEKS else None
        clubs.append(Club(abbr, city, nickname, bye))
    return clubs


def opponent_values(conn: Connection, season: int, first_kickoff: datetime) -> dict[str, OpponentValue]:
    """Each club's expected wins from the newest publication at or before the first kickoff."""
    rows = conn.execute(
        text(
            "select distinct on (team) team, value, as_of from research.team_week_observations "
            "where season = :s and source = :source and metric = :metric and as_of <= :kickoff "
            "order by team, as_of desc"
        ),
        {"s": season, "source": WIN_TOTAL_SOURCE, "metric": WIN_TOTAL_METRIC, "kickoff": first_kickoff},
    )
    values = {product_team_code(row.team): OpponentValue(float(row.value), row.as_of) for row in rows}
    missing = [club for club in NFL_TEAM_ABBREVIATIONS if club not in values]
    if missing:
        raise ScheduleError(f"No {season} expected wins published before the first kickoff for {', '.join(missing)}.")
    return values


def finals_at(conn: Connection, season: int, as_of: datetime) -> frozenset[ClubWeek]:
    """The club-weeks the store holds a final for at `as_of`, each from its own side: the hourly
    capture's game status (Lane 80, `pipeline/tank01/game_status.py`, the one read the API's
    gameStateAt shares), the weekly result, or a line."""
    return frozenset((product_team_code(team), week) for team, week in finals_held(conn, season, as_of))


def game_states(
    games: Mapping[str, Sequence[Game]], finals: frozenset[ClubWeek], as_of: datetime
) -> dict[ClubWeek, GameState]:
    """Every club-week's game state at `as_of`: final once either side's result or line is held."""
    states: dict[ClubWeek, GameState] = {}
    for club, slate in games.items():
        for game in slate:
            if (club, game.week) in finals or (game.opponent, game.week) in finals:
                states[(club, game.week)] = "final"
            else:
                states[(club, game.week)] = "kicked_off" if game.kickoff <= as_of else "upcoming"
    return states


def _ranks(means: Mapping[str, float]) -> dict[str, int]:
    """1 the hardest (the highest mean), ties by club code."""
    order = sorted(means, key=lambda club: (-means[club], club))
    return {club: index + 1 for index, club in enumerate(order)}


def _mean(values: Sequence[float]) -> float:
    return sum_left(list(values)) / len(values)


def slates(
    games: Mapping[str, list[Game]], values: Mapping[str, OpponentValue], states: Mapping[ClubWeek, GameState]
) -> list[Slate]:
    """Every club's slate with its strength and rank (1 the hardest, ties by club code), and its rest of
    season: the games still upcoming, ranked among the clubs with one left."""
    strengths: dict[str, float] = {}
    rests: dict[str, float] = {}
    windows: dict[str, tuple[datetime, datetime]] = {}
    for club in NFL_TEAM_ABBREVIATIONS:
        slate = games[club]
        if not slate:
            raise ScheduleError(f"{club} has no games on the slate.")
        opponents = [values[game.opponent] for game in slate]
        strengths[club] = _mean([o.value for o in opponents])
        windows[club] = (min(o.published for o in opponents), max(o.published for o in opponents))
        left = [values[g.opponent].value for g in slate if states[(club, g.week)] == "upcoming"]
        if left:
            rests[club] = _mean(left)
    rank, rest_rank = _ranks(strengths), _ranks(rests)
    return [
        Slate(
            club,
            tuple(games[club]),
            strengths[club],
            rank[club],
            windows[club],
            Rest(rests[club], rest_rank[club]) if club in rests else None,
        )
        for club in NFL_TEAM_ABBREVIATIONS
    ]
