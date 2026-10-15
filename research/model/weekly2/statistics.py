"""THE ROUND'S STATISTICS: the population, rank agreement within a week, places off for the
starters, the range's calibration, the chance's bins and the week-block bootstrap.

Preregistration section 4. The population at (W, p) is defined without the model: players at p who
recorded a week-W line and are in the union of ADP's top K at p and the top K at p by season-to-date
PPR points. Every source is scored on the same players; a player a source has no opinion on ranks
below every player it has (`NO_OPINION`), ties averaged. Ranks are average ranks, highest first.
"""

import warnings
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from types import MappingProxyType
from typing import Final

import numpy as np

from research.model.backtest import Observation, _average_ranks, spearman
from research.model.weekly.round.scoring import SKILL_POSITIONS
from research.model.weekly2.gates import Calibration, ChanceBin, Difference, Ordering, Thresholds

NO_OPINION: Final = -1.0e9  # below every source's every value, and finite (Spearman refuses infinities)
SOURCES: Final = ("model", "adp", "form", "rate", "board")
BENCHMARKS: Final = ("adp", "form")


@dataclass(frozen=True, slots=True)
class JudgedRow:
    """One population player at one week: every source's view and the outcome, in each format."""

    week: int
    player_id: str
    position: str
    number: Mapping[str, float] | None  # x_W; None when withheld or outside the model's universe
    rate: Mapping[str, float] | None  # m alone (the factor's ablation)
    board: Mapping[str, float] | None  # the preseason board's points a game
    adp: float | None
    form: Mapping[str, float] | None
    actual: Mapping[str, float]
    questionable: bool


def _top(scored: Mapping[str, float], size: int, descending: bool) -> list[str]:
    sign = -1.0 if descending else 1.0
    return [pid for pid, _ in sorted(scored.items(), key=lambda item: (sign * item[1], item[0]))[:size]]


def population(  # noqa: PLR0913, PLR0917 - the population's every input, named
    position: str,
    lined: set[str] | frozenset[str],
    adp: Mapping[str, float],
    to_date: Mapping[str, float],
    positions: Mapping[str, str],
    size: int,
) -> frozenset[str]:
    """The lined players at `position` among ADP's top `size` and the top `size` by points so far."""
    by_adp = _top({pid: rank for pid, rank in adp.items() if positions.get(pid) == position}, size, False)
    so_far = _top({pid: pts for pid, pts in to_date.items() if positions.get(pid) == position}, size, True)
    return frozenset(pid for pid in (*by_adp, *so_far) if pid in lined)


Score = Callable[[JudgedRow], float]


def _scores(format_name: str) -> dict[str, Score]:
    def of(found: Mapping[str, float] | None) -> float:
        return NO_OPINION if found is None else found[format_name]

    return {
        "model": lambda row: of(row.number),
        "adp": lambda row: NO_OPINION if row.adp is None else -row.adp,
        "form": lambda row: of(row.form),
        "rate": lambda row: of(row.rate),
        "board": lambda row: of(row.board),
    }


def _average_ranks_desc(values: Sequence[float]) -> list[float]:
    return _average_ranks([-value for value in values])


@dataclass(frozen=True, slots=True)
class WeekOrdering:
    week: int
    position: str
    size: int
    rho: Mapping[str, float | None]
    places_off: Mapping[str, tuple[float, ...]]


def week_ordering(week: int, position: str, rows: Sequence[JudgedRow], format_name: str, t: Thresholds) -> WeekOrdering:
    """Each source's Spearman rho against the week's points, and each starter's places off."""
    found = [row for row in rows if row.week == week and row.position == position]
    actual = [row.actual[format_name] for row in found]
    actual_ranks = _average_ranks_desc(actual)
    starters = [i for i, rank in enumerate(actual_ranks) if rank <= t.starters[position]]
    enough = len(found) >= t.min_week_population
    rho: dict[str, float | None] = {}
    places: dict[str, tuple[float, ...]] = {}
    for source, score in _scores(format_name).items():
        values = [score(row) for row in found]
        rho[source] = spearman([Observation(v, a) for v, a in zip(values, actual, strict=True)]) if enough else None
        ranks = _average_ranks_desc(values)
        places[source] = tuple(abs(ranks[i] - actual_ranks[i]) for i in starters) if enough else ()
    return WeekOrdering(week, position, len(found), MappingProxyType(rho), MappingProxyType(places))


def orderings(rows: Sequence[JudgedRow], weeks: Sequence[int], format_name: str, t: Thresholds) -> list[WeekOrdering]:
    return [week_ordering(week, position, rows, format_name, t) for position in SKILL_POSITIONS for week in weeks]


def rho_deltas(
    found: Sequence[WeekOrdering], bench: str, weeks: Sequence[int], source: str = "model"
) -> dict[str, list[float | None]]:
    """Per position, each week's (source rho minus benchmark rho), None where the week cannot answer."""
    deltas: dict[str, list[float | None]] = {}
    for position in SKILL_POSITIONS:
        by_week = {o.week: o for o in found if o.position == position}
        row: list[float | None] = []
        for week in weeks:
            o = by_week.get(week)
            model = None if o is None else o.rho[source]
            other = None if o is None else o.rho[bench]
            row.append(None if model is None or other is None else model - other)
        deltas[position] = row
    return deltas


