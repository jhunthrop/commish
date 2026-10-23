"""THE SYSTEM, END TO END (design 5.1 to 5.5): the reads, the team model, the component models, the kernel,
the calibration of the joint, and the point function every view of the judged rows reads.

THE SEASONS. The store's seasons S (the fit seasons and the judged one, 2016 first) give every club-game
row. Round 4's team model (`weekly4.team_model`, its code, grid, tie rule and monotone constraints
unchanged) predicts each row of season s from the seasons before s, with its cell chosen inside them, so
its first predicted season is the third of S. The component models read the team model's predictions,
so their rows start there, and their first predicted season, which needs a fold inside the seasons
before it, is the fifth of S: the seasons from it to the one before the judged are the calibration rows
the joint's constants are fitted on (each row's expectation from the seasons before its own), and the
judged season's rows are graded. The kernel weighs every club-game of S before the row's season; its
bandwidth is chosen on the fit seasons. The shrinkage priors of season s read the outcomes of the seasons
before s from 2013 (`PRIOR_FIRST`), as prior seasons only.
"""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass, replace
from datetime import datetime
from types import MappingProxyType
from typing import Final

import numpy as np
import pandas as pd
from sqlalchemy import Connection

from research.model.weekly3.ledger import Stamp, violation
from research.model.weekly4.features.depth import DepthRule
from research.model.weekly4.groups import league_means
from research.model.weekly4.team_model import TeamFit, fit_team_models, predict_team
from research.model.weekly4.tuning import BOOSTED_GRID, Cell
from research.model.weekly_kdef import kernel
from research.model.weekly_kdef.components import Components, fit_components
from research.model.weekly_kdef.expectations import (
    Expectations,
    KernelBase,
    SeasonConstants,
    expectations,
    kernel_base,
    season_constants,
)
from research.model.weekly_kdef.features import LeaguePriors, league_priors, outcome_tally
from research.model.weekly_kdef.gates import KdefWeekly
from research.model.weekly_kdef.joint import Calibration, calibrate, defense_point, kicker_point
from research.model.weekly_kdef.reads import KdefReader, SeasonInputs, SeasonOutcomes, season_inputs, season_outcomes
from research.model.weekly_kdef.rows import feature_rows, implied_lookup, outcome_columns
from research.model.weekly_kdef.scoring import FG_BAND_LOW, FG_BANDS
from research.model.weekly_kdef.tallies import Implied
from research.model.weekly_kdef.why import PLAY_MEANS

FROZEN: Final = MappingProxyType
PRIOR_FIRST: Final = 2013  # design 5.5: "the shrinkage priors read 2013 onward ... as prior seasons only"
TEAM_MODEL_LAG: Final = 2  # the team model's first predicted season is the third of S
COMPONENT_LAG: Final = 4  # the components' first predicted season is the fifth of S
_MADE: Final = "made"
_GOOD: Final = "good"


@dataclass(frozen=True, slots=True)
class Read:
    """Every row the run reads, and what it read them through."""

    rows: pd.DataFrame
    kicks: pd.DataFrame
    extra_points: pd.DataFrame
    priors: Mapping[int, LeaguePriors]
    stamps: tuple[Stamp, ...]
    games: tuple[tuple[int, int, str, datetime], ...]
    reader: KdefReader
    rule: DepthRule


def _moments(teams: pd.DataFrame) -> list[tuple[int, datetime]]:
    return sorted(
        {(int(w), datetime.fromisoformat(str(i))) for w, i in zip(teams["week"], teams["instant"], strict=True)}
    )


def _priors(
    outcomes: Mapping[int, SeasonOutcomes], seasons: Sequence[int], implied: Implied
) -> dict[int, LeaguePriors]:
    tallies = {s: outcome_tally(o.defense, o.kicking, o.kicks, implied) for s, o in outcomes.items()}
    return {s: league_priors([tallies[x] for x in sorted(tallies) if x < s]) for s in seasons}


def _band(distance: np.ndarray) -> np.ndarray:
    return np.searchsorted(np.array(FG_BAND_LOW[1:], dtype=float), distance, side="right")


