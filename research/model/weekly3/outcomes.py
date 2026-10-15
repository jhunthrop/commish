"""THE ROUND'S ONE OUTCOME READER, EXTENDED TO USAGE: every week-W line, count and club.

Preregistration section 2, "Fitted in this round": every week-W count stage 1 or delta reads as a
target, and every week-W line, goes through the round's seasoned, ledgered outcome reader (round 2's
`WeekOutcomeReader`, extended to usage), never through an input read. Section 5, G5: the fit's
reader serves only the fit seasons, the judgment's only the judgment season, both refuse 2026.

The points are round 2's reader's (the published line at the far future, a correction counting); the
work beside them is read at the same far future, after round 2's reader has admitted the season, so
both are on its one ledger. A line-week's work takes the work module's defaults (no play-by-play
row: 0 red-zone opportunities; no snap row: snap share 0), and its club is the line's edge, used
only to count the first games after a trade.
"""

from collections.abc import Mapping
from dataclasses import dataclass
from types import MappingProxyType
from typing import Final

from sqlalchemy import Connection

from research.model.domain import Position
from research.model.instants import FAR_FUTURE
from research.model.reads.observations import ObservationQuery, WeekRange, observations_as_of
from research.model.reads.teams import player_teams_as_of
from research.model.weekly2.gates import Thresholds
from research.model.weekly2.guard import LAST_JUDGED_WEEK, WeekOutcomeReader
from research.model.weekly2.guard import fit_reader as points_fit_reader
from research.model.weekly2.guard import judgment_reader as points_judgment_reader
from research.model.weekly3.work import USAGE_METRICS, ZERO, PlayerGame, Work, player_games

LINE_WITHOUT_EDGE: Final = "line_without_club_edge"


@dataclass(frozen=True, slots=True)
class Outcome:
    """One player's week-W line in each format, the week's work, his club, and the defaults taken."""

    points: Mapping[str, float]
    work: Work
    club: str | None
    defaults: frozenset[str]


GameOutcomes = Mapping[int, Mapping[str, Outcome]]  # week -> player -> outcome


def _outcome(points: Mapping[str, float], game: PlayerGame | None) -> Outcome:
    if game is None:
        return Outcome(points, ZERO, None, frozenset({LINE_WITHOUT_EDGE}))
    return Outcome(points, game.work, game.club, game.defaults)


@dataclass(frozen=True, slots=True)
class GameOutcomeReader:
    """Round 2's reader with the usage beside its lines; `served` is round 2's ledger."""

    points: WeekOutcomeReader

    @property
    def served(self) -> tuple[int, ...]:
        return self.points.served

    def season(
        self, conn: Connection, season: int, positions: Mapping[str, Position]
    ) -> tuple[GameOutcomes, "GameOutcomeReader"]:
        """Each lined player's outcome in each week through 17, and the reader with the season on
        its ledger; a refused season is refused before any read."""
        lined, admitted = self.points.season(conn, season, positions)
        span = WeekRange(1, LAST_JUDGED_WEEK)
        observations = observations_as_of(conn, ObservationQuery(season, span, FAR_FUTURE, metrics=USAGE_METRICS))
        games = player_games(observations, player_teams_as_of(conn, season, span, FAR_FUTURE))
        by_week = {(g.week, pid): g for pid, played in games.items() for g in played}
        found = {
            week: MappingProxyType({pid: _outcome(points, by_week.get((week, pid))) for pid, points in by.items()})
            for week, by in lined.items()
        }
        return MappingProxyType(found), GameOutcomeReader(admitted)


def fit_reader(t: Thresholds) -> GameOutcomeReader:
    """The fit's reader: the judgment season and every season after it refused."""
    return GameOutcomeReader(points_fit_reader(t))


def judgment_reader(t: Thresholds) -> GameOutcomeReader:
    """The judgment's reader: every season after the judgment season refused."""
    return GameOutcomeReader(points_judgment_reader(t))
