"""ONE SEASON'S BOARD: every player row with every fitted component applied, and its point.

Steps 1 to 5 of preregistration section 2.1 on one season's rows, read at each game's instant: the
team model's volumes for the club-game (2.5), the share models and the identities (2.2, 2.6), the
history, the week's re-priced value and the shrunk efficiency (2.3), the value allowance (2.4), then
the point with the touchdown reconciliation (`point.py`). Every model is the one the season's rows read
under the forward-chained table of 2.6 (`SeasonModels`); the fit seasons' constants are `RoundShared`.

A `Variant` neutralises named groups (2.7) or applies a reported ablation (3.2, "Reported, not gated")
to the inputs and rebuilds everything downstream, so the attributions, the ablations and the number
share one code path. Home field's neutral is the mean of the point at home 0 and at home 1.
"""

from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from typing import Final

import numpy as np
import pandas as pd

from research.model.weekly4.efficiency import Efficiency, apply_efficiency
from research.model.weekly4.features.charted import CHARTED_FEATURES
from research.model.weekly4.features.plays import SHARE_KINDS as ALL_KINDS
from research.model.weekly4.groups import GAME_GROUPS, league_means, neutral_efficiency, neutralise
from research.model.weekly4.history import decayed_history, repriced
from research.model.weekly4.play_model import FORMAT_NAMES, PlayModel, price
from research.model.weekly4.point import Constants, analytic_points
from research.model.weekly4.share_model import ShareModel, normalised_shares, predict_shares, residual_shares
from research.model.weekly4.team_model import TeamModel, predict_team
from research.model.weekly4.value_allowance import row_allowances, value_allowances

GAME_KEY: Final = ["season", "week", "club"]
POINT_KINDS: Final = ("targets", "carries", "dropbacks")


@dataclass(frozen=True, slots=True)
class SeasonModels:
    """The models a season's rows read (2.6's table): the play model fitted before the season, the team
    model fitted before it, the share refit on the player fit seasons before it."""

    season: int
    play: PlayModel
    team: TeamModel
    shares: ShareModel
    constants: Constants

    @property
    def decay(self) -> float:
        return self.shares.cell.decay if self.shares.cell.decay is not None else 1.0


@dataclass(frozen=True, slots=True)
class RoundShared:
    """Fitted once on the fit seasons: the efficiency, the 2.10 position means per opportunity, the mean
    residual shares, and the mean share of attempts with a target (a club with no game yet)."""

    efficiency: Efficiency
    fallback: Mapping[tuple[str, str], Mapping[str, float]]
    residual_means: Mapping[str, float]
    target_rate: float


@dataclass(frozen=True, slots=True)
class Variant:
    """What the board neutralises (2.7's groups) and which reported ablation it applies (3.2)."""

    groups: frozenset[str] = frozenset()
    reconcile: bool = True
    hide_figure: bool = False
    no_charted: bool = False
    normalise: bool = True  # False: a reported view only, the model shares without the identities
    transform: Callable[[pd.DataFrame], pd.DataFrame] | None = None  # a game-level change (the weather views)


THE_NUMBER: Final = Variant()  # nothing neutralised: the number itself


@dataclass(slots=True)
class SeasonData:
    """One season's inputs at each instant, and the variant-free parts computed once."""

    season: int
    rows: pd.DataFrame  # the store's player rows with the rate m (`rate_m_<format>`)
    teams: pd.DataFrame  # the store's team rows of the season
    priced: pd.DataFrame  # the plays of the season and the one before, priced (`x_`, `h_` columns)
    counts: pd.DataFrame  # the season's opportunities per player-game (`share_model.week_counts`)
    allowances: pd.DataFrame  # the season's value allowances (`value_allowance.value_allowances`)
    cache: dict[object, pd.DataFrame] = field(default_factory=dict)


