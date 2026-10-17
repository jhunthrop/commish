"""THE TUNING, TIME-AWARE (preregistration section 2.6, "Tuning, time-aware, and its order").

Every boosted model has one fixed grid of 16 cells (`max_leaf_nodes` 7 or 15, `l2_regularization` 0
or 1, `max_iter` 200 or 400, `min_samples_leaf` 50 or 200, learning rate 0.05); the share models add
the decay in {0.5, 0.7, 0.85, 1.0}, 64 cells. A refit on seasons S1 to Sk chooses its cell by
forward-chaining inside them: train on the seasons before s, validate on s, for each s after the
first, the loss summed over the folds. A tie is a summed loss within 0.1 per cent of the best, and
among tied cells the smaller wins: fewer `max_leaf_nodes`, then fewer `max_iter`, then larger
`min_samples_leaf`, then larger `l2_regularization`, then the larger decay. The boosters are
scikit-learn's, deterministic with `random_state` 0 and early stopping off.

A fold's training seasons are the seasons before its validation season, whichever refit asks, so a
fold's loss is computed once and shared by every refit that contains it (`FoldCache`).
"""

from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass, field
from itertools import product
from typing import Any, Final, Literal, Protocol, cast

import numpy as np
from sklearn.ensemble import HistGradientBoostingClassifier, HistGradientBoostingRegressor

LEARNING_RATE: Final = 0.05
TIE: Final = 0.001  # "within 0.1 per cent of the best (relative)"
DECAYS: Final = (0.5, 0.7, 0.85, 1.0)
RANDOM_STATE: Final = 0


@dataclass(frozen=True, slots=True, order=True)
class Cell:
    max_leaf_nodes: int
    l2_regularization: float
    max_iter: int
    min_samples_leaf: int
    decay: float | None = None  # the share models' decay; None for the other models


BOOSTED_GRID: Final = tuple(
    Cell(leaves, l2, iters, leaf) for leaves, l2, iters, leaf in product((7, 15), (0.0, 1.0), (200, 400), (50, 200))
)
SHARE_GRID: Final = tuple(
    Cell(c.max_leaf_nodes, c.l2_regularization, c.max_iter, c.min_samples_leaf, decay)
    for c in BOOSTED_GRID
    for decay in DECAYS
)


def _smaller(cell: Cell) -> tuple[float, ...]:
    decay = cell.decay if cell.decay is not None else 0.0
    return (cell.max_leaf_nodes, cell.max_iter, -cell.min_samples_leaf, -cell.l2_regularization, -decay)


def choose(losses: Mapping[Cell, float]) -> Cell:
    """The best cell, or among the cells within 0.1 per cent of it the smaller."""
    if not losses:
        raise ValueError("no cell to choose from")
    best = min(losses.values())
    tied = [cell for cell, loss in losses.items() if loss <= best + TIE * abs(best)]
    return min(tied, key=_smaller)


def folds(seasons: Sequence[int]) -> tuple[tuple[int, tuple[int, ...]], ...]:
    """Each validation season after the first, with the seasons before it."""
    ordered = tuple(sorted(seasons))
    return tuple((s, ordered[:i]) for i, s in enumerate(ordered) if i > 0)


FoldLoss = Callable[[Cell, int], float]  # (cell, validation season) -> summed validation loss


@dataclass(slots=True)
class FoldCache:
    """Each (cell, validation season) loss computed once; a fold trains on every season before its
    validation season (the refits share their first season)."""

    loss: FoldLoss
    found: dict[tuple[Cell, int], float] = field(default_factory=dict)

    def fold(self, cell: Cell, season: int) -> float:
        key = (cell, season)
        if key not in self.found:
            self.found[key] = self.loss(cell, season)
        return self.found[key]

    def choose(self, seasons: Sequence[int], grid: Sequence[Cell]) -> Cell:
        validated = [s for s, _ in folds(seasons)]
        if not validated:
            raise ValueError(f"a refit on {list(seasons)} has no fold; it takes the cell its next refit chooses")
        return choose({cell: sum(self.fold(cell, s) for s in validated) for cell in grid})

    def losses(self, seasons: Sequence[int], grid: Sequence[Cell]) -> dict[str, float]:
        """The summed fold losses per cell, for the record."""
        validated = [s for s, _ in folds(seasons)]
        return {repr(cell): sum(self.fold(cell, s) for s in validated) for cell in grid}


Loss = Literal["poisson", "squared_error", "log_loss"]


class Booster(Protocol):
    """A scikit-learn histogram booster, regressor or classifier, as the round uses it."""

    def fit(self, x: np.ndarray, y: np.ndarray, sample_weight: np.ndarray | None = None) -> "Booster": ...

    def predict(self, x: np.ndarray) -> np.ndarray: ...

    def get_params(self) -> dict[str, Any]: ...


def booster(
    cell: Cell,
    loss: Loss,
    monotone: Sequence[int] | None = None,
    categorical: Sequence[bool] | None = None,
) -> Booster:
    """The cell's booster with the model's own loss."""
    common = {
        "learning_rate": LEARNING_RATE,
        "max_iter": cell.max_iter,
        "max_leaf_nodes": cell.max_leaf_nodes,
        "min_samples_leaf": cell.min_samples_leaf,
        "l2_regularization": cell.l2_regularization,
        "early_stopping": False,
        "random_state": RANDOM_STATE,
        "monotonic_cst": None if monotone is None else list(monotone),
        "categorical_features": None if categorical is None else np.asarray(categorical, dtype=bool),
    }
    if loss == "log_loss":
        return cast("Booster", HistGradientBoostingClassifier(loss="log_loss", **common))
    return cast("Booster", HistGradientBoostingRegressor(loss=loss, **common))


def probability(model: Booster, x: np.ndarray) -> np.ndarray:
    """A classifier's probability of the positive class (the class 1)."""
    found: np.ndarray = cast("Any", model).predict_proba(x)[:, 1]
    return found


_EPS: Final = 1e-12


def poisson_deviance_sum(y: np.ndarray, mu: np.ndarray) -> float:
    m = np.maximum(mu, _EPS)
    term = np.where(y > 0, y * np.log(np.where(y > 0, y, 1.0) / m), 0.0)
    return float(2.0 * np.sum(term - (y - m)))


def squared_error_sum(y: np.ndarray, predicted: np.ndarray, weight: np.ndarray) -> float:
    return float(np.sum(weight * (y - predicted) ** 2))


def log_loss_sum(y: np.ndarray, p: np.ndarray) -> float:
    q = np.clip(p, _EPS, 1.0 - _EPS)
    return float(-np.sum(y * np.log(q) + (1.0 - y) * np.log(1.0 - q)))
