"""ONE SEASON, READ AS THE ROUND SEES IT: each week's rate board, each game's instant and inputs,
and the season's outcomes through the reader.

Preregistration sections 2 and 3. Per week W: the rest-of-season model's universe and rate m, read
at the week's first kickoff (`ros.reads.week_inputs`, stamped for G5 as the `rate` read), with
round 2's benchmarks beside it (`weekly2.board.week_board`: ADP and recent form, and the stored
opponent ratings for the reported ablation); then for every kickoff slot of the week one snapshot at
its instant (`snapshot.read_snapshot`). Each skill player of the universe is placed on his club's
game: his club is his latest club edge this season before W at the instant, else the preseason
board's club; his game is that club's week-W game, and his instant is its t_g. A club with no game
in week W (a bye), or no club, gives no number. The Thursday view (section 5, reported) reads the
same player at the week's first instant.
"""

from collections.abc import Callable, Mapping
from dataclasses import dataclass
from datetime import datetime
from types import MappingProxyType
from typing import Final

from sqlalchemy import Connection

from research.model.arithmetic import ARM64_BOARDS
from research.model.domain import Position
from research.model.priors import ModelArtifacts
from research.model.ros.model import RosPriors
from research.model.ros.reads import StaleBoard, build_stale_board, week_inputs
from research.model.weekly.round.scoring import SKILL_POSITIONS
from research.model.weekly2.board import WeekBoard, WeekPlayer, week_board
from research.model.weekly2.designation import CLEAR, WeekStatus
from research.model.weekly2.gates import Thresholds
from research.model.weekly3.allowance import Allowance, allowance, group_totals
from research.model.weekly3.features import Features, game_features
from research.model.weekly3.instant import Schedule, read_schedule
from research.model.weekly3.ledger import Game, Stamp, stamp_of
from research.model.weekly3.outcomes import GameOutcomeReader, GameOutcomes
from research.model.weekly3.snapshot import PriorSeason, Snapshot, read_prior, read_snapshot
from research.model.weekly3.work import KINDS_BY_POSITION, Kind

NO_GAME_THIS_SEASON: Final = "no_game_this_season"  # the missing-input table's first row: x = m
NO_CLUB: Final = "no_club"  # ... with neither club: no number, counted
NO_GAME_THIS_WEEK: Final = "club_without_a_game_this_week"  # a bye: no number, not scored


@dataclass(frozen=True, slots=True)
class View:
    """A player at one instant: his status from the filings, and his stage-1 inputs (None: he has no
    game this season, so his number is the rate)."""

    status: WeekStatus
    features: Features | None


@dataclass(frozen=True, slots=True)
class Placed:
    """One universe player in one week: the rate board's row, his club and game, and two views: at
    his own game's instant and at the week's first (Thursday's)."""

    player: WeekPlayer
    club: str | None
    moment: datetime | None  # t_g; None: no game this week
    own: View
    thursday: View
    defaults: frozenset[str]


@dataclass(frozen=True, slots=True)
class WeekRead:
    board: WeekBoard
    placed: Mapping[str, Placed]
    games: tuple[Game, ...]
    stamps: tuple[Stamp, ...]


@dataclass(frozen=True, slots=True)
class SeasonRead:
    season: int
    weeks: tuple[WeekRead, ...]
    outcomes: GameOutcomes
    board_moment: str
    stamps: tuple[Stamp, ...]  # the prior season's read

    @property
    def all_stamps(self) -> tuple[Stamp, ...]:
        return (*self.stamps, *(s for week in self.weeks for s in week.stamps))

    @property
    def games(self) -> tuple[Game, ...]:
        return tuple(g for week in self.weeks for g in week.games)


AllowanceOf = Callable[[str, Kind], Allowance]


def _allowance_reader(
    snapshot: Snapshot, schedule: Schedule, positions: Mapping[str, Position]
) -> Callable[[str], AllowanceOf]:
    """Each club's opponent's allowances at the snapshot, computed once per (defence, position, kind)."""
    totals = group_totals(snapshot.games, positions)
    found: dict[tuple[str, str, Kind], Allowance] = {}

    def for_club(club: str) -> AllowanceOf:
        defence = schedule.opponent(snapshot.week, club)

        def of(position: str, kind: Kind) -> Allowance:
            if defence is None:
                raise ValueError(f"no pairing row for {club} in {snapshot.season} week {snapshot.week}")
            key = (defence, position, kind)
            if key not in found:
                found[key] = allowance(defence, snapshot.week, position, kind, schedule, totals, snapshot.team_rows)
            return found[key]

        return of

    return for_club


