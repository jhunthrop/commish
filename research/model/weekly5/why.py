"""THE WHY (preregistration 2.10): round 4's seven factor groups, its neutral values and its exact Shapley
value over 2^7 = 128 coalitions of the deterministic point function, over the trees and the structural paths
of the chosen candidate.

v(S) is a row's point with the groups in S at their actual values and the others neutral (`board.Variant`):
groups 3 to 6 neutral on the whole club and the team rows, the team model's volume recomputed under them
(home field's neutral the mean of the point at home 0 and at home 1); groups 1 and 2 on the player's own
inputs (no teammate is renormalised, so a player's neutral inputs move only his own point); group 7 every
shrunk rate at the position's rate (n_eff = 0). The season anchors and the rate m belong to no group. The
values sum to the point less the neutral point. A player on the rate m has every value 0.

On the screen: the three groups with the largest absolute contribution and any other of at least 0.5 PPR
points (`shown`).
"""

from collections.abc import Mapping
from typing import Final

import numpy as np
import pandas as pd

from research.model.weekly.round.scoring import FORMATS
from research.model.weekly4.attribution import shapley, subsets
from research.model.weekly4.groups import GROUPS
from research.model.weekly5.board import SeasonData, SeasonModels, Shared, Variant, board

SHOWN: Final = 3
SHOWN_AT_LEAST: Final = 0.5  # PPR points


def coalition_points(
    data: SeasonData, models: SeasonModels, shared: Shared, candidate: str
) -> dict[frozenset[str], dict[str, np.ndarray]]:
    """v(S) for every coalition S of present groups: each row's point in each format."""
    found: dict[frozenset[str], dict[str, np.ndarray]] = {}
    for neutral in subsets(list(GROUPS)):
        homes = (0.0, 1.0) if "home_rest" in neutral else (None,)
        parts = [board(data, models, shared, candidate, Variant(groups=neutral), home=h) for h in homes]
        present = frozenset(GROUPS) - neutral
        found[present] = {n: np.mean([p[f"point_{n}"].to_numpy(dtype=float) for p in parts], axis=0) for n in FORMATS}
    return found


def attributions(data: SeasonData, models: SeasonModels, shared: Shared, candidate: str) -> pd.DataFrame:
    """Per row: each group's Shapley value in each format (`why_<group>_<format>`), the neutral point and the
    point."""
    values = coalition_points(data, models, shared, candidate)
    rows = data.rows[["season", "week", "club", "player_id", "position"]].copy()
    rate_only = data.rows["default_no_game_this_season"].fillna(0).to_numpy(dtype=int) == 1
    for name in FORMATS:
        by = {s: v[name] for s, v in values.items()}
        for group, value in shapley(by, GROUPS).items():
            rows[f"why_{group}_{name}"] = np.where(rate_only, 0.0, value)
        rows[f"neutral_{name}"] = by[frozenset()]
        rows[f"point_{name}"] = by[frozenset(GROUPS)]
    return rows


def shown(row: Mapping[str, float]) -> list[str]:
    """The groups the screen names for one row: the three largest by absolute PPR contribution, and any other
    of at least 0.5 points."""
    value = {g: float(row[f"why_{g}_ppr"]) for g in GROUPS}
    ordered = sorted(GROUPS, key=lambda g: (-abs(value[g]), GROUPS.index(g)))
    return [g for i, g in enumerate(ordered) if i < SHOWN or abs(value[g]) >= SHOWN_AT_LEAST]
