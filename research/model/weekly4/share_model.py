"""THE SHARE MODELS (preregistration section 2.2) AND THE IDENTITIES THAT MAKE SHARES ADD UP (2.6).

Expected shares of the club's volume, per position: target share of team targets, carry share of
designed rushes, air-yards share, red-zone opportunity share (red-zone targets plus carries),
inside-the-ten share, and for quarterbacks the dropback share and the designed-rush share
(`SHARE_KINDS`). Each a boosted model with squared error weighted by the club's volume of the kind,
on the fit seasons' rows of players with a line that week (2.6), its target the realised share of the
week, read from the week's plays. The family chooses one cell of the 64 (the grid and the decay)
together, the decay then serving the xFP mean and FPOE (2.3); its fold loss is the sum over its models
of each model's volume-weighted mean squared error, so no kind's units outweigh another's.

The inputs (2.2): his season-to-date share of each kind, his last-three share, his decayed share at the
cell's decay, his prior-season share and its no-prior indicator, snap share season to date and over the
last three and its trend, his depth chart rank, the vacated and returning shares, the rate m, and the
matchup and game terms (2.4, 2.5).

The identities, for each club-game and kind: the projected players' shares plus a residual share r_k
sum to 1. r_k is the club's share of the kind that went, over its games of weeks before W this season,
to players outside the club's rows, shrunk toward the fit seasons' mean residual share with 6 games of
prior. A projected player's share is his model share times (1 - r_k) over the projected players' model
shares; a withheld player is not projected, so his share passes to his teammates and the residual.
"""

import time
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from types import MappingProxyType
from typing import Final

import numpy as np
import pandas as pd

from research.model.weekly3.allowance import ALLOWANCE_PRIOR_GAMES
from research.model.weekly4.features.columns import decay_label
from research.model.weekly4.features.plays import INSIDE_TEN_YARDS, RED_ZONE_YARDS
from research.model.weekly4.features.plays import SHARE_KINDS as ALL_KINDS
from research.model.weekly4.matrix import design
from research.model.weekly4.tuning import SHARE_GRID, Cell, Fitted, FoldCache, Seasoned, predict

FROZEN: Final = MappingProxyType
RECEIVING: Final = ("targets", "carries", "air_yards", "red_zone", "inside_ten")
SHARE_KINDS: Final = FROZEN({"QB": ("dropbacks", "carries"), "RB": RECEIVING, "WR": RECEIVING, "TE": RECEIVING})
RESIDUAL_PRIOR_GAMES: Final = (
    ALLOWANCE_PRIOR_GAMES  # 2.6: "shrunk toward the fit seasons' mean ... with 6 games of prior"
)
_COMMON: Final = (
    *(f"share_season_{k}" for k in ALL_KINDS),
    "default_no_prior_season",
    "snap_season",
    "snap_last_three",
    "snap_trend",
    "depth_rank",
    "default_no_depth_row",
    "returning_teammates",
    "vacating_teammates",
    "rate_m",
    "games_played",
    "default_no_game_this_season",
    "target_depth_behind",
    "target_depth_short",
    "target_depth_intermediate",
    "target_depth_deep",
    "target_outside",
    "target_middle",
    "air_yards_per_target",
    "allowance_targets",
    "allowance_carries",
    "allowance_red_zone",
    "allowance_pass_attempts",
    "allowance_rb_air_share",
    "allowance_depth_behind",
    "allowance_depth_short",
    "allowance_depth_intermediate",
    "allowance_depth_deep",
    "allowance_outside",
    "allowance_middle",
    "opponent_pass_rate_allowed",
    "opponent_sack_rate",
    "opponent_hit_rate",
    "opponent_pfr_pressure_rate",
    "implied_points",
    "opponent_implied_points",
    "spread",
    "home",
    "rest_days",
    "division_game",
    "roof",
    "indoor",
    "temperature_f",
    "wind_mph",
    "precipitation",
    "own_pace",
    "own_pass_rate_over_expected",
)


def share_features(kind: str, decay: float) -> tuple[str, ...]:
    """The share model's inputs for `kind` at the cell's decay."""
    own = (
        f"share_last_three_{kind}",
        f"share_{decay_label(decay)}_{kind}",
        f"share_prior_{kind}",
        f"vacated_{kind}",
        f"returning_{kind}",
    )
    return (*own, *_COMMON)


