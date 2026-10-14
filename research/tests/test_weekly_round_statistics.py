# ruff: noqa: PLR2004 - the expected values are hand-computed numbers, each read beside its case
"""The weekly round's statistics on hand-computed cases: average ranks with ties, the ordering
population, rho and places off within a week, the bootstrap differences, calibration's strict
inequalities, and the empty and single-sample groups each returns no answer for."""

import math

import numpy as np
import pytest

from research.model.weekly.round.interval import Bucketed
from research.model.weekly.round.scoring import ScoredRow
from research.model.weekly.round.statistics import (
    Bootstrap,
    WeekOrdering,
    _average_ranks_desc,
    calibration,
    places_difference,
    rho_difference,
    week_ordering,
)


def _row(  # noqa: PLR0913 - one scored player, named
    player: str,
    projected: float,
    actual: float | None,
    *,
    position: str = "RB",
    week: int = 1,
    adp: float | None = 1.0,
    form: float | None = 1.0,
) -> ScoredRow:
    return ScoredRow(
        2025,
        week,
        player,
        position,  # type: ignore[arg-type]
        {"ppr": projected, "half": projected, "std": projected},
        None if actual is None else {"ppr": actual, "half": actual, "std": actual},
        adp,
        None if form is None else {"ppr": form, "half": form, "std": form},
    )


def test_average_ranks_put_the_largest_first_and_share_ties() -> None:
    assert _average_ranks_desc([3.0, 1.0, 3.0, 2.0]) == [1.5, 4.0, 1.5, 3.0]
    assert _average_ranks_desc([]) == []
    assert _average_ranks_desc([5.0]) == [1.0]


def _eight(position: str = "RB") -> list[ScoredRow]:
    # The model orders the eight exactly as they finished, ADP exactly backwards, form ties all.
    return [
        _row(f"p{i}", projected=float(i), actual=float(i) * 2, position=position, adp=float(i), form=3.0)
        for i in range(1, 9)
    ]


def test_a_week_of_eight_scores_each_source_on_the_same_players() -> None:
    found = week_ordering(1, "RB", _eight())
    assert found.size == 8
    assert found.rho["model"] == pytest.approx(1.0)
    assert found.rho["adp"] == pytest.approx(-1.0)
    assert found.rho["form"] is None  # a constant order has no rank correlation
    assert found.places_off["model"] == (0.0,) * 8  # every RB in eight is a starter (24)
    assert found.places_off["adp"] == (7.0, 5.0, 3.0, 1.0, 1.0, 3.0, 5.0, 7.0)


def test_the_starter_cut_reads_the_actual_rank_against_the_position() -> None:
    rows = [_row(f"q{i}", projected=float(i), actual=float(i), position="QB") for i in range(1, 16)]
    found = week_ordering(1, "QB", rows)
    assert len(found.places_off["model"]) == 12  # QB starters: 12 of the 15


def test_a_week_below_eight_players_or_a_single_player_answers_nothing() -> None:
    for count in (7, 1, 0):
        found = week_ordering(1, "RB", _eight()[:count])
        assert found.size == count
        assert all(found.rho[s] is None for s in ("model", "adp", "form"))
        assert all(found.places_off[s] == () for s in ("model", "adp", "form"))


def test_the_population_drops_a_player_missing_adp_form_or_a_line() -> None:
    rows = [*_eight(), _row("x", 9.0, None), _row("y", 9.0, 1.0, adp=None), _row("z", 9.0, 1.0, form=None)]
    assert week_ordering(1, "RB", rows).size == 8
    assert week_ordering(2, "RB", rows).size == 0  # another week, nobody


def _ordering(week: int, model: float | None, adp: float | None, places: tuple[float, ...] = ()) -> WeekOrdering:
    return WeekOrdering(
        week, "RB", 10, {"model": model, "adp": adp, "form": None}, {"model": places, "adp": places, "form": ()}
    )


def test_the_rho_difference_is_the_mean_over_usable_weeks_and_the_bound_its_resampled_percentile() -> None:
    found = [_ordering(1, 0.5, 0.4), _ordering(2, 0.6, 0.4), _ordering(3, None, 0.4)]
    draws = np.array([[0, 1, 2], [0, 0, 0], [2, 2, 2]])  # the last resample holds only the empty week
    difference = rho_difference(found, "RB", "adp", [1, 2, 3], Bootstrap(draws, 0.0))
    assert difference.value == pytest.approx(0.15)
    assert difference.lower_bound == pytest.approx(0.1)
    assert difference.weeks == 2


def test_no_usable_week_is_no_difference() -> None:
    found = [_ordering(1, None, 0.4)]
    difference = rho_difference(found, "RB", "adp", [1], Bootstrap(np.array([[0]]), 0.5))
    assert (difference.value, difference.lower_bound, difference.weeks) == (None, None, 0)
    assert rho_difference([], "QB", "adp", [1], Bootstrap(np.array([[0]]), 0.5)).value is None


def test_places_off_pools_every_starter_as_benchmark_minus_model() -> None:
    week_a = WeekOrdering(1, "RB", 10, {}, {"model": (1.0, 3.0), "adp": (2.0, 5.0), "form": ()})
    week_b = WeekOrdering(2, "WR", 10, {}, {"model": (0.0,), "adp": (4.0,), "form": ()})
    draws = np.array([[0, 0], [1, 1]])
    difference = places_difference([week_a, week_b], "adp", [1, 2], Bootstrap(draws, 0.0))
    assert difference.value == pytest.approx(7 / 3)
    assert difference.lower_bound == pytest.approx(1.5)
    assert difference.weeks == 2
    assert places_difference([], "adp", [1, 2], Bootstrap(draws, 0.0)).value is None


def test_calibration_counts_strictly_below_the_floor_and_strictly_above_the_ceiling() -> None:
    rows = [_row("a", 10.0, 5.0), _row("b", 10.0, 4.9), _row("c", 10.0, 15.0), _row("d", 10.0, 15.1)]
    bands = {(1, row.player_id, name): (5.0, 10.0, 15.0) for row in rows for name in ("ppr", "half", "std")}
    found = calibration(rows, bands)
    assert (found["RB|ppr"].below, found["RB|ppr"].above, found["RB|ppr"].size) == (0.25, 0.25, 4)
    assert (found["QB|std"].below, found["QB|std"].above, found["QB|std"].size) == (None, None, 0)
    single = calibration([rows[0]], bands)["RB|half"]
    assert (single.below, single.above, single.size) == (0.0, 0.0, 1)


def test_an_interval_quintile_takes_a_projection_at_its_edge_into_the_upper_bucket() -> None:
    cell = Bucketed((1.0, 2.0, 3.0, 4.0), ((-5.0, 0.0, 5.0), (-1.0, 0.0, 1.0), (0, 0, 0), (0, 0, 0), (-9.0, 1.0, 2.0)))
    assert cell.band(0.5) == (0.0, 0.5, 5.5)  # the floor clips at zero
    assert cell.band(1.0) == (0.0, 1.0, 2.0)
    assert cell.band(4.0) == (0.0, 5.0, 6.0)
    assert not math.isnan(cell.band(100.0)[0])
