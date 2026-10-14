"""THE REST-OF-SEASON MODEL, `commish_ros_v1`: the stale board's points a game shrunk toward the
season so far by games played, times the games he is expected to play in what is left.

`docs/research/2026-10-14-rest-of-season-preregistration.md` is the authority. Everything here is a
pure function of one player's season to date (`PlayerToDate`) and the fitted numbers (`RosPriors`),
so the judgment and the nightly run the same arithmetic on inputs they read their own way.
"""

from collections.abc import Mapping
from dataclasses import dataclass
from types import MappingProxyType
from typing import Final

from research.model.domain import Position

FORMATS: Final = ("ppr", "half", "std")
LAST_FANTASY_WEEK: Final = 17
SEASON_GAMES: Final = 17
STREAK_CAP: Final = 3
NO_INTERVAL: Final = "none"  # round 3: the in-season board gives no range
BANDS: Final = (("early", 2, 5), ("middle", 6, 10), ("late", 11, 15))


@dataclass(frozen=True, slots=True)
class GamePlayed:
    """One game he played before the projection's week: its points in each format and its usage."""

    week: int
    points: Mapping[str, float]
    targets: float
    carries: float
    pass_attempts: float
    snap_share: float


@dataclass(frozen=True, slots=True)
class StaleEntry:
    """The preseason board's view of him in each format: season points and points a game."""

    projected: Mapping[str, float]
    per_game: Mapping[str, float] | None  # None: no line to take a rate from (the off-board rate stands in)
    availability: float  # expected games over a 17-game season, capped at 1


@dataclass(frozen=True, slots=True)
class PlayerToDate:
    player_id: str
    position: Position
    club_weeks: tuple[int, ...]  # the weeks his club played before the projection's week, in order
    played: tuple[GamePlayed, ...]
    remaining_weeks: tuple[int, ...]  # his club's scheduled weeks from the projection's through 17
    stale: StaleEntry | None

    @property
    def remaining(self) -> int:
        return len(self.remaining_weeks)

    @property
    def streak(self) -> int:
        """How many of his club's most recent games in a row he did not play."""
        played = {game.week for game in self.played}
        missed = 0
        for week in reversed(self.club_weeks):
            if week in played:
                break
            missed += 1
        return missed


@dataclass(frozen=True, slots=True)
class OpportunityLine:
    """A game's points from that game's usage: intercept, then per target, carry, pass attempt and
    unit of offensive snap share."""

    intercept: float
    targets: float
    carries: float
    pass_attempts: float
    snap_share: float

    def points(self, targets: float, carries: float, pass_attempts: float, snap_share: float) -> float:
        return (
            self.intercept
            + self.targets * targets
            + self.carries * carries
            + self.pass_attempts * pass_attempts
            + self.snap_share * snap_share
        )


@dataclass(frozen=True, slots=True)
class Shrinkage:
    k: float
    alpha: float


@dataclass(frozen=True, slots=True)
class RosPriors:
    """Every fitted number the model reads, keyed `position|format`, `position` or by streak."""

    opportunity: Mapping[str, OpportunityLine]
    shrinkage: Mapping[str, Shrinkage]
    availability_k: Mapping[str, float]
    return_next: tuple[float, float, float]  # absence streak 1, 2, 3 or more
    return_later: tuple[float, float, float]
    offboard_rate: Mapping[str, float]
    offboard_availability: Mapping[str, float]
    interval: Mapping[str, tuple[float, float, float]]  # `position|format|band` or `|week<W>`: p10, p50, p90
    interval_by: str = "band"  # round 1: horizon bands; round 2: one cell per projection week


def cell(position: str, format_name: str) -> str:
    return f"{position}|{format_name}"


def band_of(week: int) -> str:
    """The horizon band a projection week falls in; weeks outside every band take the nearest."""
    for name, first, last in BANDS:
        if first <= week <= last:
            return name
    return BANDS[0][0] if week < BANDS[0][1] else BANDS[-1][0]


def season_rate(player: PlayerToDate, format_name: str) -> float | None:
    if not player.played:
        return None
    return sum(game.points[format_name] for game in player.played) / len(player.played)


def opportunity_rate(player: PlayerToDate, line: OpportunityLine) -> float | None:
    if not player.played:
        return None
    count = len(player.played)
    return line.points(
        sum(g.targets for g in player.played) / count,
        sum(g.carries for g in player.played) / count,
        sum(g.pass_attempts for g in player.played) / count,
        sum(g.snap_share for g in player.played) / count,
    )


def prior_rate(player: PlayerToDate, format_name: str, priors: RosPriors) -> float:
    if player.stale is not None and player.stale.per_game is not None:
        return player.stale.per_game[format_name]
    return priors.offboard_rate[cell(player.position, format_name)]


def shrunk_rate(prior: float, games: int, form: float | None, opportunity: float | None, shrink: Shrinkage) -> float:
    """m = (k * p + G * u) / (k + G), u = alpha * r + (1 - alpha) * o; with no games, the prior."""
    if games == 0 or form is None or opportunity is None:
        return prior
    blended = shrink.alpha * form + (1 - shrink.alpha) * opportunity
    return (shrink.k * prior + games * blended) / (shrink.k + games)


def per_game(player: PlayerToDate, format_name: str, priors: RosPriors) -> float:
    key = cell(player.position, format_name)
    return max(
        0.0,
        shrunk_rate(
            prior_rate(player, format_name, priors),
            len(player.played),
            season_rate(player, format_name),
            opportunity_rate(player, priors.opportunity[key]),
            priors.shrinkage[key],
        ),
    )


def play_rate(availability: float, played: int, club_games: int, k: float) -> float:
    """q = (k_q * a + G) / (k_q + T)."""
    return (k * availability + played) / (k + club_games)


def expected_games(player: PlayerToDate, priors: RosPriors) -> float:
    if player.remaining <= 0:
        return 0.0
    availability = (
        player.stale.availability if player.stale is not None else priors.offboard_availability[player.position]
    )
    streak = player.streak
    if streak == 0:
        q = play_rate(availability, len(player.played), len(player.club_weeks), priors.availability_k[player.position])
        return q * player.remaining
    index = min(streak, STREAK_CAP) - 1
    return priors.return_next[index] + priors.return_later[index] * (player.remaining - 1)


@dataclass(frozen=True, slots=True)
class RosProjection:
    player_id: str
    position: Position
    expected_games: float
    per_game: Mapping[str, float]
    projected: Mapping[str, float]


def project(player: PlayerToDate, priors: RosPriors) -> RosProjection:
    games = expected_games(player, priors)
    rates = {name: per_game(player, name, priors) for name in FORMATS}
    return RosProjection(
        player.player_id,
        player.position,
        games,
        MappingProxyType(rates),
        MappingProxyType({name: rate * games for name, rate in rates.items()}),
    )


def interval_key(position: str, format_name: str, week: int, interval_by: str) -> str:
    """The interval cell a projection week reads: its horizon band, or (round 2) its own week."""
    if interval_by == "week":
        return f"{cell(position, format_name)}|week{week}"
    return f"{cell(position, format_name)}|{band_of(week)}"


def interval(
    projected: float, position: str, format_name: str, week: int, priors: RosPriors
) -> tuple[float, float, float]:
    """Floor, median and ceiling: the projection times its cell's fitted ratio percentiles."""
    if projected <= 0:
        return 0.0, 0.0, 0.0
    low, mid, high = priors.interval[interval_key(position, format_name, week, priors.interval_by)]
    return max(0.0, projected * low), max(0.0, projected * mid), max(0.0, projected * high)