@dataclass(frozen=True, slots=True)
class _Instant:
    snapshot: Snapshot
    allowances: Callable[[str], AllowanceOf]


def _view(player: WeekPlayer, club: str, at: _Instant, prior: PriorSeason, schedule: Schedule) -> View:
    kinds = KINDS_BY_POSITION[player.position]
    features = game_features(
        player.player_id, player.position, club, at.snapshot, prior.means, schedule, at.allowances(club), kinds
    )
    return View(at.snapshot.statuses.get(player.player_id, CLEAR), features)


def place(
    player: WeekPlayer, stale: StaleBoard, instants: Mapping[datetime, _Instant], prior: PriorSeason, schedule: Schedule
) -> Placed:
    """The player on his club's game at its instant, or with no game; both views."""
    board = stale.players.get(player.player_id)
    fallback = board.team if board is not None else None
    week = next(iter(instants.values())).snapshot.week
    first = min(instants)
    club: str | None = None
    for moment, at in sorted(instants.items()):
        club = at.snapshot.clubs.get(player.player_id) or fallback
        if club is not None and schedule.instant(week, club) == moment:
            own = _view(player, club, at, prior, schedule)
            thursday = own if moment == first else _view(player, club, instants[first], prior, schedule)
            defaults = frozenset() if own.features is not None else frozenset({NO_GAME_THIS_SEASON})
            return Placed(player, club, moment, own, thursday, defaults)
    reason = NO_CLUB if club is None else NO_GAME_THIS_WEEK
    empty = View(CLEAR, None)
    return Placed(player, club, None, empty, empty, frozenset({reason}))


def read_week(  # noqa: PLR0913, PLR0917 - the reads one week needs
    conn: Connection,
    season: int,
    week: int,
    stale: StaleBoard,
    positions: Mapping[str, Position],
    priors: RosPriors,
    schedule: Schedule,
    prior: PriorSeason,
    adp_source: str,
) -> WeekRead:
    inputs = week_inputs(conn, season, week, stale, positions)
    if inputs.moment != schedule.first_moment(week):
        raise ValueError(f"{season} week {week}: the rate's moment is not the week's first instant")
    rate = stamp_of(inputs.newest, season, week, inputs.moment, "rate")
    board = week_board(conn, inputs, stale, positions, priors, adp_source)
    instants: dict[datetime, _Instant] = {}
    for moment in schedule.moments(week):
        snapshot = read_snapshot(conn, season, week, moment)
        instants[moment] = _Instant(snapshot, _allowance_reader(snapshot, schedule, positions))
    placed = {
        p.player_id: place(p, stale, instants, prior, schedule) for p in board.players if p.position in SKILL_POSITIONS
    }
    games = tuple(
        Game(season, week, club, instant)
        for (w, club) in sorted(schedule.kickoffs)
        if w == week and (instant := schedule.instant(week, club)) is not None
    )
    stamps = (rate, *(s for at in instants.values() for s in at.snapshot.stamps))
    return WeekRead(board, MappingProxyType(placed), games, stamps)


def read_season(  # noqa: PLR0913, PLR0917 - the reads one season needs
    conn: Connection,
    season: int,
    t: Thresholds,
    priors: RosPriors,
    artifacts: ModelArtifacts,
    positions: Mapping[str, Position],
    reader: GameOutcomeReader,
) -> tuple[SeasonRead, GameOutcomeReader]:
    """The season's preseason board, its outcomes through the reader, and every judged week."""
    stale = build_stale_board(conn, season, artifacts, ARM64_BOARDS, t.rate_round.prior_source)
    outcomes, reader = reader.season(conn, season, positions)
    schedule = read_schedule(conn, season)
    moments = [m for week in t.weeks for m in schedule.moments(week)]
    prior = read_prior(conn, season, min(moments), max(moments))
    weeks = tuple(
        read_week(conn, season, week, stale, positions, priors, schedule, prior, t.adp_source) for week in t.weeks
    )
    return SeasonRead(season, weeks, outcomes, stale.moment.isoformat(), (prior.stamp,)), reader
