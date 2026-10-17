"""THE PLAY-LEVEL EXPECTED-POINTS MODEL (preregistration section 2.3, fitted as 2.6 says).

For each target, the catch probability, the expected receiving yards and the touchdown probability,
from air yards, field position (`yardline_100`), down, distance, pass location, roof state, wind,
temperature and the precipitation flag. For each carry (a designed rush), the expected rushing yards
and the touchdown probability from field position, down, distance, run location and gap, and the
same weather and roof terms. For each dropback, the completion, yards, touchdown and interception
probabilities. Each a boosted model with its own loss: log loss for a probability, squared error for
yards.

A target's xFP in format f is its catch probability times the format's reception value, plus
expected yards over ten, plus six times its touchdown probability; a carry's is its expected yards
over ten plus six times its touchdown probability; a dropback's is its expected passing yards over
25, plus four times its passing-touchdown probability, less two times its interception probability.

Fitted forward-chained by season: the plays of season s are priced by the model fitted on the seasons
before s, each refit choosing its cell inside its own seasons (`tuning`).

The receiving yards of a target count on a catch only; a dropback's passing yards and passing
touchdown count on a completion only. A scramble (a dropback that is no sack, no completion and no
interception, with yards or a touchdown) is a quarterback's run; its value is the training seasons'
mean yards and touchdowns per scramble (2.6's simulation draws scrambles on their own).
"""

import time
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from types import MappingProxyType
from typing import Final

import numpy as np
import pandas as pd

from research.model.weekly4.matrix import design
from research.model.weekly4.tuning import BOOSTED_GRID, Cell, Fitted, FoldCache, Loss, Seasoned, predict

FROZEN: Final = MappingProxyType
KINDS: Final = ("target", "carry", "dropback")
SUBMODELS: Final[Mapping[str, Mapping[str, Loss]]] = FROZEN(
    {
        "target": FROZEN({"catch": "log_loss", "yards": "squared_error", "td": "log_loss"}),
        "carry": FROZEN({"yards": "squared_error", "td": "log_loss"}),
        "dropback": FROZEN(
            {"complete": "log_loss", "pass_yards": "squared_error", "pass_td": "log_loss", "interception": "log_loss"}
        ),
    }
)
RECEPTION_VALUE: Final = FROZEN({"ppr": 1.0, "half": 0.5, "std": 0.0})  # 2.3: "1 in PPR, 0.5 in half, 0 in standard"
FORMAT_NAMES: Final = tuple(RECEPTION_VALUE)
YARDS_PER_POINT: Final = 10.0
PASSING_YARDS_PER_POINT: Final = 25.0
TOUCHDOWN: Final = 6.0
PASSING_TOUCHDOWN: Final = 4.0
INTERCEPTION: Final = -2.0

_WEATHER: Final = ("roof", "wind_mph", "temperature_f", "precipitation")
_SITUATION: Final = ("yardline_100", "down", "ydstogo")
FEATURES: Final = FROZEN(
    {
        "target": ("air_yards", *_SITUATION, "pass_location", *_WEATHER),
        "carry": (*_SITUATION, "run_location", "run_gap", *_WEATHER),
        "dropback": (*_SITUATION, *_WEATHER),
    }
)


def _flag(series: pd.Series) -> np.ndarray:
    return series.fillna(0.0).to_numpy(dtype=float)


def scramble(plays: pd.DataFrame) -> pd.Series:
    """A dropback that is a quarterback's run: no sack, no completion, no interception, and yards or
    a touchdown (an incompletion gains none)."""
    quiet = (_flag(plays["sack"]) == 0) & (_flag(plays["complete_pass"]) == 0) & (_flag(plays["interception"]) == 0)
    moved = (plays["yards_gained"].fillna(0.0) != 0) | (_flag(plays["touchdown"]) == 1)
    return pd.Series(quiet & moved.to_numpy() & (plays["kind"] == "dropback").to_numpy(), index=plays.index)


def targets_of(plays: pd.DataFrame, kind: str) -> pd.DataFrame:
    """Each sub-model's target for the kind's plays."""
    complete = _flag(plays["complete_pass"]) if "complete_pass" in plays else np.zeros(len(plays))
    yards = plays["yards_gained"].fillna(0.0).to_numpy(dtype=float)
    touchdown = _flag(plays["touchdown"])
    if kind == "target":
        found = {"catch": complete, "yards": yards * complete, "td": touchdown}
    elif kind == "carry":
        found = {"yards": yards, "td": touchdown}
    else:
        found = {
            "complete": complete,
            "pass_yards": yards * complete,
            "pass_td": touchdown * complete,
            "interception": _flag(plays["interception"]),
        }
    return pd.DataFrame(found, index=plays.index)


def play_matrix(plays: pd.DataFrame, kind: str) -> tuple[np.ndarray, tuple[bool, ...]]:
    """The kind's feature matrix, categories as codes with missing as NaN, and the categorical mask."""
    return design(plays, FEATURES[kind])


