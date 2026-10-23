"""THE POINT: EACH SCORED COMPONENT'S EXPECTATION, SCORED (preregistration 2.5 to 2.7, 2.12).

Per position, from the trees (2.5), the team model's expected volume for his club, the raw share models
(never normalised) and his shrunk rates (2.4):

- receivers (RB, WR, TE): targets, receptions, receiving yards, carries and rushing yards are the trees';
  touchdowns of kind k are the club's expected touchdowns of the kind x s x his shrunk conversion c_k,
  s = 0.5 x his modelled red-zone share + 0.5 x his modelled inside-ten share (2.7);
- quarterbacks (2.6): pass attempts = the club's expected dropbacks x his modelled dropback share x
  (1 - his sack rate - his scramble rate); passing yards and interceptions = attempts x his rates; passing
  touchdowns = the club's expected receiving touchdowns x his dropback share x his passing conversion;
  carries the tree's, rushing yards carries x his unpooled yards per carry, rushing touchdowns by 2.7 with s
  his season-to-date red-zone and inside-ten shares (no share model of them exists for quarterbacks);
- fumbles lost: expected touches (receptions plus carries; for a quarterback his expected dropbacks plus
  carries) x the position's fumbles lost per touch over the fit window's lined rows of weeks 1 to 17;
- two-point conversions 0.

A missing modelled share (NaN) falls back to his season-to-date share of the kind, else 0, counted
`no_share` (2.12). The point in format f is the house scoring of the expected components
(`domain.compute_fantasy_points`' terms, linear, the two-point term 0); a row with no game this season
before W takes the rate m in each format (2.12).
"""

from collections.abc import Mapping, Sequence
from types import MappingProxyType
from typing import Final

import numpy as np
import pandas as pd

from research.model.domain import ScoringRules
from research.model.weekly.round.scoring import FORMATS
from research.model.weekly5.columns import COMPONENTS
from research.model.weekly5.shrinkage import QB_CARRY, RATE_WEEKS, check_window, rate_column

FROZEN: Final = MappingProxyType
NO_SHARE: Final = "no_share"
RECEIVER_TOUCHES: Final = ("receptions", "carries")
QB_TOUCHES: Final = ("dropbacks", "carries")


def expected_column(component: str) -> str:
    """A player's expected component (beside the team model's `exp_<target>` volumes of his club)."""
    return f"expected_{component}"


def fumble_rates(games: pd.DataFrame, window: Sequence[int]) -> dict[str, float]:
    """Per position: fumbles lost per touch over the window's lined games of weeks 1 to 17 (touches:
    receptions plus carries; for a quarterback dropbacks plus carries)."""
    check_window(games["season"].unique(), window, "fumble constant")
    rated = games[games["week"].isin(RATE_WEEKS)]
    found: dict[str, float] = {}
    for position, mine in rated.groupby("position"):
        touches = QB_TOUCHES if position == "QB" else RECEIVER_TOUCHES
        total = float(mine[list(touches)].to_numpy(dtype=float).sum())
        found[str(position)] = float(mine["fumbles_lost"].sum()) / total if total > 0 else 0.0
    return found


def _share(rows: pd.DataFrame, modelled: str, season: str) -> tuple[np.ndarray, np.ndarray]:
    """The modelled share, else his season-to-date share, else 0; and whether it fell back."""
    model = rows[modelled].to_numpy(dtype=float, na_value=np.nan) if modelled in rows else np.full(len(rows), np.nan)
    to_date = rows[season].to_numpy(dtype=float, na_value=np.nan)
    missing = ~np.isfinite(model)
    found = np.where(missing, np.where(np.isfinite(to_date), to_date, 0.0), model)
    return found, missing


def _column(rows: pd.DataFrame, name: str) -> np.ndarray:
    return rows[name].to_numpy(dtype=float, na_value=np.nan)