def week_counts(plays: pd.DataFrame) -> pd.DataFrame:
    """Each player's opportunities of every kind in each game, by (season, week, club), from the plays."""
    kind = plays["kind"].to_numpy()
    yard = plays["yardline_100"].to_numpy(dtype=float, na_value=np.nan)
    opportunity = (kind == "target") | (kind == "carry")
    counts = pd.DataFrame(
        {
            "season": plays["season"].to_numpy(),
            "week": plays["week"].to_numpy(),
            "club": plays["posteam"].to_numpy(),
            "player_id": plays["player_id"].to_numpy(),
            "targets": (kind == "target").astype(float),
            "carries": (kind == "carry").astype(float),
            "air_yards": np.where(kind == "target", plays["air_yards"].fillna(0.0).to_numpy(dtype=float), 0.0),
            "red_zone": (opportunity & (yard <= RED_ZONE_YARDS)).astype(float),
            "inside_ten": (opportunity & (yard <= INSIDE_TEN_YARDS)).astype(float),
            "dropbacks": (kind == "dropback").astype(float),
        }
    )
    counts = counts[counts["player_id"].notna()]
    return counts.groupby(["season", "week", "club", "player_id"], as_index=False)[list(ALL_KINDS)].sum()


def realised_shares(rows: pd.DataFrame, counts: pd.DataFrame) -> pd.DataFrame:
    """Each row's realised share of every kind in its week (`y_<kind>`) and the club's volume
    (`w_<kind>`), from the week's counts."""
    club = counts.groupby(["season", "week", "club"], as_index=False)[list(ALL_KINDS)].sum()
    keys = rows[["season", "week", "club", "player_id"]]
    own = keys.merge(counts, on=["season", "week", "club", "player_id"], how="left").fillna(0.0)
    total = keys.merge(club, on=["season", "week", "club"], how="left").fillna(0.0)
    found = pd.DataFrame(index=rows.index)
    for kind in ALL_KINDS:
        volume = total[kind].to_numpy(dtype=float)
        found[f"w_{kind}"] = volume
        found[f"y_{kind}"] = np.where(volume > 0, own[kind].to_numpy(dtype=float) / np.maximum(volume, 1e-9), 0.0)
    return found


@dataclass(frozen=True, slots=True)
class ShareModel:
    trained_on: tuple[int, ...]
    cell: Cell
    models: Mapping[tuple[str, str], Fitted]  # (position, kind)


@dataclass(frozen=True, slots=True)
class ShareFit:
    models: Mapping[tuple[int, ...], ShareModel]  # refit seasons -> the refit
    losses: Mapping[tuple[int, ...], Mapping[str, float]]
    seconds: float


def _seasoned(rows: pd.DataFrame, position: str, kind: str, decay: float) -> Seasoned:
    mine = rows[(rows["position"] == position) & (rows[f"w_{kind}"] > 0)]
    x, categorical = design(mine, share_features(kind, decay))
    weight = mine[f"w_{kind}"].to_numpy(dtype=float)
    return Seasoned(
        x,
        mine[f"y_{kind}"].to_numpy(dtype=float),
        mine["season"].to_numpy(),
        "squared_error",
        categorical,
        None,
        weight,
    )


def fit_share_models(
    rows: pd.DataFrame, refits: Sequence[tuple[int, ...]], grid: Sequence[Cell] = SHARE_GRID
) -> ShareFit:
    """Each refit's family cell chosen inside its seasons (a one-season refit takes the cell of the
    next refit, 2.6's one exception), then every model fitted on the refit's rows."""
    started = time.monotonic()
    decays = sorted({c.decay for c in grid if c.decay is not None})
    data = {
        (position, kind, decay): _seasoned(rows, position, kind, decay)
        for position, kinds in SHARE_KINDS.items()
        for kind in kinds
        for decay in decays
    }

    def family_loss(cell: Cell, season: int) -> float:
        total = 0.0
        for (_, _, decay), seasoned in data.items():
            if decay != cell.decay:
                continue
            test = seasoned.seasons == season
            weight = seasoned.weight[test] if seasoned.weight is not None else np.ones(int(test.sum()))
            if weight.sum() > 0:
                total += seasoned.fold_loss(cell, season) / float(weight.sum())
        return total

    cache = FoldCache(family_loss)
    chosen: dict[tuple[int, ...], Cell] = {}
    for seasons in sorted(refits, key=len, reverse=True):
        if len(seasons) > 1:
            chosen[seasons] = cache.choose(seasons, grid)
        else:
            longer = [r for r in chosen if r[: len(seasons)] == seasons]
            if not longer:
                raise ValueError(f"a one-season refit {seasons} needs its next refit's cell")
            chosen[seasons] = chosen[min(longer, key=len)]
    models: dict[tuple[int, ...], ShareModel] = {}
    for seasons, cell in chosen.items():
        fitted: dict[tuple[str, str], Fitted] = {}
        for (position, kind, decay), seasoned in data.items():
            if decay == cell.decay:
                fitted[(position, kind)] = seasoned.fit_on(cell, np.isin(seasoned.seasons, seasons))
        models[seasons] = ShareModel(seasons, cell, FROZEN(fitted))
    losses = {seasons: FROZEN(cache.losses(seasons, grid)) for seasons in chosen if len(seasons) > 1}
    return ShareFit(FROZEN(models), FROZEN(losses), time.monotonic() - started)


