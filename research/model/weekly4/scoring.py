"""ROUND 4'S SOURCES ON THE SAME ROWS (preregistration section 3.1, "The rows each comparison uses").

Round 2's statistics, generalised from its five fixed sources to round 4's: the model, ADP, the rounds'
recent form, last-three form, the expert's spreadsheet and round 3's number. Every source is scored on
the same population rows; a source with no number for a row ranks it below every row it has, ties
averaged (`NO_OPINION`, round 2's fill rule), applied identically to every source. ADP ranks the lowest
pick first. The week orderings are round 2's `WeekOrdering`, so its deltas, bootstrap and places off
read them unchanged.
"""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from types import MappingProxyType

from research.model.backtest import Observation, _average_ranks, spearman
from research.model.weekly.round.scoring import SKILL_POSITIONS
from research.model.weekly2.gates import Thresholds
from research.model.weekly2.statistics import NO_OPINION, WeekOrdering

ADP = "adp"


@dataclass(frozen=True, slots=True)
class Row:
    """One population player at one week: each source's number in each format, ADP, the outcome."""

    week: int
    player_id: str
    position: str
    actual: Mapping[str, float]
    sources: Mapping[str, Mapping[str, float] | None]
    adp: float | None


def source_names(sources: Sequence[str]) -> tuple[str, ...]:
    return (*sources, ADP)


def _score(row: Row, source: str, name: str) -> float:
    if source == ADP:
        return NO_OPINION if row.adp is None else -row.adp
    found = row.sources.get(source)
    return NO_OPINION if found is None else float(found[name])


def _descending_ranks(values: Sequence[float]) -> list[float]:
    return _average_ranks([-v for v in values])


def week_ordering(  # noqa: PLR0913, PLR0917 - the ordering's every input, named
    week: int, position: str, rows: Sequence[Row], name: str, t: Thresholds, sources: Sequence[str]
) -> WeekOrdering:
    """Each source's Spearman rho against the week's points, and each starter's places off."""
    found = [r for r in rows if r.week == week and r.position == position]
    actual = [r.actual[name] for r in found]
    actual_ranks = _descending_ranks(actual)
    starters = [i for i, rank in enumerate(actual_ranks) if rank <= t.starters[position]]
    enough = len(found) >= t.min_week_population
    rho: dict[str, float | None] = {}
    places: dict[str, tuple[float, ...]] = {}
    for source in source_names(sources):
        values = [_score(r, source, name) for r in found]
        rho[source] = spearman([Observation(v, a) for v, a in zip(values, actual, strict=True)]) if enough else None
        ranks = _descending_ranks(values)
        places[source] = tuple(abs(ranks[i] - actual_ranks[i]) for i in starters) if enough else ()
    return WeekOrdering(week, position, len(found), MappingProxyType(rho), MappingProxyType(places))


def orderings(
    rows: Sequence[Row], weeks: Sequence[int], name: str, t: Thresholds, sources: Sequence[str]
) -> list[WeekOrdering]:
    return [week_ordering(week, position, rows, name, t, sources) for position in SKILL_POSITIONS for week in weeks]
