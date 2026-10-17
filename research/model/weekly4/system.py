"""THE SYSTEM, FITTED (preregistration section 2.6): every component in the tuning order, forward-chained
by season, and the simulation's constants on the fit rows.

For a round's constant t (the development check or the judgment): the play model priced for every
season from the season before the first player fit season through the judged one, each by the model
fitted on the seasons before it; the team model for the dispersion seasons (the player fit seasons
after the first) and the judged season, each fitted on the seasons before it; the share models refitted
on the player fit seasons before each of those seasons (a one-season refit taking its next refit's
cell); the efficiency, the 2.10 position means, the residual means and the target rate on the player
fit seasons; then the simulation's dispersions on the dispersion seasons' rows (2022 for the check,
2022 and 2023 for the judgment), the yardage scale on the grid by simulating those rows.

The store's files are read once; every play row and team row is used only where 2.6's table allows (a
fit's targets from the seasons before the rows it serves, inputs from weeks before W).
"""

import time
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any, Final

import numpy as np
import pandas as pd

from research.model.weekly4.board import RoundShared, SeasonData, SeasonModels, build_board, season_allowances
from research.model.weekly4.dispersion import (
    SCALE_GRID,
    choose_scale,
    fit_concentration,
    fit_margin,
    fit_plays,
    fit_script,
    fit_yards_sd,
)
from research.model.weekly4.efficiency import Efficiency, RolePrior, fit_efficiency, fit_role_prior
from research.model.weekly4.features.charted import CHARTED_FEATURES
from research.model.weekly4.gates import RoundFour
from research.model.weekly4.history import position_means, with_outcomes
from research.model.weekly4.play_model import FORMAT_NAMES, PlayFit, fit_play_models, price
from research.model.weekly4.point import Constants
from research.model.weekly4.share_model import (
    ShareFit,
    fit_residual_means,
    fit_share_models,
    realised_shares,
    week_counts,
)
from research.model.weekly4.simulate import Dispersion, Simulated, simulate_game
from research.model.weekly4.team_model import TeamFit, fit_team_models, predict_team
from research.model.weekly4.tuning import Cell
from research.model.weekly4.value_allowance import game_values

PROJECTED_KINDS: Final = ("targets", "carries", "dropbacks")
_KIND_OF: Final = {"targets": "target", "carries": "carry", "dropbacks": "dropback"}


@dataclass(frozen=True, slots=True)
class Store:
    """The feature store's rows for the round's seasons, as read from its files."""

    players: pd.DataFrame
    teams: pd.DataFrame
    plays: pd.DataFrame
    digests: Mapping[str, str]


@dataclass(frozen=True, slots=True)
class Extras:
    """What round 3's reads give each player-week: the rate m, and every week's lines."""

    rates: pd.DataFrame  # season, week, player_id, rate_m_<format>
    lines: pd.DataFrame  # season, week, player_id, club, <format>
    margins: pd.DataFrame  # season, week, club, margin: the dispersion seasons' realised margins


@dataclass(slots=True)
class Fitted:
    play: PlayFit
    team: TeamFit
    shares: ShareFit
    shared: RoundShared
    models: Mapping[int, SeasonModels]
    data: Mapping[int, SeasonData]
    dispersion: Dispersion
    weighted_efficiency: Efficiency  # a reported view (3.2), never the number
    seconds: dict[str, float]
    served: dict[str, tuple[int, ...]]
    reported: dict[str, Any] = field(default_factory=dict)


def dispersion_seasons(t: RoundFour) -> tuple[int, ...]:
    return t.player_fit_seasons[1:]


def row_seasons(t: RoundFour) -> tuple[int, ...]:
    return (*dispersion_seasons(t), t.judgment_season)


def share_refit(t: RoundFour, season: int) -> tuple[int, ...]:
    """2.6's table: the share models a season's rows read, fitted on the player fit seasons before it."""
    return tuple(s for s in t.player_fit_seasons if s < season)


def positions_of(store: Store) -> dict[str, str]:
    found = store.players.drop_duplicates("player_id").set_index("player_id")["position"]
    return {str(k): str(v) for k, v in found.items()}