def predict_shares(rows: pd.DataFrame, model: ShareModel) -> pd.DataFrame:
    """Each row's model share of every kind (`model_<kind>`), clipped to [0, 1]; a kind its position
    has no model of is 0."""
    decay = model.cell.decay if model.cell.decay is not None else 1.0
    found = pd.DataFrame(0.0, index=rows.index, columns=[f"model_{k}" for k in ALL_KINDS])
    for (position, kind), fitted in model.models.items():
        mine = rows["position"] == position
        if not mine.any():
            continue
        x, _ = design(rows[mine], share_features(kind, decay))
        found.loc[mine, f"model_{kind}"] = np.clip(predict(fitted, "squared_error", x), 0.0, 1.0)
    return found


def residual_shares(
    rows: pd.DataFrame, counts: pd.DataFrame, fit_mean: Mapping[str, float], kinds: Sequence[str] = ALL_KINDS
) -> pd.DataFrame:
    """Each row's club's residual share of every kind (`residual_<kind>`): over the club's games of
    weeks before W this season, the share that went to players outside the club's rows at W, shrunk
    toward the fit mean with 6 games of prior."""
    found = pd.DataFrame(index=rows.index)
    keys = rows[["season", "week", "club"]].drop_duplicates()
    members = rows.groupby(["season", "week", "club"])["player_id"].agg(frozenset)
    values: dict[tuple[int, int, str], dict[str, float]] = {}
    for season, week, club in zip(keys["season"], keys["week"], keys["club"], strict=True):
        history = counts[(counts["season"] == season) & (counts["week"] < week) & (counts["club"] == club)]
        games = int(history["week"].nunique())
        inside = history["player_id"].isin(members[(season, week, club)])
        out: dict[str, float] = {}
        for kind in kinds:
            total = float(history[kind].sum())
            observed = 1.0 - float(history.loc[inside, kind].sum()) / total if total > 0 else 0.0
            counted = games if total > 0 else 0
            out[kind] = (counted * observed + RESIDUAL_PRIOR_GAMES * fit_mean[kind]) / (counted + RESIDUAL_PRIOR_GAMES)
        values[(int(season), int(week), str(club))] = out
    index = list(zip(rows["season"], rows["week"], rows["club"], strict=True))
    for kind in kinds:
        found[f"residual_{kind}"] = [values[(int(s), int(w), str(c))][kind] for s, w, c in index]
    return found


def fit_residual_means(rows: pd.DataFrame, counts: pd.DataFrame, kinds: Sequence[str] = ALL_KINDS) -> dict[str, float]:
    """The fit seasons' mean residual share of each kind: per club-week, the week's share that went to
    players outside the club's rows, averaged over the club-weeks with any volume of the kind."""
    club = counts.groupby(["season", "week", "club"], as_index=False)[list(kinds)].sum()
    member = counts.merge(rows[["season", "week", "club", "player_id"]].drop_duplicates(), how="inner")
    inside = member.groupby(["season", "week", "club"], as_index=False)[list(kinds)].sum()
    weeks = rows[["season", "week", "club"]].drop_duplicates()
    joined = weeks.merge(club, how="inner").merge(
        inside, on=["season", "week", "club"], how="left", suffixes=("", "_in")
    )
    found: dict[str, float] = {}
    for kind in kinds:
        total = joined[kind].to_numpy(dtype=float)
        kept = total > 0
        share = 1.0 - joined[f"{kind}_in"].fillna(0.0).to_numpy(dtype=float)[kept] / total[kept]
        found[kind] = float(np.mean(share)) if kept.any() else 0.0
    return found


def normalised_shares(rows: pd.DataFrame, kinds: Sequence[str] = ALL_KINDS) -> pd.DataFrame:
    """The identities: per club-game and kind, the projected (not withheld) players' shares are their
    model shares times (1 - r) over their sum; a withheld player's is 0."""
    found = pd.DataFrame(index=rows.index)
    projected = rows["withheld"].to_numpy() == 0
    group = [rows["season"], rows["week"], rows["club"]]
    for kind in kinds:
        model = np.where(projected, rows[f"model_{kind}"].to_numpy(dtype=float), 0.0)
        total = pd.Series(model, index=rows.index).groupby(group).transform("sum").to_numpy()
        residual = rows[f"residual_{kind}"].to_numpy(dtype=float)
        found[f"share_{kind}"] = np.where(total > 0, model * (1.0 - residual) / np.maximum(total, 1e-12), 0.0)
    return found
