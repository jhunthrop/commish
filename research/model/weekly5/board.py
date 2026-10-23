"""ONE SEASON'S BOARD: every player row with its inputs at its instant, both candidates' points.

For a season's rows (2.11's table, `SeasonModels`): the team model's eight expected volumes for his club
(forward-chained), the raw share models' shares (the refit on the player fit seasons before the season;
never normalised), his anchors and his shrunk rates (2.3, 2.4), then the components' point (2.5 to 2.7)
and the rival's (2.8), each only for a player who gets a number (2.2).

A `Variant` neutralises named groups (2.10's why) or applies a reported ablation (3.2) to the inputs and
rebuilds everything downstream, so the why, the ablations and the number share one code path. The game
and player groups are round 4's own transformations (`weekly4.board`, applied through round 4's
`Variant`): groups 3 to 6 on the whole club's rows and on the team rows (the team model's volume is
recomputed under them), groups 1 and 2 on the player's rows; group 7 sets every shrunk rate at the
position's rate (n_eff = 0). The season anchors and the rate m belong to no group.
"""

from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from typing import Final

import numpy as np
import pandas as pd

from research.model.weekly.round.scoring import FORMATS
from research.model.weekly4 import board as round_four
from research.model.weekly4.share_model import ShareModel, predict_shares
from research.model.weekly4.team_model import TeamModel, predict_team
from research.model.weekly5.anchors import anchors
from research.model.weekly5.columns import RATE_M, VOLUME_INPUTS
from research.model.weekly5.point import expected_components, points
from research.model.weekly5.projected import numbered
from research.model.weekly5.shrinkage import Shrinkage, shrunk_rates
from research.model.weekly5.trees import Refit, TreeFit, predict_trees

GAME_KEY: Final = ["season", "week", "club"]
SHARE_COLUMNS: Final = ("model_dropbacks", "model_red_zone", "model_inside_ten", "model_targets", "model_carries")
COMPONENTS_CANDIDATE: Final = "components"
RIVAL_CANDIDATE: Final = "rival"
CANDIDATES: Final = (COMPONENTS_CANDIDATE, RIVAL_CANDIDATE)


@dataclass(frozen=True, slots=True)
class SeasonModels:
    """The models a season's rows read (2.11): the team model fitted before the season, the share refit and
    the trees' refit on the player fit seasons before it (all of them for the judged season)."""

    season: int
    team: TeamModel
    shares: ShareModel | None  # None: a season with no earlier player fit season (its rows only fit)
    refit: Refit | None


@dataclass(frozen=True, slots=True)
class Shared:
    """Fitted once on the player window: the shrinkage, the fumble constants, the trees and the rival."""

    shrinkage: Shrinkage
    fumbles: Mapping[str, float]
    trees: TreeFit | None
    rival: TreeFit | None
    lined: pd.DataFrame  # every lined player-game of the run's player seasons, realised


@dataclass(slots=True)
class SeasonData:
    season: int
    rows: pd.DataFrame  # the store's rows with the rate m, `lined`, the forms, the actual points, the targets
    teams: pd.DataFrame
    cache: dict[object, pd.DataFrame] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class Variant:
    """What the board neutralises (2.10's groups) and which reported ablation it applies (3.2)."""

    groups: frozenset[str] = frozenset()
    hide_figure: bool = False
    no_charted: bool = False
    transform: Callable[[pd.DataFrame], pd.DataFrame] | None = None
    volumes_neutral: bool = False  # the eight volumes at the week's club-game mean, in the trees only
    no_anchors: bool = False
    no_rate_m: bool = False  # the rate m out of the trees' inputs (the rate-m rows keep it)
    volume_share_touchdowns: bool = False  # the touchdown share replaced by his modelled volume share
    decay: float | None = None  # every shrunk quantity at this decay, its chosen k (round 4's share decay)


THE_NUMBER: Final = Variant()


def _round_four(variant: Variant) -> round_four.Variant:
    return round_four.Variant(
        groups=variant.groups,
        hide_figure=variant.hide_figure,
        no_charted=variant.no_charted,
        transform=variant.transform,
    )


def _cached(data: SeasonData, key: object, build: Callable[[], pd.DataFrame]) -> pd.DataFrame:
    if key not in data.cache:
        data.cache[key] = build()
    return data.cache[key]


