"""THE SYSTEM, FITTED (preregistration 2.11): every component in the tuning order, forward-chained.

For a run's constant t (the development check or the judgment), in 2.11's order: the play model (round
4's, priced for every season from the season before the first player fit season through the judged one,
each by the model fitted on the seasons before it), the team model (round 4's, for every player fit
season and the judged one, each fitted on the seasons before it), the raw share models (round 4's, the
refit on the player fit seasons before each band season and the judged season); then the shrinkage, the
fumble constants (both on the player window, 2.4, 2.5); then the component trees; then the rival. The
residual bands of each candidate are fitted on the band seasons' rows, each scored by the refit on the
player fit seasons before it (2.9).

`candidates` names what the run computes: the check computes both, the judgment only the chosen one
("the other is never computed on 2024", 2.8).
"""

import time
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from types import MappingProxyType
from typing import Any, Final

import numpy as np
import pandas as pd

from research.model.weekly.round.scoring import FORMATS
from research.model.weekly4.play_model import PlayFit, fit_play_models, price
from research.model.weekly4.share_model import ShareFit, fit_share_models, realised_shares, week_counts
from research.model.weekly4.system import Store, positions_of
from research.model.weekly4.team_model import TeamFit, fit_team_models
from research.model.weekly4.tuning import BOOSTED_GRID, SHARE_GRID, Cell
from research.model.weekly5.bands import Bands, fit_bands
from research.model.weekly5.board import (
    COMPONENTS_CANDIDATE,
    RIVAL_CANDIDATE,
    THE_NUMBER,
    SeasonData,
    SeasonModels,
    Shared,
    board,
    inputs,
)
from research.model.weekly5.columns import FEATURE_INPUTS, TREES, VOLUME_INPUTS, anchor_column, anchor_inputs
from research.model.weekly5.games import lined_games, player_games
from research.model.weekly5.gates import RoundFive
from research.model.weekly5.point import fumble_rates
from research.model.weekly5.projected import numbered
from research.model.weekly5.shrinkage import fit_shrinkage, rate_inputs
from research.model.weekly5.trees import TreeFit, TreeSpec, fit_trees, refits_for

FROZEN: Final = MappingProxyType
TARGET_PREFIX: Final = "y_"
REALISED: Final = ("targets", "receptions", "receiving_yards", "carries", "rushing_yards")


@dataclass(frozen=True, slots=True)
class Sources:
    """What round 3's reads give the run (`reads.py`): the rate m and the projected-set candidates, every
    week's lines, the rounds' recent form per row, and the fit window's fumbles lost."""

    rates: pd.DataFrame  # season, week, player_id, rate_m_<format>, candidate
    lines: pd.DataFrame  # season, week, player_id, club, <format>
    forms: pd.DataFrame  # season, week, player_id, form_<format>
    fumbles: pd.DataFrame  # season, week, player_id, fumbles_lost (the player fit seasons)


@dataclass(frozen=True, slots=True)
class Grids:
    """The grids a fit searches: round 4's (the run's), smaller in the tests."""

    boosted: Sequence[Cell] = BOOSTED_GRID
    shares: Sequence[Cell] = SHARE_GRID


@dataclass(slots=True)
class Fitted:
    play: PlayFit
    team: TeamFit
    shares: ShareFit
    shared: Shared
    models: Mapping[int, SeasonModels]
    data: Mapping[int, SeasonData]
    bands: Mapping[str, Bands]
    candidates: tuple[str, ...]
    seconds: dict[str, float]
    served: dict[str, tuple[int, ...]]
    reported: dict[str, Any] = field(default_factory=dict)


def row_seasons(t: RoundFive) -> tuple[int, ...]:
    return (*t.player_fit_seasons, t.judgment_season)


def share_refit(t: RoundFive, season: int) -> tuple[int, ...]:
    return tuple(s for s in t.player_fit_seasons if s < season)


def priced_plays(plays: pd.DataFrame, fitted: PlayFit) -> pd.DataFrame:
    """Each pricing season's plays priced by the play model fitted on the seasons before it."""
    parts = [price(plays[plays["season"] == s], model) for s, model in fitted.models.items()]
    return pd.concat(parts).reset_index(drop=True)


def player_rows(store: Store, sources: Sources, seasons: Sequence[int]) -> pd.DataFrame:
    """The store's player rows of `seasons` with the rate m, `lined`, the forms and the actual points."""
    rows = store.players[store.players["season"].isin(seasons)]
    rows = rows.merge(sources.rates, on=["season", "week", "player_id"], how="left")
    lines = sources.lines.drop_duplicates(["season", "week", "player_id"])
    actual = lines[["season", "week", "player_id", *FORMATS]].rename(columns={n: f"actual_{n}" for n in FORMATS})
    rows = rows.merge(actual.assign(lined=1), on=["season", "week", "player_id"], how="left")
    rows = rows.merge(sources.forms, on=["season", "week", "player_id"], how="left")
    return rows.assign(
        lined=rows["lined"].fillna(0).astype(int), candidate=rows["candidate"].fillna(0).astype(int)
    ).reset_index(drop=True)