def bootstrap_draws(count: int, t: Thresholds) -> np.ndarray:
    """The resampled week indices every comparison shares."""
    return np.random.default_rng(t.seed).integers(0, count, size=(t.resamples, count))


def _mean(values: Sequence[float | None]) -> float | None:
    kept = [v for v in values if v is not None]
    return None if not kept else float(np.mean(kept))


def ordering_difference(
    by_position: Mapping[str, Sequence[float | None]], draws: np.ndarray, t: Thresholds
) -> Ordering:
    """Pooled: the mean over weeks of the per-week mean over the four positions, over weeks where all
    four answer, with the bootstrap's lower bound; and each position's mean over its weeks."""
    weeks = len(next(iter(by_position.values())))
    pooled = np.full(weeks, np.nan)
    for i in range(weeks):
        cells = [by_position[p][i] for p in SKILL_POSITIONS]
        if all(cell is not None for cell in cells):
            pooled[i] = float(np.mean([cell for cell in cells if cell is not None]))
    means: dict[str, float | None] = {p: _mean(by_position[p]) for p in SKILL_POSITIONS}
    each = MappingProxyType(means)
    usable = int(np.sum(~np.isnan(pooled)))
    if usable == 0:
        return Ordering(Difference(None, None, 0), each)
    with warnings.catch_warnings():
        # A resample made only of weeks with no answer has no mean; it is dropped just below.
        warnings.simplefilter("ignore", RuntimeWarning)
        boot = np.nanmean(pooled[draws], axis=1)
    boot = boot[~np.isnan(boot)]
    bound = float(np.percentile(boot, t.lower_percentile))
    return Ordering(Difference(float(np.nanmean(pooled)), bound, usable), each)


def places_mean(found: Sequence[WeekOrdering], source: str, position: str | None = None) -> float | None:
    """Mean places off over every starter in every week (and position, unless one is named)."""
    values = [v for o in found if position is None or o.position == position for v in o.places_off[source]]
    return None if not values else float(np.mean(values))


def chance_bins(pairs: Sequence[tuple[float, float]], t: Thresholds) -> list[ChanceBin]:
    """Per bin of the favourite's chance: the pairs, the mean chance and the share the favourite
    outscored (ties half). `pairs` holds (favourite's chance, his points minus the other's)."""
    last = len(t.chance_bins) - 1
    bins: list[ChanceBin] = []
    for i, (low, high) in enumerate(t.chance_bins):
        kept = [(c, gap) for c, gap in pairs if low <= c < high or (i == last and c == high)]
        if not kept:
            bins.append(ChanceBin(low, high, 0, None, None))
            continue
        won = sum(1.0 if gap > 0 else 0.5 if gap == 0 else 0.0 for _, gap in kept)
        bins.append(ChanceBin(low, high, len(kept), float(np.mean([c for c, _ in kept])), won / len(kept)))
    return bins


@dataclass(frozen=True, slots=True)
class BoardRow:
    """A player-week of the whole board with a number and a line (S3's rows)."""

    position: str
    number: Mapping[str, float]
    actual: Mapping[str, float]


Band = Callable[[str, str, float], tuple[float, float, float]]


def calibration(rows: Sequence[BoardRow], band: Band, formats: Sequence[str]) -> dict[str, Calibration]:
    """Per `position|format`: the share of outcomes below the floor and above the ceiling."""
    found: dict[str, Calibration] = {}
    for position in SKILL_POSITIONS:
        for name in formats:
            below = above = size = 0
            for row in rows:
                if row.position != position:
                    continue
                floor, _, ceiling = band(position, name, row.number[name])
                size += 1
                below += row.actual[name] < floor
                above += row.actual[name] > ceiling
            found[f"{position}|{name}"] = Calibration(
                None if size == 0 else below / size, None if size == 0 else above / size, size
            )
    return found


@dataclass(frozen=True, slots=True)
class Contender:
    """One numbered population player in a pair: his number, his bucket's percentiles, his points."""

    player_id: str
    number: float
    offsets: tuple[float, ...]
    actual: float


Chance = Callable[[float, Sequence[float], float, Sequence[float]], float]


def favourite_pairs(contenders: Sequence[Contender], chance: Chance) -> list[tuple[float, float]]:
    """Every pair once, as (the favourite's chance, his points minus the other's); at exactly one
    half the first by player id is the favourite."""
    ordered = sorted(contenders, key=lambda c: c.player_id)
    pairs: list[tuple[float, float]] = []
    for i, a in enumerate(ordered):
        for b in ordered[i + 1 :]:
            found = chance(a.number, a.offsets, b.number, b.offsets)
            if found >= 0.5:  # noqa: PLR2004 - a favourite is the side of one half
                pairs.append((found, a.actual - b.actual))
            else:
                pairs.append((1.0 - found, b.actual - a.actual))
    return pairs