def inputs(
    data: SeasonData,
    models: SeasonModels,
    shared: Shared,
    variant: Variant = THE_NUMBER,
    home: float | None = None,
) -> pd.DataFrame:
    """The season's rows with every input of 2.3 and of the structural paths under `variant`."""
    v = _round_four(variant)
    rows = round_four._with_game_neutral(
        round_four._game_level(round_four._player_level(data.rows, v), v, home),
        data.teams,
        v,
    )
    teams = round_four._with_game_neutral(round_four._game_level(data.teams, v, home), data.teams, v)
    volume = teams[GAME_KEY].join(predict_team(teams, models.team))
    frame = rows.merge(volume, on=GAME_KEY, how="left")
    frame.index = rows.index
    anchored = _cached(data, "anchors", lambda: anchors(shared.lined, data.rows))
    neutral = "efficiency" in variant.groups
    shrunk = _cached(
        data,
        ("shrunk", neutral, variant.decay),
        lambda: shrunk_rates(shared.lined, data.rows, shared.shrinkage, neutral, variant.decay),
    )
    frame = frame.join(anchored).join(shrunk)
    if models.shares is not None:
        frame = frame.join(predict_shares(frame, models.shares))
    else:
        frame = frame.assign(**dict.fromkeys(SHARE_COLUMNS, np.nan))
    return frame


def tree_inputs(frame: pd.DataFrame, variant: Variant) -> pd.DataFrame:
    """The trees' view of the inputs under the ablations that touch only the trees."""
    found = frame
    if variant.volumes_neutral:
        means = found.groupby(["season", "week"])[list(VOLUME_INPUTS)].transform("mean")
        found = found.assign(**{c: means[c] for c in VOLUME_INPUTS})
    if variant.no_anchors:
        found = found.assign(**{c: np.nan for c in found.columns if c.startswith("anchor_")})
    if variant.no_rate_m:
        found = found.assign(**{RATE_M: np.nan})
    return found


def components_points(frame: pd.DataFrame, shared: Shared, refit: Refit, variant: Variant) -> pd.DataFrame:
    """The components candidate: the trees, the structural paths, scored (`point_<format>`), and the
    expected components and the `no_share` flag beside them."""
    if shared.trees is None:
        raise ValueError("the components candidate was not fitted for this run")
    trees = predict_trees(shared.trees, refit, tree_inputs(frame, variant))
    joined = frame.join(trees)
    if variant.volume_share_touchdowns:
        joined = joined.assign(model_red_zone=joined["model_targets"], model_inside_ten=joined["model_carries"])
    expected = expected_components(joined, shared.fumbles)
    return points(frame, expected, numbered(frame)).join(expected)


def rival_points(frame: pd.DataFrame, shared: Shared, refit: Refit, variant: Variant) -> pd.DataFrame:
    """The rival: his recent form plus the tree's residual in each format; the rate m with no game this
    season before W or no form (`rival_no_form`)."""
    if shared.rival is None:
        raise ValueError("the rival was not fitted for this run")
    trees = predict_trees(shared.rival, refit, tree_inputs(frame, variant))
    no_form = (frame["default_no_game_this_season"].fillna(0).to_numpy(dtype=int) == 1) | ~np.isfinite(
        frame["form_ppr"].to_numpy(dtype=float, na_value=np.nan)
    )
    found: dict[str, np.ndarray] = {}
    keep = numbered(frame)
    for name in FORMATS:
        point = frame[f"form_{name}"].to_numpy(dtype=float, na_value=np.nan) + trees[f"tree_{name}"].to_numpy(
            dtype=float
        )
        rate = frame[f"rate_m_{name}"].to_numpy(dtype=float, na_value=np.nan)
        found[f"point_{name}"] = np.where(keep, np.where(no_form, rate, point), np.nan)
    return pd.DataFrame(found, index=frame.index).assign(rival_no_form=no_form.astype(int))


def board(  # noqa: PLR0913, PLR0917 - one candidate's board, every input named
    data: SeasonData,
    models: SeasonModels,
    shared: Shared,
    candidate: str,
    variant: Variant = THE_NUMBER,
    home: float | None = None,
) -> pd.DataFrame:
    """The season's rows with the candidate's point in each format under `variant`."""
    if models.refit is None:
        raise ValueError(f"{models.season}'s rows only fit; no refit scores them")
    frame = inputs(data, models, shared, variant, home)
    scored = (
        components_points(frame, shared, models.refit, variant)
        if candidate == COMPONENTS_CANDIDATE
        else rival_points(frame, shared, models.refit, variant)
    )
    return frame.join(scored)