def club_target_rates(priced: pd.DataFrame, teams: pd.DataFrame, fallback: float) -> pd.DataFrame:
    """Each club-game's season-to-date share of pass attempts with a targeted receiver (weeks before W)."""
    plays = priced[priced["season"].isin(teams["season"].unique())]
    targets = plays[plays["kind"] == "target"].groupby(["season", "week", "posteam"]).size()
    drops = plays[plays["kind"] == "dropback"]
    attempts = (
        (drops["h_not_sacked"] - drops["h_scrambles"]).groupby([drops["season"], drops["week"], drops["posteam"]]).sum()
    )
    weekly = pd.DataFrame({"targets": targets, "attempts": attempts}).fillna(0.0).reset_index()
    weekly.columns = ["season", "week", "club", "targets", "attempts"]
    keys = teams[GAME_KEY].drop_duplicates()
    joined = keys.merge(weekly.rename(columns={"week": "played"}), on=["season", "club"], how="left")
    joined = joined[joined["played"] < joined["week"]]
    sums = joined.groupby(GAME_KEY)[["targets", "attempts"]].sum()
    found = keys.merge(sums.reset_index(), on=GAME_KEY, how="left")
    rate = np.where(
        found["attempts"].fillna(0.0) > 0, found["targets"] / found["attempts"].where(found["attempts"] > 0), fallback
    )
    return found[GAME_KEY].assign(target_rate=np.asarray(rate, dtype=float))


def _raw_shares(board: pd.DataFrame) -> pd.DataFrame:
    """The projected players' model shares as they are, the identities not applied (a reported view)."""
    projected = board["projected"].to_numpy() == 1
    return pd.DataFrame(
        {f"share_{k}": np.where(projected, board[f"model_{k}"].to_numpy(dtype=float), 0.0) for k in ALL_KINDS},
        index=board.index,
    )


def _game_level(frame: pd.DataFrame, variant: Variant, home: float | None) -> pd.DataFrame:
    """The game-level groups and ablations, week by week (each week's own cross-section)."""
    groups = (set(variant.groups) & GAME_GROUPS) - {"game"}  # the game group: `_with_game_neutral`
    found = frame
    if variant.hide_figure:
        found = found.assign(
            implied_points=np.nan, opponent_implied_points=np.nan, spread=np.nan, default_no_game_figure=1
        )
    if variant.transform is not None:
        found = variant.transform(found)
    if not groups:
        return found
    parts = []
    for _, week in found.groupby(["season", "week"], sort=False):
        means = league_means(week)
        parts.append(neutralise(week, groups, means, home))
    return pd.concat(parts).loc[found.index]


def _player_level(rows: pd.DataFrame, variant: Variant) -> pd.DataFrame:
    found = neutralise(rows, set(variant.groups) & {"role", "teammates"}, {})
    if variant.no_charted:
        found = found.assign(
            **dict.fromkeys(CHARTED_FEATURES, np.nan), **{f"default_no_{n}": 1 for n in CHARTED_FEATURES}
        )
    return found


def _implied_before_w(teams: pd.DataFrame) -> pd.Series:
    """The league's mean implied points over the season's weeks before W (the game group's neutral)."""
    by_week = teams.groupby("week")["implied_points"].agg(["sum", "count"]).sort_index()
    prior = by_week.cumsum().shift(1)
    mean = (prior["sum"] / prior["count"]).fillna(by_week["sum"] / by_week["count"])
    return teams["week"].map(mean)


def _with_game_neutral(frame: pd.DataFrame, teams: pd.DataFrame, variant: Variant) -> pd.DataFrame:
    if "game" not in variant.groups:
        return frame
    implied = frame["week"].map(dict(zip(teams["week"], _implied_before_w(teams), strict=True)))
    return frame.assign(implied_points=implied.to_numpy(), opponent_implied_points=implied.to_numpy(), spread=0.0)


def _history(data: SeasonData, models: SeasonModels) -> pd.DataFrame:
    key = ("history", models.decay)
    if key not in data.cache:
        data.cache[key] = decayed_history(data.rows, data.priced, models.decay)
    return data.cache[key]


