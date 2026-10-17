"""A PLAYER'S OPPORTUNITY HISTORY AT A ROW (preregistration section 2.3).

For each player row (season s, week W) and each kind of opportunity (target, carry, dropback): his
opportunities over this season's weeks before W and the prior season, decayed, each weighted by
decay^(age in his games), the age 0 for his latest game before W. From them the decayed effective
count n and the decayed sums the efficiency reads: catches and expected catches, yards over expected,
touchdowns and expected touchdowns, and for a dropback its scrambles and the dropbacks without a sack.

The week's expected value per opportunity is the decayed mean, over the opportunities he has drawn
this season, of the play model's prediction re-priced with the week's weather and roof in place of
those plays' own (`repriced`), "so a deep receiver in wind is priced as deep in wind".

Only plays of weeks before W are history: every play of a week before W is stamped before W's first
instant (checked by the round on the store's stamps), so the rule "before W" is the input rule here.
"""

from collections.abc import Callable, Mapping, Sequence
from typing import Final

import numpy as np
import pandas as pd

from research.model.weekly4.play_model import SUBMODELS, scramble, targets_of

KINDS: Final = ("target", "carry", "dropback")
# Per kind, the per-play columns summed (decayed) into the row's history.
STATS: Final = {
    "target": ("n", "catch", "xcatch", "yards_over", "td", "xtd"),
    "carry": ("n", "yards_over", "td", "xtd"),
    "dropback": ("n", "yards_over", "scrambles", "not_sacked", "interceptions", "xinterceptions"),
}
WEATHER_TERMS: Final = ("roof", "temperature_f", "wind_mph", "precipitation")
_KEY: Final = ["player_id", "season", "week"]


def _column(plays: pd.DataFrame, name: str) -> np.ndarray:
    if name not in plays:
        return np.zeros(len(plays))
    return plays[name].fillna(0.0).to_numpy(dtype=float)


def with_outcomes(plays: pd.DataFrame) -> pd.DataFrame:
    """Each play's per-kind history columns (`h_<stat>`), its outcome against its own expectation."""
    kind = plays["kind"].to_numpy()
    parts = [targets_of(plays[kind == k], k).add_prefix("a_") for k in KINDS if (kind == k).any()]
    actual = pd.concat(parts).reindex(plays.index) if parts else pd.DataFrame(index=plays.index)
    a = {c: actual[c].fillna(0.0).to_numpy(dtype=float) for c in actual.columns}
    zero = np.zeros(len(plays))
    target, carry, dropback = kind == "target", kind == "carry", kind == "dropback"
    sacked = _column(plays, "sack")
    found = {
        "h_n": np.ones(len(plays)),
        "h_catch": np.where(target, a.get("a_catch", zero), 0.0),
        "h_xcatch": np.where(target, _column(plays, "x_catch"), 0.0),
        "h_yards_over": np.where(
            dropback,
            a.get("a_pass_yards", zero) - _column(plays, "x_pass_yards"),
            a.get("a_yards", zero) - _column(plays, "x_yards"),
        ),
        "h_td": np.where(target | carry, a.get("a_td", zero), 0.0),
        "h_xtd": np.where(target | carry, _column(plays, "x_td"), 0.0),
        "h_scrambles": np.where(dropback, scramble(plays).to_numpy(dtype=float), 0.0),
        "h_not_sacked": np.where(dropback, 1.0 - sacked, 0.0),
        "h_interceptions": np.where(dropback, a.get("a_interception", zero), 0.0),
        "h_xinterceptions": np.where(dropback, _column(plays, "x_interception"), 0.0),
    }
    return plays.assign(**found)


def row_games(rows: pd.DataFrame, plays: pd.DataFrame, decay: float) -> pd.DataFrame:
    """Each row's games in its history (this season before W, and the season before), with the
    game's age in his games and its weight decay^age. `row` is the row's index."""
    games = plays[_KEY].drop_duplicates()
    left = pd.DataFrame(
        {"row": rows.index, "player_id": rows["player_id"].to_numpy(), "row_season": rows["season"].to_numpy()}
    ).assign(row_week=rows["week"].to_numpy())
    pairs = left.merge(games, on="player_id", how="inner")
    this = (pairs["season"] == pairs["row_season"]) & (pairs["week"] < pairs["row_week"])
    pairs = pairs[this | (pairs["season"] == pairs["row_season"] - 1)]
    pairs = pairs.sort_values(["row", "season", "week"], ascending=[True, False, False])
    age = pairs.groupby("row").cumcount().to_numpy()
    return pairs.assign(age=age, weight=decay ** age.astype(float), this_season=this[pairs.index].to_numpy())


