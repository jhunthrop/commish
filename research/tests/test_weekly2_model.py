# ruff: noqa: PLR2004 - the expected values are hand-computed numbers, each read beside its case
"""Weekly round 2's model: the opponent factor and its cap, the elasticity grid search, the
designation filter (the stamped filings and Tank01's words), the residual-percentile range and the
start-and-sit chance, each by hand."""

import math

import numpy as np
import pytest

from research.errors import SchemaDriftError
from research.model.weekly.round.interval import EDGE_PERCENTILES, IntervalFitError
from research.model.weekly.scheme import CONTEXT_MULTIPLIER_MAX, CONTEXT_MULTIPLIER_MIN
from research.model.weekly2.band import chance, fit_ranges
from research.model.weekly2.designation import status_of_filing, status_of_tank01
from research.model.weekly2.factor import Elasticity, FactorRow, fit_elasticities, opponent_factor
from research.model.weekly2.gates import ROUND_TWO

_POSITIONS = ("QB", "RB", "WR", "TE")


def test_the_cap_is_round_ones_bounded_and_the_preregistered_band() -> None:
    assert (ROUND_TWO.factor_low, ROUND_TWO.factor_high) == (CONTEXT_MULTIPLIER_MIN, CONTEXT_MULTIPLIER_MAX)
    assert (ROUND_TWO.factor_low, ROUND_TWO.factor_high) == (0.8, 1.25)


@pytest.mark.parametrize(
    ("d_pass", "d_rush", "elasticity", "expected"),
    [
        (1.1, 0.9, Elasticity(1.0, 0.0), 1.1),  # pass only
        (1.1, 0.9, Elasticity(0.0, 1.0), 0.9),  # rush only
        (1.1, 0.9, Elasticity(0.5, 0.5), math.sqrt(1.1) * math.sqrt(0.9)),
        (2.0, 1.0, Elasticity(1.0, 1.0), 1.25),  # capped above
        (0.5, 1.0, Elasticity(1.0, 1.0), 0.8),  # capped below
        (1.25, 1.0, Elasticity(1.0, 0.0), 1.25),  # exactly at the cap
        (0.8, 1.0, Elasticity(1.0, 0.0), 0.8),
        (None, None, Elasticity(1.0, 1.0), 1.0),  # a missing rating takes 1
        (None, 1.2, Elasticity(1.0, 1.0), 1.2),
        (1.2, 2.0, Elasticity(0.0, 0.0), 1.0),  # zero elasticities: no opponent
    ],
)
def test_the_opponent_factor_by_hand(
    d_pass: float | None, d_rush: float | None, elasticity: Elasticity, expected: float
) -> None:
    assert opponent_factor(d_pass, d_rush, elasticity) == pytest.approx(expected, abs=1e-12)


def _rows(position: str, truth: Elasticity) -> list[FactorRow]:
    ratings = [(0.85, 1.1), (1.15, 0.9), (1.0, 1.0), (0.9, 0.95), (1.2, 1.05), (1.05, 0.85)]
    return [
        FactorRow(position, rate, rate * opponent_factor(dp, dr, truth), dp, dr)
        for rate in (8.0, 12.0, 15.0)
        for dp, dr in ratings
    ]


def test_the_grid_search_recovers_each_positions_elasticities() -> None:
    truth = {
        "QB": Elasticity(0.7, 0.2),
        "RB": Elasticity(0.1, 0.9),
        "WR": Elasticity(1.0, 0.0),
        "TE": Elasticity(0.4, 0.4),
    }
    rows = [row for position in _POSITIONS for row in _rows(position, truth[position])]
    assert fit_elasticities(rows, ROUND_TWO.elasticity_grid) == truth


def test_a_tie_keeps_the_smaller_pass_then_rush_elasticity() -> None:
    # Every rating 1: every cell of the grid has the same loss, so the first cell (0, 0) is kept.
    rows = [FactorRow(p, 10.0, 12.0, 1.0, 1.0) for p in _POSITIONS]
    assert set(fit_elasticities(rows, ROUND_TWO.elasticity_grid).values()) == {Elasticity(0.0, 0.0)}


def test_the_grid_is_the_preregistered_121_cells() -> None:
    assert ROUND_TWO.elasticity_grid == tuple(round(0.1 * i, 1) for i in range(11))


def test_a_position_with_no_rows_is_refused() -> None:
    with pytest.raises(ValueError, match="TE"):
        fit_elasticities([FactorRow(p, 10.0, 12.0, 1.0, 1.0) for p in ("QB", "RB", "WR")], ROUND_TWO.elasticity_grid)