def _repriced(
    data: SeasonData, rows: pd.DataFrame, models: SeasonModels, shared: RoundShared, tag: object
) -> pd.DataFrame:
    key = ("repriced", models.decay, tag)
    if key not in data.cache:

        def pricer(plays: pd.DataFrame, season: int) -> pd.DataFrame:
            del season  # the season's rows read the season's play model, `models.play`
            return price(plays, models.play)

        data.cache[key] = repriced(rows, data.priced, models.decay, pricer, shared.fallback)
    return data.cache[key]


def _residuals(data: SeasonData, shared: RoundShared) -> pd.DataFrame:
    key = "residuals"
    if key not in data.cache:
        data.cache[key] = residual_shares(data.rows, data.counts, shared.residual_means, ALL_KINDS)
    return data.cache[key]


def _rates(data: SeasonData, shared: RoundShared) -> pd.DataFrame:
    key = "rates"
    if key not in data.cache:
        data.cache[key] = club_target_rates(data.priced, data.teams, shared.target_rate)
    return data.cache[key]


def build_board(
    data: SeasonData,
    models: SeasonModels,
    shared: RoundShared,
    variant: Variant = THE_NUMBER,
    home: float | None = None,
) -> pd.DataFrame:
    """The season's rows with every component and the point (`point_<format>`) under `variant`."""
    rows = _with_game_neutral(_game_level(_player_level(data.rows, variant), variant, home), data.teams, variant)
    teams = _with_game_neutral(_game_level(data.teams, variant, home), data.teams, variant)
    history = _history(data, models)
    if "efficiency" in variant.groups:
        history = neutral_efficiency(history)
    weather_key = ("weather" in variant.groups, variant.transform)
    prices = _repriced(data, rows, models, shared, weather_key)
    priors = pd.DataFrame(
        {f"role_prior_{kind}": prior.predict(rows) for kind, prior in shared.efficiency.role_priors.items()},
        index=rows.index,
    )
    for kind in ("target", "carry", "dropback"):
        if f"role_prior_{kind}" not in priors:
            priors[f"role_prior_{kind}"] = 0.0
    inputs = rows[["position"]].join(history).join(prices).join(priors)
    efficiency = apply_efficiency(inputs, shared.efficiency)
    allowances = row_allowances(rows, data.allowances)
    if "matchup" in variant.groups:
        allowances = allowances * 0.0
    team = teams[GAME_KEY].join(predict_team(teams, models.team))
    shares = predict_shares(rows, models.shares)
    board = (
        rows.join(history)
        .join(prices)
        .join(efficiency)
        .join(allowances)
        .join(shares)
        .join(_residuals(data, shared))
        .merge(team, on=GAME_KEY, how="left")
        .merge(_rates(data, shared), on=GAME_KEY, how="left")
    )
    board.index = rows.index
    board = board.join(normalised_shares(board, ALL_KINDS) if variant.normalise else _raw_shares(board))
    points = analytic_points(board, models.constants, reconcile=variant.reconcile)
    return board.join(points.drop(columns=["season", "week", "club", "player_id", "position"]))


def board_points(
    data: SeasonData, models: SeasonModels, shared: RoundShared, variant: Variant = THE_NUMBER
) -> pd.DataFrame:
    """The point in each format under `variant`; with home field neutralised, the mean of the point at
    home 0 and at home 1."""
    columns = [f"point_{name}" for name in FORMAT_NAMES]
    if "home_rest" not in variant.groups:
        return build_board(data, models, shared, variant)[columns]
    away = build_board(data, models, shared, variant, home=0.0)[columns]
    home = build_board(data, models, shared, variant, home=1.0)[columns]
    return (away + home) / 2.0


def season_allowances(values: pd.DataFrame, teams: pd.DataFrame, season: int, weeks: tuple[int, ...]) -> pd.DataFrame:
    """The season's value allowances at each of its weeks, from its pairing."""
    pairing = teams[["season", "week", "club", "opponent"]]
    return value_allowances(values, pairing, season, weeks)