def _player_rows(store: Store, extras: Extras, seasons: Sequence[int]) -> pd.DataFrame:
    rows = store.players[store.players["season"].isin(seasons)]
    rows = rows.merge(extras.rates, on=["season", "week", "player_id"], how="left")
    lined = extras.lines[["season", "week", "player_id"]].drop_duplicates().assign(lined=1)
    rows = rows.merge(lined, on=["season", "week", "player_id"], how="left")
    candidate = rows["candidate"].fillna(0).astype(int)
    projected = ((rows["withheld"] == 0) & (candidate == 1)).astype(int)
    return rows.assign(lined=rows["lined"].fillna(0).astype(int), candidate=candidate, projected=projected).reset_index(
        drop=True
    )


def _price_seasons(plays: pd.DataFrame, fitted: PlayFit) -> pd.DataFrame:
    parts = [price(plays[plays["season"] == s], model) for s, model in fitted.models.items()]
    return with_outcomes(pd.concat(parts)).reset_index(drop=True)


def _week_outcomes(priced: pd.DataFrame) -> pd.DataFrame:
    """Per (season, week, player, kind): the week's opportunities and yards over expected (the role
    prior's target)."""
    return priced.groupby(["season", "week", "player_id", "kind"], as_index=False)[["h_n", "h_yards_over"]].sum()


def _role_priors(fit_rows: pd.DataFrame, priced: pd.DataFrame) -> dict[str, RolePrior]:
    outcomes = _week_outcomes(priced)
    found: dict[str, RolePrior] = {}
    for kind in ("target", "carry", "dropback"):
        mine = outcomes[outcomes["kind"] == kind]
        joined = fit_rows[["season", "week", "player_id"]].merge(mine, on=["season", "week", "player_id"], how="left")
        outcome = pd.DataFrame(
            {"n": joined["h_n"].fillna(0.0).to_numpy(), "yards_over": joined["h_yards_over"].fillna(0.0).to_numpy()}
        )
        found[kind] = fit_role_prior(fit_rows.reset_index(drop=True), outcome, CHARTED_FEATURES)
    return found


def _target_rate(priced: pd.DataFrame, seasons: Sequence[int]) -> float:
    mine = priced[priced["season"].isin(seasons)]
    drops = mine[mine["kind"] == "dropback"]
    attempts = float((drops["h_not_sacked"] - drops["h_scrambles"]).sum())
    return float((mine["kind"] == "target").sum()) / attempts


def _constants(model_season: int, play: PlayFit, priced: pd.DataFrame, seasons: Sequence[int]) -> Constants:
    fit = priced[priced["season"].isin(seasons)]
    model = play.models[model_season]
    return Constants(
        model.scramble_yards,
        model.scramble_touchdowns,
        float(fit.loc[fit["kind"] == "target", "x_td"].mean()),
        float(fit.loc[fit["kind"] == "carry", "x_td"].mean()),
    )


def _season_data(  # noqa: PLR0913, PLR0917 - one season's inputs, named
    season: int,
    rows: pd.DataFrame,
    store: Store,
    priced: pd.DataFrame,
    counts: pd.DataFrame,
    positions: Mapping[str, str],
) -> SeasonData:
    teams = store.teams[store.teams["season"] == season].reset_index(drop=True)
    mine = rows[rows["season"] == season].reset_index(drop=True)
    plays = priced[priced["season"].isin((season - 1, season))].reset_index(drop=True)
    values = game_values(plays[plays["season"] == season], positions)
    weeks = tuple(sorted(int(w) for w in mine["week"].unique()))
    allowances = season_allowances(values, teams, season, weeks)
    return SeasonData(season, mine, teams, plays, counts[counts["season"] == season], allowances)


@dataclass(frozen=True, slots=True)
class FixedCells:
    """The cells a refit uses with no selection (section 4, the served refit: the judged fit's)."""

    play: Mapping[str, Cell]
    team: Mapping[str, Cell]
    shares: Cell


