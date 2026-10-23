"""THE COMPONENT MODELS (design 5.2 and 5.3; Amendment 7 item 4), each a round 4 booster on round 4's grid
and tie rule (`weekly4.tuning`), fitted forward-chained by season: a row of season s reads the model fitted
on the seasons before s, its cell chosen inside those seasons (round 4 section 2.6, unchanged).

- `points`: boosted Poisson for the points the scoring club makes (the mean the kernel is tilted to);
- `interceptions`, `fumble_recoveries`: boosted Poisson for the defense's takeaways;
- `attempts`: boosted Poisson for the club's field-goal attempts;
- `band_<j>`: the multinomial over the six distance bands as its continuation ratios, five boosted
  classifiers in log loss, classifier j the chance an attempt is in band j given it is in band j or later;
- `make`: the play-level boosted classifier on every field goal of the fit seasons (distance, weather,
  roof, surface, the Denver venue and the kicker's shrunk makes over expected), monotone falling in distance;
- `extra_point`: the same classifier's form on the extra points (weather and the kicker's shrunk rate).
"""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from types import MappingProxyType
from typing import Final

import numpy as np
import pandas as pd

from research.model.weekly4.matrix import design
from research.model.weekly4.tuning import BOOSTED_GRID, Cell, Fitted, FoldCache, Loss, Seasoned, predict
from research.model.weekly_kdef.scoring import FG_BANDS

FROZEN: Final = MappingProxyType
WEATHER: Final = ("roof", "indoor", "wind_mph", "temperature_f", "precipitation")
POINTS_FEATURES: Final = (
    "implied_points",
    "spread",
    "def_pa_over_expected",
    *WEATHER,
    "home",
    "rest_days",
)
INTERCEPTION_FEATURES: Final = (
    "exp_dropbacks",
    "passer_int_rate",
    "def_int_per_dropback",
    "spread",
    "wind_mph",
    "precipitation",
)
RECOVERY_FEATURES: Final = (
    "exp_plays",
    "off_fumbles_lost_per_play",
    "def_fr_per_play",
    "precipitation",
    "temperature_f",
)
ATTEMPT_FEATURES: Final = (
    "implied_points",
    "spread",
    "exp_plays",
    "exp_tds",
    "off_fg_share",
    "def_fg_share_allowed",
    "fourth_down_go_rate",
    *WEATHER,
    "denver",
    "kicker_long_share",
)
BAND_FEATURES: Final = (
    "implied_points",
    "spread",
    "off_fg_share",
    "def_fg_share_allowed",
    *WEATHER,
    "denver",
    "kicker_long_share",
)
MAKE_FEATURES: Final = ("distance", *WEATHER, "grass", "denver", "kicker_accuracy_over_expected")
EXTRA_POINT_FEATURES: Final = (*WEATHER, "kicker_xp_rate")
BAND_MODELS: Final = tuple(f"band_{j}" for j in range(len(FG_BANDS) - 1))


@dataclass(frozen=True, slots=True)
class Spec:
    name: str
    features: tuple[str, ...]
    loss: Loss
    target: str
    falling: str | None = None  # a feature the prediction may only fall in


SPECS: Final = FROZEN(
    {
        "points": Spec("points", POINTS_FEATURES, "poisson", "d_points_allowed"),
        "interceptions": Spec("interceptions", INTERCEPTION_FEATURES, "poisson", "d_interceptions"),
        "fumble_recoveries": Spec("fumble_recoveries", RECOVERY_FEATURES, "poisson", "d_fumble_recoveries"),
        "attempts": Spec("attempts", ATTEMPT_FEATURES, "poisson", "club_fg_att"),
        **{name: Spec(name, BAND_FEATURES, "log_loss", "in_band") for name in BAND_MODELS},
        "make": Spec("make", MAKE_FEATURES, "log_loss", "made", "distance"),
        "extra_point": Spec("extra_point", EXTRA_POINT_FEATURES, "log_loss", "made"),
    }
)


