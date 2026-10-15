"""ONE WEEK AT ITS MOMENT: every input to a player's weekly number, then the number itself.

Preregistration section 2. The projection for (S, W) is made at one millisecond before week W's
first kickoff (`week_moment`) and sees only what is stamped at or before it: round 3's universe and
season so far (`ros.reads.week_inputs`, the season-aware club rule), the rate m_f
(`ros.model.per_game`, round 3's fitted numbers unchanged), the opponent ratings stored on his
club's week-W row, and his latest filing. ADP and recent form (round 1's) are read beside them as
the benchmarks. x_W,f = m_f x c_W, his points in format f if he plays; a withheld player has none.
"""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime
from types import MappingProxyType
from typing import Final

from sqlalchemy import Connection

from research.model.domain import Position
from research.model.reads.observations import LAST_POSSIBLE_WEEK, ObservationQuery, WeekRange
from research.model.reads.preseason import preseason_rankings_as_of
from research.model.reads.teams import team_observations_as_of
from research.model.register.freeze import IMPLEMENTATION
from research.model.ros.model import FORMATS, RosPriors, per_game
from research.model.ros.reads import StaleBoard, WeekInputs, latest_clubs, week_inputs
from research.model.weekly.inputs import ROUND_READER
from research.model.weekly.round.scoring import SKILL_POSITIONS, form_from_lines
from research.model.weekly2.designation import QUESTIONABLE, WITHHELD, WeekStatus, filed_statuses
from research.model.weekly2.factor import Elasticity, opponent_factor
from research.pipeline.nflverse.context import CONTEXT_SOURCE, ContextMetric

FROZEN: Final = MappingProxyType
Points = Mapping[str, float]


@dataclass(frozen=True, slots=True)
class WeekPlayer:
    """One player of round 3's universe at the week's moment: the inputs to his number."""

    player_id: str
    position: Position
    club: str | None
    rate: Points  # m_f, round 3's points a game
    board: Points | None  # the preseason board's points a game (a reported source)
    games: int  # games played so far this season
    to_date: float  # PPR points over them (the population's second list)
    d_pass: float | None
    d_rush: float | None
    status: WeekStatus


@dataclass(frozen=True, slots=True)
class WeekBoard:
    season: int
    week: int
    moment: datetime
    players: tuple[WeekPlayer, ...]
    adp: Mapping[str, float]  # ADP rank by player, as published at the moment
    form: Mapping[str, Points]  # round 1's recent form by player


def _ratings(
    conn: Connection, season: int, week: int, moment: datetime
) -> dict[str, tuple[float | None, float | None]]:
    """Each club's stored week-W ratings of its opponent's pass and rush defence."""
    by_club: dict[str, dict[str, float]] = {}
    for row in team_observations_as_of(conn, season, week, moment, CONTEXT_SOURCE):
        by_club.setdefault(row.team, {})[row.metric] = row.value
    return {
        club: (found.get(ContextMetric.OPPONENT_PASS_DEFENCE), found.get(ContextMetric.OPPONENT_RUSH_DEFENCE))
        for club, found in by_club.items()
    }


def _form(
    conn: Connection, season: int, week: int, moment: datetime, positions: Mapping[str, Position]
) -> dict[str, Points]:
    """Round 1's recent form, from the two seasons of lines its weekly input read at the moment."""
    history = list(ROUND_READER.lines(conn, ObservationQuery(season - 1, WeekRange(1, LAST_POSSIBLE_WEEK), moment)))
    if week > 1:
        history += ROUND_READER.lines(conn, ObservationQuery(season, WeekRange(1, week - 1), moment))
    return {pid: FROZEN(found) for pid, found in form_from_lines(history, season, week, positions).items()}


def read_week(  # noqa: PLR0913, PLR0917 - the reads one week needs
    conn: Connection,
    season: int,
    week: int,
    stale: StaleBoard,
    positions: Mapping[str, Position],
    priors: RosPriors,
    adp_source: str,
) -> WeekBoard:
    """Every universe player's inputs at (season, week), with the benchmarks beside them."""
    inputs = week_inputs(conn, season, week, stale, positions)
    return week_board(conn, inputs, stale, positions, priors, adp_source)


def week_board(  # noqa: PLR0913, PLR0917 - the week's reads, once its universe is read
    conn: Connection,
    inputs: WeekInputs,
    stale: StaleBoard,
    positions: Mapping[str, Position],
    priors: RosPriors,
    adp_source: str,
) -> WeekBoard:
    """The week's board from its universe (`week_inputs`): the rate, the clubs, the ratings, the
    filings at the week's moment, and the benchmarks."""
    season, week, moment = inputs.season, inputs.week, inputs.moment
    clubs = latest_clubs(conn, season, week, moment) if week > 1 else {}
    ratings = _ratings(conn, season, week, moment)
    statuses = filed_statuses(conn, season, week, moment)
    players: list[WeekPlayer] = []
    for player in inputs.players:
        board = stale.players.get(player.player_id)
        club = clubs.get(player.player_id) or (board.team if board is not None else None)
        d_pass, d_rush = ratings.get(club or "", (None, None))
        per = None if player.stale is None or player.stale.per_game is None else FROZEN(dict(player.stale.per_game))
        players.append(
            WeekPlayer(
                player.player_id,
                player.position,
                club,
                FROZEN({name: per_game(player, name, priors) for name in FORMATS}),
                per,
                len(player.played),
                sum(game.points["ppr"] for game in player.played),
                d_pass,
                d_rush,
                statuses.get(player.player_id, "clear"),
            )
        )
    adp = {row.player_id: row.rank for row in preseason_rankings_as_of(conn, season, adp_source, moment)}
    form = _form(conn, season, week, moment, positions)
    return WeekBoard(season, week, moment, tuple(players), FROZEN(adp), FROZEN(form))


@dataclass(frozen=True, slots=True)
class WeekNumber:
    """A player's weekly number, stamped as the register stamps its rows."""

    season: int
    week: int
    player_id: str
    position: Position
    rate: Points
    factor: float
    number: Points | None  # None: withheld (Out or Doubtful)
    questionable: bool
    model_name: str
    model_version: str
    implementation: str = IMPLEMENTATION


def week_number(
    board: WeekBoard,
    player: WeekPlayer,
    elasticities: Mapping[str, Elasticity],
    model_name: str,
    model_version: str,
) -> WeekNumber:
    """x_W,f = m_f x c_W, or no number when his latest filing lists him Out or Doubtful."""
    factor = opponent_factor(player.d_pass, player.d_rush, elasticities[player.position])
    number = None if player.status == WITHHELD else FROZEN({name: player.rate[name] * factor for name in FORMATS})
    return WeekNumber(
        board.season,
        board.week,
        player.player_id,
        player.position,
        player.rate,
        factor,
        number,
        player.status == QUESTIONABLE,
        model_name,
        model_version,
    )


def skill_players(board: WeekBoard) -> Sequence[WeekPlayer]:
    return [p for p in board.players if p.position in SKILL_POSITIONS]