@dataclass(frozen=True, slots=True)
class PlayModel:
    """The sub-models fitted on `trained_on`, and the scramble's mean value over those seasons."""

    trained_on: tuple[int, ...]
    models: Mapping[str, Fitted]  # "kind|sub" -> model
    scramble_yards: float  # per scramble
    scramble_touchdowns: float  # per scramble


@dataclass(frozen=True, slots=True)
class PlayFit:
    models: Mapping[int, PlayModel]  # pricing season -> the model fitted on the seasons before it
    cells: Mapping[str, Mapping[int, Cell]]  # "kind|sub" -> pricing season -> chosen cell
    seconds: float


def _scramble_means(plays: pd.DataFrame) -> tuple[float, float]:
    found = plays[scramble(plays)]
    if found.empty:
        return 0.0, 0.0
    return float(found["yards_gained"].fillna(0.0).mean()), float(_flag(found["touchdown"]).mean())


def fit_play_models(
    plays: pd.DataFrame,
    pricing_seasons: Sequence[int],
    grid: Sequence[Cell] = BOOSTED_GRID,
    fixed: Mapping[str, Cell] | None = None,
) -> PlayFit:
    """For each pricing season s, every sub-model fitted on the seasons from the first through s - 1,
    its cell chosen by forward-chaining inside those seasons."""
    started = time.monotonic()
    first = int(plays["season"].min())
    by_kind = {kind: plays[plays["kind"] == kind] for kind in KINDS}
    matrices = {kind: play_matrix(frame, kind) for kind, frame in by_kind.items()}
    seasons = {kind: frame["season"].to_numpy() for kind, frame in by_kind.items()}
    models: dict[int, dict[str, Fitted]] = {s: {} for s in pricing_seasons}
    cells: dict[str, dict[int, Cell]] = {}
    for kind, subs in SUBMODELS.items():
        x, categorical = matrices[kind]
        targets = targets_of(by_kind[kind], kind)
        for sub, loss in subs.items():
            key = f"{kind}|{sub}"
            data = Seasoned(x, targets[sub].to_numpy(dtype=float), seasons[kind], loss, categorical)
            cache = FoldCache(data.fold_loss)
            cells[key] = {}
            for s in pricing_seasons:
                cell = fixed[key] if fixed is not None else cache.choose(tuple(range(first, s)), grid)
                cells[key][s] = cell
                models[s][key] = data.fit_before(cell, s)
    fitted = {
        s: PlayModel(tuple(range(first, s)), FROZEN(models[s]), *_scramble_means(plays[plays["season"] < s]))
        for s in pricing_seasons
    }
    frozen_cells = FROZEN({key: FROZEN(found) for key, found in cells.items()})
    return PlayFit(FROZEN(fitted), frozen_cells, time.monotonic() - started)


def xfp_columns(priced: pd.DataFrame) -> pd.DataFrame:
    """xFP in each format from the priced sub-model columns."""
    kind = priced["kind"].to_numpy()
    out = {}
    for name, reception in RECEPTION_VALUE.items():
        target = (
            reception * priced.get("x_catch", 0.0)
            + priced.get("x_yards", 0.0) / YARDS_PER_POINT
            + TOUCHDOWN * priced.get("x_td", 0.0)
        )
        dropback = (
            priced.get("x_pass_yards", 0.0) / PASSING_YARDS_PER_POINT
            + PASSING_TOUCHDOWN * priced.get("x_pass_td", 0.0)
            + INTERCEPTION * priced.get("x_interception", 0.0)
        )
        carry = priced.get("x_yards", 0.0) / YARDS_PER_POINT + TOUCHDOWN * priced.get("x_td", 0.0)
        value = np.where(kind == "target", target, np.where(kind == "carry", carry, dropback))
        out[f"xfp_{name}"] = np.asarray(value, dtype=float)
    return priced.assign(**out)


def price(plays: pd.DataFrame, model: PlayModel) -> pd.DataFrame:
    """Each play's sub-model predictions (`x_<sub>`) and its xFP in each format."""
    parts: list[pd.DataFrame] = []
    for kind, subs in SUBMODELS.items():
        frame = plays[plays["kind"] == kind]
        if frame.empty:
            continue
        x, _ = play_matrix(frame, kind)
        found = {f"x_{sub}": predict(model.models[f"{kind}|{sub}"], loss, x) for sub, loss in subs.items()}
        parts.append(frame.assign(**found))
    if not parts:
        return xfp_columns(plays.copy())
    return xfp_columns(pd.concat(parts).loc[plays.index[plays["kind"].isin(SUBMODELS)]])


def actual_points(plays: pd.DataFrame) -> pd.DataFrame:
    """Each play's actual points in each format, scored as its kind's xFP is (the FPOE's minuend)."""
    found = pd.concat([targets_of(plays[plays["kind"] == k], k) for k in KINDS]).loc[plays.index]
    renamed = found.rename(columns=lambda c: f"x_{c}").assign(kind=plays["kind"])
    scored = xfp_columns(renamed)
    return pd.DataFrame({f"fp_{n}": scored[f"xfp_{n}"] for n in FORMAT_NAMES}, index=plays.index)