def expected_components(rows: pd.DataFrame, fumbles: Mapping[str, float]) -> pd.DataFrame:
    """Each row's expected components (`expected_<component>`), and its `no_share` flag."""
    qb = rows["position"].to_numpy() == "QB"
    rate = {q: np.nan_to_num(_column(rows, rate_column(q))) for q in (
        "sacks_per_dropback", "scrambles_per_dropback", "passing_yards_per_attempt", "interceptions_per_attempt",
        "passing_conversion", "rushing_conversion", "receiving_conversion", QB_CARRY,
    )}  # fmt: skip
    red, red_missing = _share(rows, "model_red_zone", "share_season_red_zone")
    ten, ten_missing = _share(rows, "model_inside_ten", "share_season_inside_ten")
    drop, drop_missing = _share(rows, "model_dropbacks", "share_season_dropbacks")
    qb_red = np.nan_to_num(_column(rows, "share_season_red_zone"))
    qb_ten = np.nan_to_num(_column(rows, "share_season_inside_ten"))
    qb_missing = ~np.isfinite(_column(rows, "share_season_red_zone"))
    s = np.where(qb, 0.5 * qb_red + 0.5 * qb_ten, 0.5 * red + 0.5 * ten)
    dropbacks = np.nan_to_num(_column(rows, "exp_dropbacks"))
    attempts = dropbacks * drop * (1.0 - rate["sacks_per_dropback"] - rate["scrambles_per_dropback"])
    carries = np.nan_to_num(_column(rows, "tree_carries"))
    receptions = np.where(qb, 0.0, np.nan_to_num(_column(rows, "tree_receptions")))
    rushing_td = np.nan_to_num(_column(rows, "exp_rushing_touchdowns")) * s * rate["rushing_conversion"]
    receiving_td = np.nan_to_num(_column(rows, "exp_receiving_touchdowns")) * s * rate["receiving_conversion"]
    passing_td = np.nan_to_num(_column(rows, "exp_receiving_touchdowns")) * drop * rate["passing_conversion"]
    per_touch = rows["position"].map(fumbles).fillna(0.0).to_numpy(dtype=float)
    touches = np.where(qb, dropbacks * drop + carries, receptions + carries)
    found = {
        "pass_attempts": np.where(qb, attempts, 0.0),
        "passing_yards": np.where(qb, attempts * rate["passing_yards_per_attempt"], 0.0),
        "interceptions": np.where(qb, attempts * rate["interceptions_per_attempt"], 0.0),
        "passing_touchdowns": np.where(qb, passing_td, 0.0),
        "carries": carries,
        "rushing_yards": np.where(qb, carries * rate[QB_CARRY], np.nan_to_num(_column(rows, "tree_rushing_yards"))),
        "rushing_touchdowns": rushing_td,
        "targets": np.where(qb, 0.0, np.nan_to_num(_column(rows, "tree_targets"))),
        "receptions": receptions,
        "receiving_yards": np.where(qb, 0.0, np.nan_to_num(_column(rows, "tree_receiving_yards"))),
        "receiving_touchdowns": np.where(qb, 0.0, receiving_td),
        "fumbles_lost": touches * per_touch,
    }
    no_share = np.where(qb, drop_missing | qb_missing, red_missing | ten_missing)
    frame = pd.DataFrame({expected_column(c): found[c] for c in COMPONENTS}, index=rows.index)
    return frame.assign(**{NO_SHARE: no_share.astype(int)})


def score(components: pd.DataFrame, rules: ScoringRules) -> np.ndarray:
    """The house scoring of the expected components (linear; the two-point term 0)."""

    def c(name: str) -> np.ndarray:
        return components[expected_column(name)].to_numpy(dtype=float)

    found: np.ndarray = (
        c("passing_yards") * rules.points_per_passing_yard
        + c("passing_touchdowns") * rules.points_per_passing_touchdown
        + c("interceptions") * rules.points_per_interception
        + c("rushing_yards") * rules.points_per_rushing_yard
        + c("rushing_touchdowns") * rules.points_per_rushing_touchdown
        + c("receiving_yards") * rules.points_per_receiving_yard
        + c("receiving_touchdowns") * rules.points_per_receiving_touchdown
        + c("receptions") * rules.points_per_reception
        + c("fumbles_lost") * rules.points_per_fumble_lost
    )
    return found


def points(rows: pd.DataFrame, components: pd.DataFrame, numbered: np.ndarray) -> pd.DataFrame:
    """`point_<format>` per row: the scored components, or the rate m with no game this season before W;
    NaN for a row outside the projected set."""
    rate_only = rows["default_no_game_this_season"].fillna(0).to_numpy(dtype=int) == 1
    found = {}
    for name, rules in FORMATS.items():
        value = np.where(rate_only, _column(rows, f"rate_m_{name}"), score(components, rules))
        found[f"point_{name}"] = np.where(numbered, value, np.nan)
    return pd.DataFrame(found, index=rows.index)
