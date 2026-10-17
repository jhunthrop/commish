# ruff: noqa: PLR2004 - the expected values are the preregistration's numbers and hand-made cases
"""Round 4's tuning (2.6): one fixed grid of 16 cells, 64 with the decay, the tie within 0.1 per cent
broken toward the smaller cell, forward-chained folds inside the refit's own seasons."""

import numpy as np
import pytest

from research.model.weekly4.tuning import (
    BOOSTED_GRID,
    SHARE_GRID,
    Cell,
    FoldCache,
    booster,
    choose,
    folds,
    log_loss_sum,
    poisson_deviance_sum,
    squared_error_sum,
)


def test_the_grid_is_the_preregistrations() -> None:
    assert len(BOOSTED_GRID) == 16
    assert {c.max_leaf_nodes for c in BOOSTED_GRID} == {7, 15}
    assert {c.l2_regularization for c in BOOSTED_GRID} == {0.0, 1.0}
    assert {c.max_iter for c in BOOSTED_GRID} == {200, 400}
    assert {c.min_samples_leaf for c in BOOSTED_GRID} == {50, 200}
    assert len(SHARE_GRID) == 64
    assert {c.decay for c in SHARE_GRID} == {0.5, 0.7, 0.85, 1.0}


def _cell(leaves: int = 15, l2: float = 0.0, iters: int = 400, leaf: int = 50, decay: float | None = None) -> Cell:
    return Cell(leaves, l2, iters, leaf, decay)


def test_the_best_cell_wins_outside_the_tie() -> None:
    big, small = _cell(), _cell(leaves=7)
    assert choose({big: 100.0, small: 100.2}) == big


def test_within_a_tenth_of_a_per_cent_the_smaller_wins_in_the_stated_order() -> None:
    assert choose({_cell(): 100.0, _cell(leaves=7): 100.1}) == _cell(leaves=7)
    assert choose({_cell(): 100.0, _cell(iters=200): 100.05}) == _cell(iters=200)
    assert choose({_cell(leaf=50): 100.0, _cell(leaf=200): 100.05}) == _cell(leaf=200)
    assert choose({_cell(l2=0.0): 100.0, _cell(l2=1.0): 100.05}) == _cell(l2=1.0)
    assert choose({_cell(decay=0.5): 100.0, _cell(decay=1.0): 100.05}) == _cell(decay=1.0)
    # fewer leaves before fewer iterations
    assert choose({_cell(leaves=7, iters=400): 100.0, _cell(leaves=15, iters=200): 100.0}) == _cell(leaves=7)


def test_the_folds_validate_each_season_after_the_first_on_the_seasons_before_it() -> None:
    assert folds((2016, 2017, 2018)) == ((2017, (2016,)), (2018, (2016, 2017)))
    assert folds((2021,)) == ()


def test_the_fold_cache_computes_each_fold_once() -> None:
    calls: list[tuple[Cell, int]] = []

    def loss(cell: Cell, season: int) -> float:
        calls.append((cell, season))
        return float(season - 2000) + cell.max_leaf_nodes

    cache = FoldCache(loss)
    first = cache.choose((2016, 2017, 2018), BOOSTED_GRID)
    second = cache.choose((2016, 2017, 2018, 2019), BOOSTED_GRID)
    assert first.max_leaf_nodes == 7 and second.max_leaf_nodes == 7
    assert len(calls) == 16 * 3  # 2017, 2018 once, then only 2019 added
    with pytest.raises(ValueError, match="no fold"):
        cache.choose((2021,), BOOSTED_GRID)


def test_the_losses() -> None:
    y = np.array([0.0, 2.0])
    mu = np.array([1.0, 2.0])
    assert poisson_deviance_sum(y, mu) == pytest.approx(2.0)
    assert squared_error_sum(np.array([0.1, 0.3]), np.array([0.2, 0.2]), np.array([10.0, 30.0])) == pytest.approx(0.4)
    assert log_loss_sum(np.array([1.0, 0.0]), np.array([0.5, 0.5])) == pytest.approx(2 * np.log(2))


def test_a_booster_is_deterministic_without_early_stopping() -> None:
    rng = np.random.default_rng(0)
    x = rng.normal(size=(400, 3))
    y = rng.poisson(np.exp(0.3 * x[:, 0]))
    first = booster(_cell(iters=200), "poisson").fit(x, y).predict(x)
    second = booster(_cell(iters=200), "poisson").fit(x, y).predict(x)
    assert np.array_equal(first, second)
    model = booster(_cell(iters=200), "poisson", monotone=(1, 0, 0))
    assert model.get_params()["early_stopping"] is False
    assert model.get_params()["random_state"] == 0
    assert model.get_params()["learning_rate"] == 0.05