def kick_frames(rows: pd.DataFrame, outcomes: Mapping[int, SeasonOutcomes]) -> tuple[pd.DataFrame, pd.DataFrame]:
    """The field goals (with a distance and a result) and the extra points of S, each with its club-game's
    weather and venue and its kicker's shrunk terms (NaN when another kicker than the projected one kicked)."""
    plays = pd.DataFrame(
        [dict(r) for s in sorted(outcomes) if s >= int(rows["season"].min()) for r in outcomes[s].kicks]
    )
    if plays.empty:
        empty = rows.iloc[0:0].assign(distance=0.0, made=0.0, band="")
        return empty, empty
    keys = rows.rename(columns={"club": "posteam"})
    joined = plays.merge(keys, on=["season", "week", "posteam"], how="inner", suffixes=("", "_row"))
    other = joined["kicker_player_id"].notna() & (joined["kicker_player_id"] != joined["kicker_id"])
    joined.loc[other, ["kicker_accuracy_over_expected", "kicker_xp_rate"]] = np.nan
    goals = joined[
        (joined["play_type"] == "field_goal") & joined["field_goal_result"].notna() & joined["kick_distance"].notna()
    ]
    goals = goals.assign(
        distance=goals["kick_distance"].astype(float), made=(goals["field_goal_result"] == _MADE).astype(float)
    )
    goals = goals.assign(band=[FG_BANDS[int(i)] for i in _band(goals["distance"].to_numpy())])
    extra = joined[joined["extra_point_result"].notna()]
    extra = extra.assign(made=(extra["extra_point_result"] == _GOOD).astype(float))
    return goals.reset_index(drop=True), extra.reset_index(drop=True)


def read_all(conn: Connection, teams: pd.DataFrame, t: KdefWeekly, reader: KdefReader, rule: DepthRule) -> Read:
    """Every season's rows at their instants, their outcomes, and the priors of each season."""
    seasons = sorted({*t.fit_seasons, t.judgment_season})
    implied = implied_lookup(teams)
    outcomes: dict[int, SeasonOutcomes] = {}
    for s in range(PRIOR_FIRST, t.judgment_season + 1):
        outcomes[s], reader = season_outcomes(conn, reader, s)
    priors = _priors(outcomes, seasons, implied)
    frames: list[pd.DataFrame] = []
    stamps: list[Stamp] = []
    games: list[tuple[int, int, str, datetime]] = []
    for s in seasons:
        season_teams = teams[teams["season"] == s]
        inputs: SeasonInputs
        inputs, reader = season_inputs(conn, reader, s, _moments(season_teams), rule)
        stamps += inputs.stamps
        built = feature_rows(season_teams, inputs, outcomes[s], priors[s], implied)
        frames.append(outcome_columns(built, outcomes[s]))
        games += [
            (s, int(w), str(c), datetime.fromisoformat(str(i)))
            for w, c, i in zip(season_teams["week"], season_teams["club"], season_teams["instant"], strict=True)
        ]
    rows = pd.concat(frames, ignore_index=True)
    kicks, extra = kick_frames(rows, outcomes)
    return Read(rows, kicks, extra, FROZEN(priors), tuple(stamps), tuple(games), reader, rule)


_KINDS_AT: Final = ("kicking", "team_defense", "kicks", "plays", "filings")


def per_game_clause(
    games: Sequence[tuple[int, int, str, datetime]], stamps: Sequence[Stamp], rule: DepthRule
) -> tuple[bool, str]:
    """KD6's per-game clause: every club-game has its kicking, team-defense, kick-play, play, depth chart
    and filing reads at its own instant and its season-before read at or before it, and no read broke the
    rule."""
    if not games:
        return False, "cannot answer: no game was read"
    kinds = (*_KINDS_AT, "depth" if rule == "week" else "depth_prior")
    at = {(s.kind, s.season, s.week, s.moment) for s in stamps}
    prior: dict[int, datetime] = {}
    for s in stamps:
        if s.kind == "prior":
            prior[s.season] = min(prior.get(s.season, s.moment), s.moment)
    broken = [b for b in (violation(s) for s in stamps) if b is not None]
    short = [
        g
        for g in games
        if any((kind, g[0], g[1], g[3]) not in at for kind in kinds) or not (g[0] in prior and prior[g[0]] <= g[3])
    ]
    if broken or short:
        return (
            False,
            f"{len(broken)} reads broke the rule, {len(short)} games lack a read: {(broken + [str(g) for g in short])[:3]}",
        )
    return True, f"{len(games)} club-games, {len(stamps)} reads, every row before its instant"


