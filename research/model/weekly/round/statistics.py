"""THE ROUND'S STATISTICS: rank agreement within position, places off for the starters, the
interval's calibration, and the week-block bootstrap the gates read.

The ordering population of a (week, position) is every player with an ADP rank, a model projection,
a recent-form value and a recorded line that week; every source is scored on those same players.
Ranks are average ranks, highest points first. Formats other than PPR are reported, never gated.
"""

from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from typing import Final

import numpy as np

from research.model.backtest import Observation, spearman
from research.model.weekly.round.scoring import FORMATS, SKILL_POSITIONS, ScoredRow

MIN_WEEK_POPULATION: Final = 8
STARTERS: Final[Mapping[str, int]] = {"QB": 12, "RB": 24, "WR": 24, "TE": 12}
SOURCES: Final = ("model", "adp", "form")

Score = Callable[[ScoredRow], float]


def _scores(format_name: str) -> dict[str, Score]:
    def model(row: ScoredRow) -> float:
        return row.projected[format_name]

    def adp(row: ScoredRow) -> float:
        return -(row.adp if row.adp is not None else np.inf)

    def form(row: ScoredRow) -> float:
        return row.form[format_name] if row.form is not None else -np.inf

    return {"model": model, "adp": adp, "form": form}


def ordering_population(rows: Sequence[ScoredRow]) -> list[ScoredRow]:
    return [row for row in rows if row.adp is not None and row.form is not None and row.actual is not None]


def _average_ranks_desc(values: Sequence[float]) -> list[float]:
    """Average ranks, 1 for the largest value."""
    order = sorted(range(len(values)), key=lambda i: -values[i])
    ranks = [0.0] * len(values)
    start = 0
    while start < len(order):
        end = start
        while end + 1 < len(order) and values[order[end + 1]] == values[order[start]]:
            end += 1
        for i in range(start, end + 1):
            ranks[order[i]] = (start + end) / 2 + 1
        start = end + 1
    return ranks


@dataclass(frozen=True, slots=True)
class WeekOrdering:
    """One (week, position): each source's rho, and each starter's places off by source."""

    week: int
    position: str
    size: int
    rho: Mapping[str, float | None]
    places_off: Mapping[str, tuple[float, ...]]


def week_ordering(week: int, position: str, rows: Sequence[ScoredRow], format_name: str = "ppr") -> WeekOrdering:
    population = [row for row in ordering_population(rows) if row.position == position and row.week == week]
    scores = _scores(format_name)
    actual = [row.actual[format_name] for row in population if row.actual is not None]
    rho: dict[str, float | None] = {}
    places: dict[str, tuple[float, ...]] = {}
    actual_ranks = _average_ranks_desc(actual)
    starters = [i for i, rank in enumerate(actual_ranks) if rank <= STARTERS[position]]
    for source, score in scores.items():
        values = [score(row) for row in population]
        enough = len(population) >= MIN_WEEK_POPULATION
        rho[source] = spearman([Observation(v, a) for v, a in zip(values, actual, strict=True)]) if enough else None
        ranks = _average_ranks_desc(values)
        places[source] = tuple(abs(ranks[i] - actual_ranks[i]) for i in starters) if enough else ()
    return WeekOrdering(week, position, len(population), rho, places)


def orderings(rows: Sequence[ScoredRow], weeks: Sequence[int], format_name: str = "ppr") -> list[WeekOrdering]:
    return [week_ordering(week, position, rows, format_name) for position in SKILL_POSITIONS for week in weeks]


@dataclass(frozen=True, slots=True)
class Difference:
    """A gated difference: its value on the held-out weeks and its bootstrap lower bound."""

    value: float | None
    lower_bound: float | None
    weeks: int


def _rho_matrix(found: Sequence[WeekOrdering], position: str, bench: str, weeks: Sequence[int]) -> np.ndarray:
    by_week = {o.week: o for o in found if o.position == position}
    cells = []
    for week in weeks:
        o = by_week.get(week)
        model = None if o is None else o.rho["model"]
        other = None if o is None else o.rho[bench]
        cells.append(np.nan if model is None or other is None else model - other)
    return np.array(cells)


@dataclass(frozen=True, slots=True)
class Bootstrap:
    """The resampled week indices every comparison shares, and the percentile its bound is read at."""

    draws: np.ndarray
    level: float


def bootstrap(count: int, resamples: int, seed: int, level: float) -> Bootstrap:
    return Bootstrap(np.random.default_rng(seed).integers(0, count, size=(resamples, count)), level)


def rho_difference(
    found: Sequence[WeekOrdering], position: str, bench: str, weeks: Sequence[int], boot_spec: Bootstrap
) -> Difference:
    """Mean over weeks of (model rho minus benchmark rho), and the bootstrap's `level` percentile."""
    deltas = _rho_matrix(found, position, bench, weeks)
    usable = int(np.sum(~np.isnan(deltas)))
    if usable == 0:
        return Difference(None, None, 0)
    with np.errstate(invalid="ignore"):
        boot = np.nanmean(deltas[boot_spec.draws], axis=1)
    boot = boot[~np.isnan(boot)]
    return Difference(float(np.nanmean(deltas)), float(np.percentile(boot, boot_spec.level)), usable)


def places_difference(
    found: Sequence[WeekOrdering], bench: str, weeks: Sequence[int], boot_spec: Bootstrap
) -> Difference:
    """Pooled mean places off, (benchmark minus model), over every starter in every week and position."""
    index = {week: i for i, week in enumerate(weeks)}
    sums = np.zeros(len(weeks))
    counts = np.zeros(len(weeks))
    for o in found:
        for model_off, bench_off in zip(o.places_off["model"], o.places_off[bench], strict=True):
            sums[index[o.week]] += bench_off - model_off
            counts[index[o.week]] += 1
    if counts.sum() == 0:
        return Difference(None, None, 0)
    draws = boot_spec.draws
    boot = sums[draws].sum(axis=1) / np.maximum(counts[draws].sum(axis=1), 1)
    return Difference(
        float(sums.sum() / counts.sum()), float(np.percentile(boot, boot_spec.level)), int(np.sum(counts > 0))
    )


def mean_places_off(found: Sequence[WeekOrdering], source: str, position: str | None = None) -> float | None:
    values = [v for o in found if position is None or o.position == position for v in o.places_off[source]]
    return None if not values else float(np.mean(values))


def mean_rho(found: Sequence[WeekOrdering], source: str, position: str) -> float | None:
    values = [o.rho[source] for o in found if o.position == position and o.rho[source] is not None]
    return None if not values else float(np.mean([v for v in values if v is not None]))


@dataclass(frozen=True, slots=True)
class Calibration:
    below: float | None
    above: float | None
    size: int


def calibration(
    rows: Sequence[ScoredRow], bands: Mapping[tuple[int, str, str], tuple[float, float, float]]
) -> dict[str, Calibration]:
    """Per `position|format`: the share of outcomes below the floor and above the ceiling."""
    found: dict[str, Calibration] = {}
    for position in SKILL_POSITIONS:
        for name in FORMATS:
            below = above = size = 0
            for row in rows:
                if row.position != position or row.actual is None:
                    continue
                floor, _, ceiling = bands[(row.week, row.player_id, name)]
                size += 1
                below += row.actual[name] < floor
                above += row.actual[name] > ceiling
            found[f"{position}|{name}"] = Calibration(
                None if size == 0 else below / size, None if size == 0 else above / size, size
            )
    return found
