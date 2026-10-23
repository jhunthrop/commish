"""THE TREES, TUNED INSIDE THEIR OWN WINDOW (preregistration 2.5, 2.8, 2.11 "Tuning").

One boosted tree per (position, component), or per (position, format) for the rival, each with round 4's
model class, grid and tie rule (`weekly4.tuning`): a refit on seasons S1 to Sk chooses its cell by
forward-chaining inside them (train on the seasons before s, validate on s, the loss summed over the
folds: Poisson deviance for counts, squared error for yards and the rival), then is fitted on all of them.
A one-season refit takes the cell its next refit chooses (R4 2.6's exception). The refits a run needs are
`refits`: the band seasons' (the player fit seasons before each) and the judged season's (all of them).
"""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from types import MappingProxyType
from typing import Final

import numpy as np
import pandas as pd

from research.model.weekly4.matrix import design
from research.model.weekly4.tuning import (
    BOOSTED_GRID,
    Cell,
    Constant,
    Fitted,
    FoldCache,
    Loss,
    Seasoned,
    model_loss,
    predict,
)

FROZEN: Final = MappingProxyType
Key = tuple[str, str]  # (position, component) or (position, format)
Refit = tuple[int, ...]


@dataclass(frozen=True, slots=True)
class TreeSpec:
    features: tuple[str, ...]
    target: str
    loss: Loss


@dataclass(frozen=True, slots=True)
class TreeFit:
    specs: Mapping[Key, TreeSpec]
    models: Mapping[Refit, Mapping[Key, Fitted]]
    cells: Mapping[Refit, Mapping[Key, Cell]]
    losses: Mapping[Refit, Mapping[Key, Mapping[str, float]]]  # per refit with folds: each cell's summed loss
    validation: Mapping[Key, Mapping[str, float]]  # the longest refit's chosen cell against the anchor


def refits_for(player_seasons: Sequence[int]) -> tuple[Refit, ...]:
    """The band seasons' refits (the seasons before each band season) and the judged season's (all)."""
    ordered = tuple(sorted(player_seasons))
    return tuple(ordered[:i] for i in range(1, len(ordered) + 1))


@dataclass(frozen=True, slots=True)
class _Seasoned(Seasoned):
    """Round 4's rows by season, with one case its boosters cannot fit: a count that is 0 in every training
    row (a tight end's carries in a short fold) is the constant 0, its expectation."""

    def fit_on(self, cell: Cell, rows: np.ndarray) -> Fitted:
        if self.loss == "poisson" and float(np.sum(self.y[rows])) <= 0.0:
            return Constant(0.0)
        return Seasoned.fit_on(self, cell, rows)


def _seasoned(rows: pd.DataFrame, spec: TreeSpec) -> Seasoned:
    x, categorical = design(rows, spec.features)
    return _Seasoned(x, rows[spec.target].to_numpy(dtype=float), rows["season"].to_numpy(), spec.loss, categorical)


def _choose_cells(
    cache: FoldCache, refits: Sequence[Refit], grid: Sequence[Cell], fixed: Cell | None
) -> dict[Refit, Cell]:
    chosen: dict[Refit, Cell] = {}
    for seasons in sorted(refits, key=len, reverse=True):
        if fixed is not None:
            chosen[seasons] = fixed
        elif len(seasons) > 1:
            chosen[seasons] = cache.choose(seasons, grid)
        else:
            longer = [r for r in chosen if r[: len(seasons)] == seasons]
            if not longer:
                raise ValueError(f"a one-season refit {seasons} needs its next refit's cell")
            chosen[seasons] = chosen[min(longer, key=len)]
    return chosen


def _anchor_loss(data: Seasoned, rows: pd.DataFrame, spec: TreeSpec, anchor: str | None) -> dict[str, float]:
    """The last fold: the chosen model's loss beside the anchor's (NaN anchors at the fold's training mean)."""
    if anchor is None or anchor not in rows:
        return {}
    season = int(np.max(data.seasons))
    test = data.seasons == season
    train_mean = float(np.mean(data.y[~test])) if (~test).any() else 0.0
    guess = rows.loc[test, anchor].to_numpy(dtype=float)
    guess = np.where(np.isfinite(guess), guess, train_mean)
    if spec.loss == "poisson":
        guess = np.maximum(guess, 1e-9)
    return {"season": float(season), "anchor": model_loss(spec.loss, data.y[test], guess)}


def fit_trees(  # noqa: PLR0913, PLR0917 - the family's every input, named
    rows: pd.DataFrame,
    specs: Mapping[Key, TreeSpec],
    refits: Sequence[Refit],
    grid: Sequence[Cell] = BOOSTED_GRID,
    fixed: Mapping[Key, Cell] | None = None,
    anchors: Mapping[Key, str] | None = None,
) -> TreeFit:
    """Each spec's tree for each refit: `rows` are the fit rows of the window (`key[0]` the position)."""
    models: dict[Refit, dict[Key, Fitted]] = {r: {} for r in refits}
    cells: dict[Refit, dict[Key, Cell]] = {r: {} for r in refits}
    losses: dict[Refit, dict[Key, Mapping[str, float]]] = {r: {} for r in refits if len(r) > 1}
    validation: dict[Key, Mapping[str, float]] = {}
    for key, spec in specs.items():
        mine = rows[rows["position"] == key[0]].reset_index(drop=True)
        data = _seasoned(mine, spec)
        cache = FoldCache(data.fold_loss)
        chosen = _choose_cells(cache, refits, grid, None if fixed is None else fixed[key])
        for seasons, cell in chosen.items():
            cells[seasons][key] = cell
            models[seasons][key] = data.fit_on(cell, np.isin(data.seasons, seasons))
            if seasons in losses and fixed is None:
                losses[seasons][key] = FROZEN(cache.losses(seasons, grid))
        longest = max(refits, key=len)
        if len(longest) > 1:
            found = dict(_anchor_loss(data, mine, spec, None if anchors is None else anchors.get(key)))
            if fixed is None:
                found["model"] = cache.fold(chosen[longest], int(np.max(data.seasons)))
            validation[key] = FROZEN(found)
    return TreeFit(
        FROZEN(dict(specs)),
        FROZEN({r: FROZEN(m) for r, m in models.items()}),
        FROZEN({r: FROZEN(c) for r, c in cells.items()}),
        FROZEN({r: FROZEN(v) for r, v in losses.items()}),
        FROZEN(validation),
    )


def predict_trees(fit: TreeFit, refit: Refit, rows: pd.DataFrame) -> pd.DataFrame:
    """Each spec's prediction for the rows of its position (`<target name>`), NaN elsewhere."""
    found = pd.DataFrame(index=rows.index)
    positions = rows["position"].to_numpy()
    for key, spec in fit.specs.items():
        column = f"tree_{key[1]}"
        if column not in found:
            found[column] = np.nan
        mine = positions == key[0]
        if not mine.any():
            continue
        x, _ = design(rows[mine], spec.features)
        found.loc[mine, column] = predict(fit.models[refit][key], spec.loss, x)
    return found


def cells_payload(fit: TreeFit) -> dict[str, dict[str, dict[str, object]]]:
    return {
        "-".join(map(str, r)): {"|".join(k): {"cell": repr(c)} for k, c in cells.items()}
        for r, cells in fit.cells.items()
    }