def fit_system(store: Store, extras: Extras, t: RoundFour, fixed: FixedCells | None = None) -> Fitted:
    clock: dict[str, float] = {}
    started = time.monotonic()
    positions = positions_of(store)
    pricing = tuple(range(min(t.player_fit_seasons) - 1, t.judgment_season + 1))
    play = fit_play_models(
        store.plays[store.plays["season"] <= t.judgment_season],
        pricing,
        fixed=None if fixed is None else fixed.play,
    )
    priced = _price_seasons(store.plays, play)
    clock["play_model"] = time.monotonic() - started
    mark = time.monotonic()
    team = fit_team_models(
        store.teams[store.teams["season"] <= t.judgment_season],
        row_seasons(t),
        fixed=None if fixed is None else fixed.team,
    )
    clock["team_model"] = time.monotonic() - mark
    mark = time.monotonic()
    rows = _player_rows(store, extras, (*t.player_fit_seasons, t.judgment_season))
    counts = week_counts(store.plays[store.plays["season"].isin(rows["season"].unique())])
    fit_rows = rows[rows["season"].isin(t.player_fit_seasons) & rows["week"].isin(t.fit_weeks) & (rows["lined"] == 1)]
    fit_rows = fit_rows.join(realised_shares(fit_rows, counts))
    shares = fit_share_models(
        fit_rows,
        sorted({share_refit(t, s) for s in row_seasons(t)}),
        fixed=None if fixed is None else fixed.shares,
    )
    clock["share_models"] = time.monotonic() - mark
    mark = time.monotonic()
    fit_plays_ = priced[priced["season"].isin(t.player_fit_seasons)]
    role_priors = _role_priors(fit_rows, priced)
    efficiency = fit_efficiency(fit_plays_, positions, role_priors)
    weighted = fit_efficiency(fit_plays_, positions, role_priors, weighted=True)
    shared = RoundShared(
        efficiency,
        position_means(priced, positions, t.player_fit_seasons),
        fit_residual_means(fit_rows, counts[counts["season"].isin(t.player_fit_seasons)]),
        _target_rate(priced, t.player_fit_seasons),
    )
    models = {
        s: SeasonModels(
            s,
            play.models[s],
            team.models[s],
            shares.models[share_refit(t, s)],
            _constants(s, play, priced, t.player_fit_seasons),
        )
        for s in row_seasons(t)
    }
    # A season with no rows (the served refit's next season) has models and no data.
    data = {
        s: _season_data(s, rows, store, priced, counts, positions)
        for s in row_seasons(t)
        if (rows["season"] == s).any()
    }
    clock["efficiency_and_inputs"] = time.monotonic() - mark
    mark = time.monotonic()
    dispersion, reported = fit_dispersion(t, models, data, shared, extras, priced)
    clock["dispersion"] = time.monotonic() - mark
    served = {
        "plays and teams": tuple(
            sorted(
                {s for m in play.models.values() for s in m.trained_on}
                | {s for m in team.models.values() for s in m.trained_on}
            )
        ),
        "players": tuple(sorted(set(fit_rows["season"].unique()) | set(extras.margins["season"].unique()))),
    }
    reported["efficiency_cells_pooled_fully"] = efficiency.pooled_fully
    return Fitted(play, team, shares, shared, models, data, dispersion, weighted, clock, served, reported)


def _boards(
    t: RoundFour, models: Mapping[int, SeasonModels], data: Mapping[int, SeasonData], shared: RoundShared
) -> pd.DataFrame:
    return pd.concat([build_board(data[s], models[s], shared) for s in dispersion_seasons(t)], ignore_index=True)


def _concentration_rows(boards: pd.DataFrame, data: Mapping[int, SeasonData]) -> dict[str, pd.DataFrame]:
    """Per kind, each projected player with a line: his realised count, his club's realised volume and
    his normalised share."""
    counts = pd.concat([d.counts for d in data.values()])
    realised = counts.rename(columns={k: f"realised_{k}" for k in PROJECTED_KINDS})
    volume = counts.groupby(["season", "week", "club"], as_index=False)[list(PROJECTED_KINDS)].sum()
    volume = volume.rename(columns={k: f"volume_{k}" for k in PROJECTED_KINDS})
    keyed = boards[(boards["lined"] == 1) & (boards["projected"] == 1)]
    joined = keyed.merge(realised, on=["season", "week", "club", "player_id"], how="left")
    joined = joined.merge(volume, on=["season", "week", "club"], how="left")
    return {
        kind: pd.DataFrame(
            {
                "position": joined["position"].to_numpy(),
                "count": joined[f"realised_{kind}"].fillna(0.0).to_numpy(),
                "volume": joined[f"volume_{kind}"].fillna(0.0).to_numpy(),
                "share": joined[f"share_{kind}"].to_numpy(),
            }
        )
        for kind in PROJECTED_KINDS
    }