def decayed_history(rows: pd.DataFrame, plays: pd.DataFrame, decay: float) -> pd.DataFrame:
    """Per row and kind, the decayed sums `<kind>_<stat>` over both seasons and the decayed count
    `<kind>_n_this_season`; zeros with no history."""
    pairs = row_games(rows, plays, decay)
    columns = [f"h_{s}" for s in sorted({s for stats in STATS.values() for s in stats})]
    games = plays.groupby([*_KEY, "kind"], as_index=False)[columns].sum()
    joined = pairs.merge(games, on=_KEY, how="inner")
    weight = joined["weight"].to_numpy()
    found = pd.DataFrame(index=rows.index)
    for kind, stats in STATS.items():
        mine = joined["kind"].to_numpy() == kind
        sub = joined[mine]
        sums = {f"{kind}_{s}": sub[f"h_{s}"].to_numpy() * weight[mine] for s in stats}
        frame = pd.DataFrame(sums).assign(row=sub["row"].to_numpy())
        frame[f"{kind}_n_this_season"] = frame[f"{kind}_n"] * sub["this_season"].to_numpy()
        found = found.join(frame.groupby("row").sum(), how="left")
    return found.fillna(0.0)


Pricer = Callable[[pd.DataFrame, int], pd.DataFrame]  # (plays, season) -> the plays priced (`x_<sub>`)


def repriced(
    rows: pd.DataFrame,
    plays: pd.DataFrame,
    decay: float,
    pricer: Pricer,
    fallback: Mapping[tuple[str, str], Mapping[str, float]],
) -> pd.DataFrame:
    """Per row and kind, the decayed mean of each `x_<sub>` over his opportunities this season before
    W, re-priced with the row's weather and roof (`<kind>_wx_<sub>`); with none this season, the
    position's mean per opportunity over the fit rows (`fallback[(position, kind)]`, 2.10)."""
    pairs = row_games(rows, plays, decay)
    pairs = pairs[pairs["this_season"]]
    weather = rows[list(WEATHER_TERMS)].rename(columns=lambda c: f"row_{c}")
    pairs = pairs.join(weather, on="row")
    found = pd.DataFrame(index=rows.index)
    positions = rows["position"]
    for kind, subs in SUBMODELS.items():
        mine = plays[plays["kind"] == kind].drop(columns=list(WEATHER_TERMS))
        joined = pairs.merge(mine, on=_KEY, how="inner")
        names = [f"x_{s}" for s in subs]
        means = pd.DataFrame(index=rows.index, columns=names, dtype=float)
        if not joined.empty:
            joined = joined.rename(columns={f"row_{c}": c for c in WEATHER_TERMS})
            parts = [pricer(group, int(str(season))) for season, group in joined.groupby("row_season")]
            priced = pd.concat(parts)
            weight = priced["weight"].to_numpy()
            weighted = pd.DataFrame({n: priced[n].to_numpy() * weight for n in names}).assign(
                row=priced["row"].to_numpy(), weight=weight
            )
            sums = weighted.groupby("row").sum()
            means.loc[sums.index, names] = sums[names].to_numpy() / sums[["weight"]].to_numpy()
        for name in names:
            sub = name.removeprefix("x_")
            default = positions.map(lambda p, sub=sub, kind=kind: fallback.get((p, kind), {}).get(sub, np.nan))
            found[f"{kind}_wx_{sub}"] = means[name].fillna(default).astype(float)
    return found


def position_means(
    plays: pd.DataFrame, positions: Mapping[str, str], seasons: Sequence[int]
) -> dict[tuple[str, str], dict[str, float]]:
    """The fit rows' mean of each `x_<sub>` per opportunity, by position and kind (2.10's default for a
    player with no opportunity of the kind yet this season)."""
    kept = plays[plays["season"].isin(seasons)]
    position = kept["player_id"].map(positions)
    found: dict[tuple[str, str], dict[str, float]] = {}
    for (pos, kind), group in kept.groupby([position, kept["kind"]]):
        subs = SUBMODELS.get(str(kind), {})
        found[(str(pos), str(kind))] = {s: float(group[f"x_{s}"].mean()) for s in subs}
    return found
