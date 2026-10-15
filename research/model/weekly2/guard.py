"""THE ROUND'S GUARDS: the one outcome reader per run, and a refusal of any query that names a
closed season.

Every outcome the round's fit and judgment see (a player's week-W line) is read through
`WeekOutcomeReader`, whose ledger G5 checks: the fit's reader refuses the judgment season and every
season after it, the judgment's refuses every season after the judgment season, and both refuse the
pristine 2026 (`ros.outcomes.PRISTINE_SEASON`). Beneath the readers, `guard_queries` makes the
connection itself refuse any statement whose parameters name a closed season, inputs included, so
no 2025 or 2026 row (and in the development check no 2024 row) can reach any fit, check or gate.

Its limit, stated: it reads bind parameters by name (`s`, any `season*` or `*seasons`). A statement
that writes a closed season into its SQL text, or binds it under another name (`year`), passes it.
Every read this round makes binds its season under one of those names.
"""

from collections.abc import Mapping
from dataclasses import dataclass
from types import MappingProxyType
from typing import Any, Final

from sqlalchemy import Connection, event

from research.errors import ResearchError
from research.model.domain import Position
from research.model.instants import FAR_FUTURE
from research.model.reads.observations import ObservationQuery, WeekRange, stat_lines_for_measurement
from research.model.ros.outcomes import PRISTINE_SEASON, HeldOutReadError
from research.model.weekly.round.scoring import points_by_format
from research.model.weekly2.gates import Thresholds

LAST_JUDGED_WEEK: Final = 17


class ClosedSeasonError(ResearchError):
    """A statement that names a season the round may not touch."""


def closed_seasons(t: Thresholds) -> frozenset[int]:
    """Every season after the run's judgment season, through the pristine one."""
    return frozenset(range(t.judgment_season + 1, PRISTINE_SEASON + 1))


def _named_seasons(value: object) -> list[int]:
    if isinstance(value, bool):
        return []
    if isinstance(value, int):
        return [value]
    if isinstance(value, list | tuple | set | frozenset):
        return [v for v in value if isinstance(v, int) and not isinstance(v, bool)]
    return []


def check_parameters(parameters: object, closed: frozenset[int]) -> None:
    """Refuse a statement whose season parameters (`season`, `s`, any `season*` or `*seasons` key)
    name a closed season; an executemany's every row is checked."""
    rows: list[object] = list(parameters) if isinstance(parameters, list | tuple) else [parameters]
    for row in rows:
        if not isinstance(row, Mapping):
            continue
        for key, value in row.items():
            name = str(key)
            if name != "s" and "season" not in name:
                continue
            touched = sorted(set(_named_seasons(value)) & closed)
            if touched:
                raise ClosedSeasonError(f"a query named the closed season(s) {touched} through {name!r}; refused")


def guard_queries(conn: Connection, closed: frozenset[int]) -> None:
    """Every statement on `conn` from here on is checked by `check_parameters` before it runs, on
    its parameters by bind name (the compiled ones, so the driver's positional style hides none)."""

    def before(_conn: Any, _cursor: Any, _statement: str, parameters: object, context: Any, _executemany: bool) -> None:
        named = getattr(context, "compiled_parameters", None)
        check_parameters(named if named else parameters, closed)

    event.listen(conn, "before_cursor_execute", before)


WeekOutcomes = Mapping[int, Mapping[str, Mapping[str, float]]]  # week -> player -> format -> points


@dataclass(frozen=True, slots=True)
class WeekOutcomeReader:
    """Serves a season's week lines once it is allowed; `served` is the ledger. Immutable: admitting
    a season returns the reader with that season on its ledger."""

    refused: frozenset[int]
    served: tuple[int, ...] = ()

    def admit(self, season: int) -> "WeekOutcomeReader":
        if season >= PRISTINE_SEASON or season in self.refused:
            raise HeldOutReadError(f"the round may not read {season} outcomes here")
        return WeekOutcomeReader(self.refused, (*self.served, season))

    def season(
        self, conn: Connection, season: int, positions: Mapping[str, Position]
    ) -> tuple[WeekOutcomes, "WeekOutcomeReader"]:
        """Each player's line in each week through 17 in each format, as measured at the far future
        (a correction counts), and the reader with the season on its ledger."""
        admitted = self.admit(season)
        query = ObservationQuery(season, WeekRange(1, LAST_JUDGED_WEEK), FAR_FUTURE)
        found: dict[int, dict[str, Mapping[str, float]]] = {}
        for row in stat_lines_for_measurement(conn, query):
            position = positions.get(row.line.player_id)
            if position is not None:
                points = points_by_format(row.line, position)
                found.setdefault(row.line.week, {})[row.line.player_id] = MappingProxyType(points)
        return MappingProxyType({week: MappingProxyType(by) for week, by in found.items()}), admitted


def fit_reader(t: Thresholds) -> WeekOutcomeReader:
    """The fit's reader: the judgment season and every season after it refused."""
    return WeekOutcomeReader(frozenset(range(t.judgment_season, PRISTINE_SEASON + 1)))


def judgment_reader(t: Thresholds) -> WeekOutcomeReader:
    """The judgment's reader: every season after the judgment season refused."""
    return WeekOutcomeReader(closed_seasons(t))