@dataclass(frozen=True, slots=True)
class Model:
    """One component: its spec, and per row season the model fitted on the seasons before it."""

    spec: Spec
    by_season: Mapping[int, Fitted]
    cells: Mapping[int, Cell]

    def predict(self, frame: pd.DataFrame) -> np.ndarray:
        """Each row's mean from its season's model; NaN for a season with none."""
        x, _ = design(frame, self.spec.features)
        found = np.full(len(frame), np.nan)
        seasons = frame["season"].to_numpy()
        for season, model in self.by_season.items():
            rows = seasons == season
            if rows.any():
                found[rows] = predict(model, self.spec.loss, x[rows])
        return found


def fit_model(
    spec: Spec, frame: pd.DataFrame, row_seasons: Sequence[int], grid: Sequence[Cell] = BOOSTED_GRID
) -> Model:
    """The spec fitted forward-chained: for each s of `row_seasons`, its cell chosen inside the seasons
    before s and the model fitted on them. `frame`'s target is read only on seasons before each s."""
    x, categorical = design(frame, spec.features)
    y = np.nan_to_num(frame[spec.target].to_numpy(dtype=float))
    seasons = frame["season"].to_numpy()
    monotone = tuple(-1 if name == spec.falling else 0 for name in spec.features)
    data = Seasoned(x, y, seasons, spec.loss, categorical, monotone)
    cache = FoldCache(data.fold_loss)
    first = int(seasons.min())
    models: dict[int, Fitted] = {}
    cells: dict[int, Cell] = {}
    for s in row_seasons:
        cells[s] = cache.choose(tuple(range(first, s)), grid)
        models[s] = data.fit_before(cells[s], s)
    return Model(spec, FROZEN(models), FROZEN(cells))


def band_rows(frame: pd.DataFrame, j: int) -> pd.DataFrame:
    """Classifier j's rows: each attempt of band j or later once, `in_band` 1 for band j."""
    parts: list[pd.DataFrame] = []
    later = [f"club_fg_{b}" for b in FG_BANDS[j + 1 :]]
    here = frame[f"club_fg_{FG_BANDS[j]}"].fillna(0).astype(int).to_numpy()
    rest = frame[later].fillna(0).sum(axis=1).astype(int).to_numpy()
    for count, flag in ((here, 1.0), (rest, 0.0)):
        if count.sum() > 0:
            parts.append(frame.loc[frame.index.repeat(count)].assign(in_band=flag))
    if not parts:
        return frame.iloc[0:0].assign(in_band=0.0)
    return pd.concat(parts, ignore_index=True)


def band_probabilities(models: Mapping[str, Model], frame: pd.DataFrame) -> np.ndarray:
    """Each row's probability of each distance band (rows x 6), from the continuation ratios."""
    left = np.ones(len(frame))
    found = np.zeros((len(frame), len(FG_BANDS)))
    for j, name in enumerate(BAND_MODELS):
        hazard = np.clip(models[name].predict(frame), 0.0, 1.0)
        found[:, j] = left * hazard
        left = left * (1.0 - hazard)
    found[:, -1] = left
    return found


@dataclass(frozen=True, slots=True)
class Components:
    models: Mapping[str, Model]


def fit_components(
    rows: pd.DataFrame,
    kicks: pd.DataFrame,
    extra_points: pd.DataFrame,
    row_seasons: Sequence[int],
    grid: Sequence[Cell],
) -> Components:
    """Every component model for the row seasons (the calibration seasons and the judged season)."""
    found: dict[str, Model] = {}
    for name in ("points", "interceptions", "fumble_recoveries", "attempts"):
        found[name] = fit_model(SPECS[name], rows, row_seasons, grid)
    for j, name in enumerate(BAND_MODELS):
        found[name] = fit_model(SPECS[name], band_rows(rows, j), row_seasons, grid)
    found["make"] = fit_model(SPECS["make"], kicks, row_seasons, grid)
    found["extra_point"] = fit_model(SPECS["extra_point"], extra_points, row_seasons, grid)
    return Components(FROZEN(found))