def with_targets(rows: pd.DataFrame, lined: pd.DataFrame) -> pd.DataFrame:
    """Each row's realised components in game W (`y_<component>`), 0 with no play."""
    realised = lined[["season", "week", "player_id", *REALISED]].rename(
        columns={c: f"{TARGET_PREFIX}{c}" for c in REALISED}
    )
    found = rows.merge(realised, on=["season", "week", "player_id"], how="left")
    found.index = rows.index
    return found.fillna({f"{TARGET_PREFIX}{c}": 0.0 for c in REALISED})


def tree_specs() -> dict[tuple[str, str], TreeSpec]:
    """2.5's trees with 2.3's inputs: the feature row, the eight volumes, his anchor and the rate m, his
    position's shrunk rates."""
    return {
        (position, component): TreeSpec(
            (*FEATURE_INPUTS, *VOLUME_INPUTS, *anchor_inputs(component), *rate_inputs(position)),
            f"{TARGET_PREFIX}{component}",
            "poisson" if loss == "poisson" else "squared_error",
        )
        for position, trees in TREES.items()
        for component, loss in trees.items()
    }


def rival_specs() -> dict[tuple[str, str], TreeSpec]:
    """2.8: one tree per position and format, its inputs the union of 2.3's over the position's trees."""
    found: dict[tuple[str, str], TreeSpec] = {}
    specs = tree_specs()
    for position in TREES:
        union = tuple(dict.fromkeys(f for (p, _), s in specs.items() if p == position for f in s.features))
        for name in FORMATS:
            found[(position, name)] = TreeSpec(union, f"residual_{name}", "squared_error")
    return found


def _inputs_of(
    fitted_data: Mapping[int, SeasonData], models: Mapping[int, SeasonModels], shared: Shared, t: RoundFive
) -> pd.DataFrame:
    """2.11: the player fit seasons' lined rows of weeks 4 to 17 with their inputs (no projected-set or
    designation filter, reading 26)."""
    parts = []
    for s in t.player_fit_seasons:
        frame = inputs(fitted_data[s], models[s], shared)
        parts.append(frame[frame["week"].isin(t.fit_weeks) & (frame["lined"] == 1)])
    return pd.concat(parts, ignore_index=True)


def _residual_rows(frame: pd.DataFrame) -> pd.DataFrame:
    """The rival's fit rows: a game this season before W and his form, the target points less form."""
    has = (frame["default_no_game_this_season"].fillna(0).to_numpy(dtype=int) == 0) & np.isfinite(
        frame["form_ppr"].to_numpy(dtype=float, na_value=np.nan)
    )
    found = frame[has]
    residual: pd.DataFrame = found.assign(
        **{f"residual_{n}": found[f"actual_{n}"] - found[f"form_{n}"] for n in FORMATS}
    )
    return residual


def band_rows(fitted: "Fitted", candidate: str, t: RoundFive) -> pd.DataFrame:
    """2.9's band-fit rows of the candidate: every lined row of weeks 4 to 17 of the band seasons of a player
    who gets a number, scored by the refit before its season."""
    parts = []
    for s in t.band_seasons:
        scored = board(fitted.data[s], fitted.models[s], fitted.shared, candidate)
        keep = (scored["lined"] == 1) & scored["week"].isin(t.fit_weeks) & numbered(scored)
        mine = scored[keep]
        parts.append(mine.assign(rate_only=mine["default_no_game_this_season"].fillna(0).astype(int) == 1))
    return pd.concat(parts, ignore_index=True)


@dataclass(frozen=True, slots=True)
class Components:
    """Round 4's components, fitted as round 4 fits them: the play model, the team model (2.11's first
    steps, read before the claim: no fit reads the judged season), and later the raw share models."""

    play: PlayFit
    team: TeamFit
    seconds: Mapping[str, float]


def fit_components(store: Store, t: RoundFive, grids: Grids = Grids()) -> Components:  # noqa: B008 - a frozen default
    """The play model for every pricing season (the season before the first player fit season through the
    judged one) and the team model for every player fit season and the judged one, each fitted on the
    seasons before its own; `store` need hold no judged-season row."""
    mark = time.monotonic()
    pricing = tuple(range(min(t.player_fit_seasons) - 1, t.judgment_season + 1))
    play = fit_play_models(store.plays[store.plays["season"] < t.judgment_season], pricing, grids.boosted)
    play_seconds = time.monotonic() - mark
    mark = time.monotonic()
    team = fit_team_models(store.teams[store.teams["season"] < t.judgment_season], row_seasons(t), grids.boosted)
    return Components(play, team, FROZEN({"play_model": play_seconds, "team_model": time.monotonic() - mark}))