def fit_dispersion(  # noqa: PLR0913, PLR0917 - the dispersion fit's inputs, named
    t: RoundFour,
    models: Mapping[int, SeasonModels],
    data: Mapping[int, SeasonData],
    shared: RoundShared,
    extras: Extras,
    priced: pd.DataFrame,
) -> tuple[Dispersion, dict[str, Any]]:
    """The simulation's constants on the dispersion seasons' rows."""
    seasons = dispersion_seasons(t)
    boards = _boards(t, models, data, shared)
    teams = pd.concat([data[s].teams.join(build_team_expectations(data[s], models[s])) for s in seasons])
    teams = teams.merge(extras.margins, on=["season", "week", "club"], how="inner")
    plays_size, plays_sd = fit_plays(teams["plays"].to_numpy(dtype=float), teams["exp_plays"].to_numpy(dtype=float))
    concentration: dict[tuple[str, str], float] = {}
    for kind, rows in _concentration_rows(boards, data).items():
        for position, alpha in fit_concentration(rows).items():
            concentration[(position, kind)] = alpha
    fit_plays_ = priced[priced["season"].isin(seasons)]
    yards = fit_yards_sd(
        {
            k: fit_plays_.loc[fit_plays_["kind"] == k, "h_yards_over"].to_numpy(dtype=float)
            for k in ("target", "carry", "dropback")
        }
    )
    base = Dispersion(fit_margin(teams), fit_script(teams), plays_size, plays_sd, concentration, yards, {})
    scale, shares = fit_scale(boards, base, models, extras, t)
    reported = {"scale_grid_shares": shares}
    return Dispersion(base.margin_sd, base.script_slope, plays_size, plays_sd, concentration, yards, scale), reported


def build_team_expectations(data: SeasonData, models: SeasonModels) -> pd.DataFrame:
    return predict_team(data.teams, models.team)


def simulate_board(
    board: pd.DataFrame, dispersion: Dispersion, constants: Mapping[int, Constants], run_seed: int, draws: int
) -> list[tuple[pd.DataFrame, Simulated]]:
    """Every game of the board simulated, with its rows."""
    found = []
    for (season, _week, _game), game in board.groupby(["season", "week", "game_id"], sort=True):
        found.append((game, simulate_game(game, dispersion, constants[int(str(season))], run_seed, draws)))
    return found


def scored_rows(game: pd.DataFrame, simulated: Simulated) -> list[int]:
    """The simulated players with a line, a number, and a game this season (a player on the rate m takes
    2.10's range, not his draws)."""
    by = game.set_index("player_id")
    lined = by["lined"].to_dict()
    point = by["point_ppr"].to_dict()
    rate_only = by["default_no_game_this_season"].to_dict()
    return [
        i
        for i, pid in enumerate(simulated.players)
        if lined.get(pid) == 1 and np.isfinite(float(point.get(pid, np.nan))) and rate_only.get(pid) == 0
    ]


def fit_scale(
    boards: pd.DataFrame, base: Dispersion, models: Mapping[int, SeasonModels], extras: Extras, t: RoundFour
) -> tuple[dict[str, float], dict[str, Any]]:
    """Per position, the grid's scale minimising the floor and ceiling misses over the formats, on the
    fit rows with a line and a number."""
    actual = extras.lines.set_index(["season", "week", "player_id"])[list(FORMAT_NAMES)].to_dict("index")
    tallies: dict[tuple[str, float, str], np.ndarray] = {}
    constants = {s: m.constants for s, m in models.items()}
    for game, simulated in simulate_board(boards, base, constants, t.run_seed, t.draws):
        keep = scored_rows(game, simulated)
        if not keep:
            continue
        season, week = int(game["season"].iloc[0]), int(game["week"].iloc[0])
        rows = np.array(keep)
        positions = [simulated.positions[i] for i in keep]
        for name in FORMAT_NAMES:
            outcome = np.array([actual[(season, week, simulated.players[i])][name] for i in keep])
            for scale in SCALE_GRID:
                values = simulated.base[name][rows] + scale * simulated.noise[rows]
                floor, ceiling = np.percentile(values, (10.0, 90.0), axis=1)
                for position, below, above in zip(positions, outcome < floor, outcome > ceiling, strict=True):
                    tally = tallies.setdefault((position, scale, name), np.zeros(3))
                    tally += (below, above, 1.0)
    found: dict[str, float] = {}
    record: dict[str, Any] = {}
    for position in sorted({k[0] for k in tallies}):

        def shares(scale: float, position: str = position) -> list[tuple[float, float]]:
            out = []
            for name in FORMAT_NAMES:
                below, above, n = tallies.get((position, scale, name), np.zeros(3))
                out.append((float(below / n), float(above / n)) if n else (0.0, 0.0))
            return out

        found[position] = choose_scale(shares)
        record[position] = {str(s): shares(s) for s in SCALE_GRID}
    return found, record
