"""HIS SEASON ANCHORS (preregistration 2.3): his season-to-date rate a game of each component a tree
predicts, over his games with a line this season before W, NaN before his first (the store's
`default_no_game_this_season` beside it). Read through `shrinkage.history_before`, so a line of week W or
later raises `InputRuleError`.
"""

from collections.abc import Sequence
from typing import Final

import pandas as pd

from research.model.weekly5.columns import anchor_column
from research.model.weekly5.shrinkage import history_before

ANCHORED: Final = ("targets", "receptions", "receiving_yards", "carries", "rushing_yards")


def anchors_at(games: pd.DataFrame, season: int, week: int, components: Sequence[str] = ANCHORED) -> pd.DataFrame:
    """Per player: his mean of each component over his lined games of `season` before `week`."""
    history = history_before(games, season, week)
    sums = history.groupby("player_id")[[*components, "games"]].sum()
    return pd.DataFrame(
        {anchor_column(c): sums[c] / sums["games"].where(sums["games"] > 0) for c in components}, index=sums.index
    )


def anchors(games: pd.DataFrame, rows: pd.DataFrame, components: Sequence[str] = ANCHORED) -> pd.DataFrame:
    """Every row's anchors at its (season, week), aligned to `rows`' index."""
    columns = [anchor_column(c) for c in components]
    parts = []
    for (season, week), keys in rows.groupby(["season", "week"], sort=True):
        s, w = int(str(season)), int(str(week))
        found = anchors_at(games[(games["season"] == s) & (games["week"] < w)], s, w, components)
        parts.append(keys[["player_id"]].join(found, on="player_id").drop(columns=["player_id"]))
    joined = pd.concat(parts) if parts else pd.DataFrame(columns=columns)
    return joined.reindex(index=rows.index, columns=columns).astype(float)
