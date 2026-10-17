"""THE TEAM MODEL (preregistration section 2.5): one row per club-game, regular-season weeks 1 to 17.

It predicts the club's offensive plays, dropbacks, sacks, scrambles, designed rushes, team targets,
and rushing and receiving touchdowns, each a boosted Poisson model, from the club's implied points
and the opponent's, the spread, both clubs' pace and pass rate over expectation season to date
(shrunk), the defence's pass rate allowed and pressure, home field, rest days, division game, roof
state and the weather terms, with each 2.10 default's indicator. Monotone constraints: expected
touchdowns and plays never fall as the implied points rise. Fitted forward-chained by season (2.6):
the club-games of season s read the model fitted on the seasons before s.
"""

import time
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from types import MappingProxyType
from typing import Final

import numpy as np
import pandas as pd

from research.model.weekly4.matrix import design
from research.model.weekly4.tuning import BOOSTED_GRID, Cell, Fitted, FoldCache, Seasoned, predict

FROZEN: Final = MappingProxyType
TEAM_TARGETS: Final = (
    "plays",
    "dropbacks",
    "sacks",
    "scrambles",
    "designed_rushes",
    "team_targets",
    "rushing_touchdowns",
    "receiving_touchdowns",
)
MONOTONE_IN_IMPLIED: Final = ("plays", "rushing_touchdowns", "receiving_touchdowns")
GAME_FIGURES: Final = ("implied_points", "opponent_implied_points", "spread")
TEMPO: Final = ("own_pace", "own_pass_rate_over_expected", "opponent_pace", "opponent_pass_rate_over_expected")
DEFENCE: Final = ("opponent_pass_rate_allowed", "opponent_sack_rate", "opponent_hit_rate", "opponent_pfr_pressure_rate")
VENUE: Final = ("home", "rest_days", "division_game")
WEATHER: Final = ("roof", "indoor", "temperature_f", "wind_mph", "precipitation")
GAME_INDICATORS: Final = (
    "default_no_game_figure",
    "default_no_weather",
    "default_no_pace",
    "default_opponent_no_pace",
    "default_club_game_without_pace_or_pass_rate",
    "default_defence_without_a_dropback_faced",
    "default_defence_without_a_pfr_pressure_row",
    "default_pass_rate_allowed_without_a_game",
)
TEAM_FEATURES: Final = (*GAME_FIGURES, *TEMPO, *DEFENCE, *VENUE, *WEATHER, *GAME_INDICATORS)


def team_matrix(frame: pd.DataFrame) -> tuple[np.ndarray, tuple[bool, ...]]:
    return design(frame, TEAM_FEATURES)


def _monotone(target: str) -> tuple[int, ...]:
    rising = target in MONOTONE_IN_IMPLIED
    return tuple(1 if rising and name == "implied_points" else 0 for name in TEAM_FEATURES)


@dataclass(frozen=True, slots=True)
class TeamModel:
    trained_on: tuple[int, ...]
    models: Mapping[str, Fitted]


@dataclass(frozen=True, slots=True)
class TeamFit:
    models: Mapping[int, TeamModel]  # rows' season -> the model fitted on the seasons before it
    cells: Mapping[str, Mapping[int, Cell]]
    seconds: float


def fit_team_models(teams: pd.DataFrame, row_seasons: Sequence[int], grid: Sequence[Cell] = BOOSTED_GRID) -> TeamFit:
    """For each season s of `row_seasons`, every target fitted on the first season through s - 1."""
    started = time.monotonic()
    first = int(teams["season"].min())
    x, categorical = team_matrix(teams)
    seasons = teams["season"].to_numpy()
    models: dict[int, dict[str, Fitted]] = {s: {} for s in row_seasons}
    cells: dict[str, dict[int, Cell]] = {}
    for target in TEAM_TARGETS:
        y = teams[target].to_numpy(dtype=float)
        data = Seasoned(x, y, seasons, "poisson", categorical, _monotone(target))
        cache = FoldCache(data.fold_loss)
        cells[target] = {}
        for s in row_seasons:
            cell = cache.choose(tuple(range(first, s)), grid)
            cells[target][s] = cell
            models[s][target] = data.fit_before(cell, s)
    fitted = {s: TeamModel(tuple(range(first, s)), FROZEN(models[s])) for s in row_seasons}
    return TeamFit(FROZEN(fitted), FROZEN({k: FROZEN(v) for k, v in cells.items()}), time.monotonic() - started)


def predict_team(frame: pd.DataFrame, model: TeamModel) -> pd.DataFrame:
    """Each club-game's expected value of every target (`exp_<target>`)."""
    x, _ = team_matrix(frame)
    found = {f"exp_{t}": predict(model.models[t], "poisson", x) for t in TEAM_TARGETS}
    return pd.DataFrame(found, index=frame.index)