def share_fit_rows(store: Store, sources: Sources, t: RoundFive) -> pd.DataFrame:
    """Round 4's share models' fit rows: the player fit seasons' lined rows of weeks 4 to 17 with their
    realised shares."""
    rows = player_rows(store, sources, t.player_fit_seasons)
    rows = rows[rows["week"].isin(t.fit_weeks) & (rows["lined"] == 1)]
    counts = week_counts(store.plays[store.plays["season"].isin(t.player_fit_seasons)])
    return rows.join(realised_shares(rows, counts))


def fit_shares(store: Store, sources: Sources, t: RoundFive, grids: Grids = Grids()) -> ShareFit:  # noqa: B008
    """The raw share models refitted on the player fit seasons before each band season and the judged one."""
    refits = sorted({share_refit(t, s) for s in (*t.band_seasons, t.judgment_season)})
    return fit_share_models(share_fit_rows(store, sources, t), refits, grids.shares)


def fit_rest(  # noqa: PLR0913, PLR0917 - the run's every input, named
    store: Store,
    sources: Sources,
    t: RoundFive,
    components: Components,
    shares: ShareFit,
    candidates: Sequence[str],
    grids: Grids = Grids(),  # noqa: B008 - a frozen default
) -> Fitted:
    """After the claim: the shrinkage and the fumble constants on the player window, the component trees,
    the rival, and each candidate's residual bands; `store` holds the judged season."""
    clock: dict[str, float] = dict(components.seconds)
    mark = time.monotonic()
    positions = positions_of(store)
    seasons = row_seasons(t)
    play, team = components.play, components.team
    priced = priced_plays(store.plays[store.plays["season"].isin(seasons)], play)
    rows = player_rows(store, sources, seasons)
    games = player_games(priced, store.teams, positions)
    lined = lined_games(games, sources.lines[sources.lines["season"].isin(seasons)], positions, sources.fumbles)
    window = lined[lined["season"].isin(t.player_fit_seasons)]
    shrinkage = fit_shrinkage(window, t.player_fit_seasons)
    fumbles = fumble_rates(window, t.player_fit_seasons)
    clock["shrinkage"] = time.monotonic() - mark
    mark = time.monotonic()
    data = {
        s: SeasonData(
            s,
            with_targets(rows[rows["season"] == s].reset_index(drop=True), lined),
            store.teams[store.teams["season"] == s].reset_index(drop=True),
        )
        for s in seasons
    }
    models = {
        s: SeasonModels(
            s,
            team.models[s],
            shares.models.get(share_refit(t, s)),
            share_refit(t, s) if s != t.player_fit_seasons[0] else None,
        )
        for s in seasons
    }
    fit_frame = _inputs_of(data, models, Shared(shrinkage, FROZEN(fumbles), None, None, lined), t)
    specs = tree_specs()
    refits = refits_for(t.player_fit_seasons)
    trees: TreeFit | None = None
    if COMPONENTS_CANDIDATE in candidates:
        trees = fit_trees(fit_frame, specs, refits, grids.boosted, anchors={k: anchor_column(k[1]) for k in specs})
    clock["component_trees"] = time.monotonic() - mark
    mark = time.monotonic()
    rival: TreeFit | None = None
    if RIVAL_CANDIDATE in candidates:
        rival = fit_trees(_residual_rows(fit_frame), rival_specs(), refits, grids.boosted)
    clock["rival"] = time.monotonic() - mark
    shared = Shared(shrinkage, FROZEN(fumbles), trees, rival, lined)
    fitted = Fitted(play, team, shares, shared, FROZEN(models), FROZEN(data), FROZEN({}), tuple(candidates), clock, {})
    mark = time.monotonic()
    fitted.bands = FROZEN({c: fit_bands(band_rows(fitted, c, t), t.band_seasons) for c in candidates})
    clock["bands"] = time.monotonic() - mark
    trained = {s for m in play.models.values() for s in m.trained_on} | {
        s for m in team.models.values() for s in m.trained_on
    }
    fitted.served = {
        "plays and teams": tuple(sorted(trained)),
        "players": tuple(
            sorted({int(s) for s in fit_frame["season"].unique()} | {int(s) for s in window["season"].unique()})
        ),
    }
    return fitted


def fit_round(
    store: Store,
    sources: Sources,
    t: RoundFive,
    candidates: Sequence[str],
    grids: Grids = Grids(),  # noqa: B008 - a frozen default
) -> Fitted:
    """Every stage of 2.11 in its order on one store."""
    components = fit_components(store, t, grids)
    shares = fit_shares(store, sources, t, grids)
    return fit_rest(store, sources, t, components, shares, candidates, grids)


def judged_board(fitted: Fitted, t: RoundFive, candidate: str) -> pd.DataFrame:
    """The judged season's board of the candidate (the refit on every player fit season)."""
    s = t.judgment_season
    return board(fitted.data[s], fitted.models[s], fitted.shared, candidate, THE_NUMBER)