@pytest.mark.parametrize(
    ("ordinal", "status"),
    [(0.0, "clear"), (1.0, "questionable"), (2.0, "withheld"), (3.0, "withheld")],
)
def test_the_filings_filter_out_and_doubtful_and_flag_questionable(ordinal: float, status: str) -> None:
    assert status_of_filing(ordinal) == status


def test_an_unknown_filing_ordinal_is_refused() -> None:
    with pytest.raises(SchemaDriftError):
        status_of_filing(4.0)


@pytest.mark.parametrize(
    ("designation", "status"),
    [
        (None, "clear"),
        ("", "clear"),
        ("Out", "withheld"),
        (" out ", "withheld"),
        ("Doubtful", "withheld"),
        ("Questionable", "questionable"),
        ("Day-To-Day", "questionable"),
        ("Probable", "clear"),
        ("Injured Reserve", "withheld"),
        ("Injured Reserve - Designated for Return", "withheld"),
        ("Physically Unable to Perform", "withheld"),
        ("Non-Football Injury", "withheld"),
        ("Suspended", "withheld"),
        ("Exempt", "withheld"),
    ],
)
def test_tank01_designations_map_to_the_filters_three_states(designation: str | None, status: str) -> None:
    assert status_of_tank01(designation) == status


def test_an_unknown_tank01_designation_is_refused_not_read_as_clear() -> None:
    with pytest.raises(SchemaDriftError, match="Sidelined"):
        status_of_tank01("Sidelined")


def _cell_pairs(count: int) -> list[tuple[float, float]]:
    # x = 0..count-1; residual = (i % 10) - 4.5 so each quintile's residuals are spread evenly
    return [(float(i), float(i) + (i % 10) - 4.5) for i in range(count)]


def test_the_range_cuts_at_round_ones_preregistered_quintile_edges() -> None:
    assert EDGE_PERCENTILES == (20.0, 40.0, 60.0, 80.0)


def test_the_range_cuts_quintiles_of_x_and_keeps_99_percentiles() -> None:
    pairs = {f"{p}|{f}": _cell_pairs(500) for p in _POSITIONS for f in ("ppr", "half", "std")}
    ranges = fit_ranges(pairs, ROUND_TWO)
    cell = ranges.by_cell["QB|ppr"]
    assert cell.edges == tuple(float(np.percentile(np.arange(500.0), q)) for q in (20, 40, 60, 80))
    assert len(cell.percentiles) == 5
    assert all(len(row) == 99 for row in cell.percentiles)
    residuals = np.array([(i % 10) - 4.5 for i in range(100)])
    expected = tuple(float(v) for v in np.percentile(residuals, np.arange(1, 100)))
    assert cell.percentiles[0] == pytest.approx(expected)
    floor, median, ceiling = ranges.band("QB", "ppr", 50.0)
    q10, q50, q90 = (float(np.percentile(residuals, q)) for q in (10, 50, 90))
    assert (floor, median, ceiling) == pytest.approx((50.0 + q10, 50.0 + q50, 50.0 + q90))


def test_the_range_floors_at_zero() -> None:
    pairs = {f"{p}|{f}": _cell_pairs(500) for p in _POSITIONS for f in ("ppr", "half", "std")}
    floor, median, _ = fit_ranges(pairs, ROUND_TWO).band("RB", "half", 1.0)
    assert floor == 0.0  # 1 + q10 (-4.4) is below zero
    assert median == 1.0


def test_a_thin_quintile_is_refused() -> None:
    pairs = {f"{p}|{f}": _cell_pairs(500) for p in _POSITIONS for f in ("ppr", "half", "std")}
    pairs["TE|std"] = _cell_pairs(40)
    with pytest.raises(IntervalFitError, match=r"TE\|std"):
        fit_ranges(pairs, ROUND_TWO)


def test_the_chance_counts_every_pair_of_percentiles_with_ties_half() -> None:
    zeros = tuple(0.0 for _ in range(99))
    assert chance(10.0, zeros, 5.0, zeros) == 1.0
    assert chance(5.0, zeros, 5.0, zeros) == 0.5  # every pair ties
    spread = tuple(float(v) for v in range(-49, 50))
    # A and B with the same spread and centre: symmetric, one half.
    assert chance(100.0, spread, 100.0, spread) == pytest.approx(0.5)
    # A one point ahead on the same spread: pairs with a - b > -1 win, a - b == -1 tie.
    ahead = sum((i - j > -1) + 0.5 * (i - j == -1) for i in range(99) for j in range(99)) / 9801
    assert chance(101.0, spread, 100.0, spread) == pytest.approx(ahead)


def test_the_chance_floors_both_sides_at_zero_before_comparing() -> None:
    # Both players' every percentile is below zero: both score zero, every pair ties.
    low = tuple(-20.0 for _ in range(99))
    assert chance(3.0, low, 1.0, low) == 0.5