@dataclass(frozen=True, slots=True)
class Fitted:
    """The fitted system: what a point at a judged row reads."""

    team: TeamFit
    components: Components
    base: KernelBase
    bandwidth: kernel.Bandwidth
    constants: Mapping[int, SeasonConstants]
    calibration: Calibration
    means: Mapping[str, float]
    priors: LeaguePriors
    judged: pd.DataFrame  # the judged season's rows with their team-model terms
    calibration_rows: int


def _means(fit: pd.DataFrame) -> dict[str, float]:
    """The neutral values the why reads (round 4's `league_means`, and the play terms' fit-row means)."""
    return {**league_means(fit), **{name: float(fit[name].mean()) for name in PLAY_MEANS}}


def with_team(rows: pd.DataFrame, team: TeamFit) -> pd.DataFrame:
    """The rows of the team model's seasons with its `exp_*` terms (and `exp_tds`)."""
    parts = []
    for season, model in team.models.items():
        part = rows[rows["season"] == season]
        if not part.empty:
            parts.append(pd.concat([part, predict_team(part, model)], axis=1))
    found = pd.concat(parts)
    return found.assign(exp_tds=found["exp_rushing_touchdowns"] + found["exp_receiving_touchdowns"])


def fit_system(read: Read, t: KdefWeekly, grid: Sequence[Cell] = BOOSTED_GRID) -> Fitted:
    seasons = sorted({*t.fit_seasons, t.judgment_season})
    rows = read.rows
    team = fit_team_models(rows[rows["has_defense_line"] == 1], seasons[TEAM_MODEL_LAG:], grid)
    data = with_team(rows[rows["has_defense_line"] == 1], team)
    predicted = seasons[COMPONENT_LAG:]
    components = fit_components(data, read.kicks, read.extra_points, predicted, grid)
    fit = rows[(rows["has_defense_line"] == 1) & (rows["season"] < t.judgment_season)]
    implied = fit["implied_points"].to_numpy(dtype=float)
    finite = np.isfinite(implied)
    bandwidth = kernel.choose_bandwidth(
        implied[finite],
        fit["d_points_allowed"].to_numpy(dtype=float)[finite],
        fit["season"].to_numpy()[finite],
        t.fit_seasons,
    )
    base = kernel_base(rows, bandwidth.chosen)
    constants = {s: season_constants(rows, read.kicks, s) for s in predicted}
    calibration_rows = data[(data["season"] >= predicted[0]) & (data["season"] < t.judgment_season)]
    calibration = calibrate(expectations(calibration_rows, components, base, constants), calibration_rows)
    judged = data[(data["season"] == t.judgment_season) & data["week"].isin(t.weeks)].reset_index(drop=True)
    return Fitted(
        team,
        components,
        base,
        bandwidth,
        FROZEN(constants),
        calibration,
        FROZEN(league_means(fit)),
        read.priors[t.judgment_season],
        judged,
        len(calibration_rows),
    )


def points_of(
    f: Fitted, frame: pd.DataFrame, calibration: Calibration | None = None
) -> tuple[np.ndarray, np.ndarray, Expectations]:
    """The analytic points of the frame's rows (the team model re-read, so a neutral game moves it)."""
    base = frame.drop(columns=[c for c in frame.columns if c.startswith("exp_")])
    found = with_team(base, f.team)
    e = expectations(found, f.components, f.base, f.constants)
    c = f.calibration if calibration is None else calibration
    return defense_point(e, c), kicker_point(e, c), e


def without_correlation(c: Calibration) -> Calibration:
    """The ablation without the joint's correlation: every band's multiplier 1 and no copula."""
    ones = dict.fromkeys(c.multipliers, (1.0, 1.0, 1.0))
    return replace(c, multipliers=FROZEN(ones), yards_rho=0.0)
