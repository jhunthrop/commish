"""THE ROUND'S ONE OUTCOME READER, AND THE LEDGER G4 READS.

Every outcome the round's fits and gates see (a player's points and games after a projection's
moment) is read here. The reader refuses the pristine held-out season always, and refuses the
judgment season inside a fit; each season it serves is written to its ledger, which the isolation
gate checks against the preregistered seasons.
"""

from collections.abc import Mapping
from dataclasses import dataclass
from types import MappingProxyType
from typing import Final

from sqlalchemy import Connection

from research.errors import ResearchError
from research.model.domain import Position, compute_fantasy_points
from research.model.instants import FAR_FUTURE
from research.model.reads.observations import ObservationQuery, WeekRange, stat_lines_for_measurement, usage_as_of
from research.model.ros.model import FORMATS, LAST_FANTASY_WEEK
from research.model.weekly.round.scoring import FORMATS as FORMAT_RULES

PRISTINE_SEASON: Final = 2026


class HeldOutReadError(ResearchError):
    """An outcome read of a season the round may not see."""


@dataclass(frozen=True, slots=True)
class WeekOutcome:
    points: Mapping[str, float]
    played: bool


@dataclass(frozen=True, slots=True)
class SeasonOutcomes:
    """Each player's outcome in each week of one season, as measured."""

    season: int
    by_player: Mapping[str, Mapping[int, WeekOutcome]]

    def rest_of_season(self, player_id: str, first_week: int) -> tuple[dict[str, float], int]:
        """Points in each format and games played from `first_week` through week 17."""
        weeks = self.by_player.get(player_id, {})
        kept = [o for week, o in weeks.items() if first_week <= week <= LAST_FANTASY_WEEK]
        points = {name: sum(o.points[name] for o in kept) for name in FORMATS}
        return points, sum(1 for o in kept if o.played)


@dataclass(frozen=True, slots=True)
class OutcomeReader:
    """Serves a season's outcomes once it is allowed; `served` is the ledger. Immutable: admitting a
    season returns the reader with that season on its ledger, so no two runs can share one ledger."""

    refused: frozenset[int]
    served: tuple[int, ...] = ()

    def admit(self, season: int) -> "OutcomeReader":
        """Refuse a season the round may not see here; return the reader with it on the ledger."""
        if season >= PRISTINE_SEASON or season in self.refused:
            raise HeldOutReadError(f"the round may not read {season} outcomes here")
        return OutcomeReader(self.refused, (*self.served, season))

    def season(
        self, conn: Connection, season: int, positions: Mapping[str, Position]
    ) -> tuple[SeasonOutcomes, "OutcomeReader"]:
        """The season's outcomes, and the reader with the season on its ledger."""
        admitted = self.admit(season)
        query = ObservationQuery(season, WeekRange(1, LAST_FANTASY_WEEK), FAR_FUTURE)
        found: dict[str, dict[int, WeekOutcome]] = {}
        for row in stat_lines_for_measurement(conn, query):
            position = positions.get(row.line.player_id)
            if position is None:
                continue
            points = {name: compute_fantasy_points(row.line, position, FORMAT_RULES[name]) for name in FORMATS}
            found.setdefault(row.line.player_id, {})[row.line.week] = WeekOutcome(MappingProxyType(points), True)
        zero = MappingProxyType(dict.fromkeys(FORMATS, 0.0))
        for usage in usage_as_of(conn, query):
            weeks = found.setdefault(usage.player_id, {})
            if usage.week not in weeks and (usage.snap_share or 0.0) > 0:
                weeks[usage.week] = WeekOutcome(zero, True)
        return SeasonOutcomes(season, MappingProxyType({p: MappingProxyType(w) for p, w in found.items()})), admitted


def fit_reader(judgment_season: int) -> OutcomeReader:
    """A fit's reader: the judgment season, every season after it and the pristine season are refused."""
    return OutcomeReader(frozenset(range(judgment_season, PRISTINE_SEASON)))


def judgment_reader(judgment_season: int) -> OutcomeReader:
    """The judgment's reader: every season after the judgment season, and the pristine one, refused."""
    return OutcomeReader(frozenset(range(judgment_season + 1, PRISTINE_SEASON)))
