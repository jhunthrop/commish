"""THE JUDGED SEASON, ASSEMBLED, AND EVERYTHING 3.2 REPORTS WITHOUT GATING.

`judge_season` builds the judged season's board, simulates its weeks, scores every source on round 3's
population and returns the 33 gated lines (G5 is the run's) with the reported numbers: every source's
rho per position and format and per week, the baseline's lead over form, each source's missing counts,
the ablations (without the game terms, without weather, without the charted features, without the
touchdown reconciliation, without returning shares, round 3's input rule with the closing figure
hidden), the weather sensitivity view (the judgment only, seed 2024), each component's validation loss
against its simple counterpart, the simulation-mean breaches, every 2.10 default count, the
Questionable play chance and its calibration, the team model's residual by season, and the
retractable-roof club-games per season.
"""

import hashlib
from collections.abc import Mapping, Sequence
from dataclasses import asdict, dataclass, replace
from typing import Any, Final

import numpy as np
import pandas as pd

from research.model.weekly2.gates import GateLine
from research.model.weekly2.statistics import JudgedRow, chance_bins
from research.model.weekly4.board import THE_NUMBER, Variant, board_points, build_board
from research.model.weekly4.gates import RoundFour
from research.model.weekly4.judgment import (
    Comparison,
    Simulation,
    benchmark_values,
    calibration_cells,
    compare,
    favourite_pairs,
    gate_lines,
    judged_rows,
    numbers_of,
    ordering_payload,
    reported,
    simulate_week,
)
from research.model.weekly4.play_model import FORMAT_NAMES, actual_points
from research.model.weekly4.scoring import Row
from research.model.weekly4.share_model import realised_shares
from research.model.weekly4.system import Fitted, Store, positions_of
from research.model.weekly4.team_model import TEAM_TARGETS, predict_team
from research.model.weekly4.tuning import poisson_deviance_sum, squared_error_sum

WEATHER_SEED: Final = 2024  # section 5: "seed 2024, on outdoor games only"
WIND_SD: Final = 4.0
TEMPERATURE_SD: Final = 3.0
FLIP: Final = 0.10


@dataclass(frozen=True, slots=True)
class Judged:
    lines: tuple[GateLine, ...]
    numbers: Mapping[str, Any]
    board: pd.DataFrame
    simulation: Simulation
    rows: int


def _returning_off(frame: pd.DataFrame) -> pd.DataFrame:
    columns = {c: 0.0 for c in frame.columns if c.startswith("returning_") and c != "returning_teammates"}
    return frame.assign(**columns, **({"returning_teammates": 0} if "returning_teammates" in frame else {}))


def weather_noise(frame: pd.DataFrame) -> pd.DataFrame:
    """Section 5's sensitivity view: the recorded wind plus Normal noise of SD 4 mph (floored at 0), the
    temperature plus SD 3 F, the precipitation flag flipped with probability 0.10, seed 2024, outdoor
    games only; one draw per game in game-id order, so a game's rows move alike."""
    games = sorted(frame["game_id"].unique())
    rng = np.random.default_rng(WEATHER_SEED)
    noise = {g: (rng.normal(0.0, WIND_SD), rng.normal(0.0, TEMPERATURE_SD), rng.random() < FLIP) for g in games}
    outdoor = frame["indoor"].to_numpy() == 0
    wind, temperature, flip = (np.array([noise[g][k] for g in frame["game_id"]]) for k in range(3))
    flag = frame["precipitation"].to_numpy(dtype=float)
    return frame.assign(
        wind_mph=np.where(outdoor, np.maximum(frame["wind_mph"].to_numpy(dtype=float) + wind, 0.0), frame["wind_mph"]),
        temperature_f=np.where(
            outdoor, frame["temperature_f"].to_numpy(dtype=float) + temperature, frame["temperature_f"]
        ),
        precipitation=np.where(outdoor & flip.astype(bool) & np.isfinite(flag), 1.0 - flag, flag),
    )


ABLATIONS: Final = {
    "without_game_terms": Variant(groups=frozenset({"game"})),
    "without_weather": Variant(groups=frozenset({"weather"})),
    "without_charted_features": Variant(no_charted=True),
    "without_touchdown_reconciliation": Variant(reconcile=False),
    "without_returning_shares": Variant(transform=_returning_off),
    "round_three_input_rule_figure_hidden": Variant(hide_figure=True),
}


def _variant_numbers(fitted: Fitted, t: RoundFour, variant: Variant) -> dict[tuple[int, str], dict[str, float]]:
    data = fitted.data[t.judgment_season]
    points = board_points(data, fitted.models[t.judgment_season], fitted.shared, variant)
    keyed = data.rows[["week", "player_id"]].join(points)
    return numbers_of(keyed)


def _comparison_payload(found: Comparison) -> dict[str, Any]:
    return {
        "against": {
            b: ordering_payload(o)
            for b, o in found.against.items()
            if b in ("adp", "form", "baseline", "last_three", "round_three")
        },
        "places_off_pooled": dict(found.places),
    }


def ablations(fitted: Fitted, t: RoundFour, rows: Sequence[Row], judged: bool) -> dict[str, Any]:
    variants = dict(ABLATIONS)
    if judged:
        variants["weather_sensitivity"] = Variant(transform=weather_noise)
    found: dict[str, Any] = {}
    for name, variant in variants.items():
        numbers = _variant_numbers(fitted, t, variant)
        rows_v = [replace(r, sources={**r.sources, "model": numbers.get((r.week, r.player_id))}) for r in rows]
        found[name] = _comparison_payload(compare(rows_v, t))
    return found


def component_losses(fitted: Fitted, store: Store, t: RoundFour, board: pd.DataFrame) -> dict[str, Any]:
    """Each component on the judged season against its simple counterpart (3.2, reported)."""
    season = t.judgment_season
    data = fitted.data[season]
    weeks = data.teams["week"].isin(t.weeks)
    teams = data.teams[weeks]
    predicted = predict_team(teams, fitted.models[season].team)
    simple = teams["implied_points"].to_numpy(dtype=float) / np.nanmean(
        store.teams.loc[store.teams["season"] < season, "implied_points"]
    )
    team = {}
    for target in TEAM_TARGETS:
        y = teams[target].to_numpy(dtype=float)
        mean = float(store.teams.loc[store.teams["season"] < season, target].mean())
        team[target] = {
            "model": poisson_deviance_sum(y, predicted[f"exp_{target}"].to_numpy()),
            "implied_points_alone": poisson_deviance_sum(y, mean * np.nan_to_num(simple, nan=1.0)),
        }
    lined = board[(board["lined"] == 1) & (board["projected"] == 1) & board["week"].isin(t.weeks)]
    realised = realised_shares(lined, data.counts)
    shares = {}
    for kind in ("targets", "carries", "dropbacks"):
        w = realised[f"w_{kind}"].to_numpy()
        y = realised[f"y_{kind}"].to_numpy()
        shares[kind] = {
            "model": squared_error_sum(y, lined[f"share_{kind}"].to_numpy(dtype=float), w),
            "season_to_date": squared_error_sum(y, lined[f"share_season_{kind}"].fillna(0.0).to_numpy(dtype=float), w),
        }
    plays = data.priced[(data.priced["season"] == season) & data.priced["week"].isin(t.weeks)]
    fp = actual_points(plays)["fp_ppr"].to_numpy()
    xfp = plays["xfp_ppr"].to_numpy()
    fit = data.priced[data.priced["season"] < season]
    mean_by_kind = fit.groupby("kind")["xfp_ppr"].mean().to_dict()
    flat = plays["kind"].map(mean_by_kind).to_numpy(dtype=float)
    return {
        "team_model": team,
        "share_models": shares,
        "xfp_ppr": {
            "model": float(np.sum((fp - xfp) ** 2)),
            "kind_mean": float(np.sum((fp - flat) ** 2)),
            "plays": len(plays),
        },
    }


def default_counts(board: pd.DataFrame, rows: Sequence[Row]) -> dict[str, Any]:
    """Every 2.10 default's rows, over the judged weeks' board and over the population."""
    columns = [c for c in board.columns if c.startswith("default_")]
    population = {(r.week, r.player_id) for r in rows}
    keyed = board[[(int(w), str(p)) in population for w, p in zip(board["week"], board["player_id"], strict=True)]]
    return {
        "board_rows": len(board),
        "board": {c.removeprefix("default_"): int(board[c].fillna(0).sum()) for c in columns},
        "population_rows": len(keyed),
        "population": {c.removeprefix("default_"): int(keyed[c].fillna(0).sum()) for c in columns},
    }


def questionable(fitted: Fitted, t: RoundFour, board: pd.DataFrame) -> dict[str, Any]:
    """The share of Questionable filings at t_g followed by a line, by position: the fit seasons' and the
    judged season's (its calibration)."""
    fit_rows = pd.concat([d.rows for s, d in fitted.data.items() if s != t.judgment_season] or [board.iloc[0:0]])
    judged = board[board["week"].isin(t.weeks)]

    def chance(frame: pd.DataFrame) -> dict[str, Any]:
        q = frame[frame["questionable"] == 1]
        return {
            str(p): {"n": len(g), "played": float(g["lined"].mean()) if len(g) else None}
            for p, g in q.groupby("position")
        }

    return {"fit_rows": chance(fit_rows), "judged": chance(judged)}


def team_residuals(fitted: Fitted) -> dict[str, dict[str, float]]:
    """The team model's mean residual (realised less expected) by season and target (2.5, era drift)."""
    found: dict[str, dict[str, float]] = {}
    for season, data in sorted(fitted.data.items()):
        predicted = predict_team(data.teams, fitted.models[season].team)
        found[str(season)] = {
            t: float(np.nanmean(data.teams[t].to_numpy(dtype=float) - predicted[f"exp_{t}"].to_numpy()))
            for t in TEAM_TARGETS
        }
    return found


def judge_season(  # noqa: PLR0913, PLR0917 - the judged season's every input, in its order
    t: RoundFour, fitted: Fitted, r3_rows: Sequence[JudgedRow], lines: pd.DataFrame, store: Store, judgment: bool
) -> Judged:
    season = t.judgment_season
    data, models = fitted.data[season], fitted.models[season]
    board = build_board(data, models, fitted.shared, THE_NUMBER)
    simulation = Simulation()
    for week in t.weeks:
        population = frozenset(r.player_id for r in r3_rows if r.week == week)
        week_board = board[board["week"] == week]
        if not week_board.empty:
            simulate_week(week_board, fitted.dispersion, models, t, population, simulation)
    judged_lines = lines[lines["season"] == season]
    benchmarks, bench_counts = benchmark_values(r3_rows, board, judged_lines, data.teams, positions_of(store))
    rows = judged_rows(r3_rows, numbers_of(board), benchmarks, t.weeks)
    comparison = compare(rows, t)
    cells = calibration_cells(board, judged_lines, simulation, t.weeks)
    pairs = favourite_pairs(rows, simulation.draws)
    gated = gate_lines(comparison, cells, pairs, t)
    numbers = {
        "season": season,
        "weeks": list(t.weeks),
        **reported(comparison, rows, t),
        "calibration": {k: asdict(v) for k, v in sorted(cells.items())},
        "chance_ppr": [asdict(b) for b in chance_bins(pairs, t.statistics)],
        "simulation_mean_breaches": {"count": len(simulation.breaches), "examples": simulation.breaches[:20]},
        "ablations": ablations(fitted, t, rows, judged=judgment),
        "components": component_losses(fitted, store, t, board),
        "defaults": default_counts(board[board["week"].isin(t.weeks)], rows),
        "benchmark_counts": bench_counts,
        "questionable": questionable(fitted, t, board),
        "team_residual_by_season": team_residuals(fitted),
        "retractable_club_games": {
            str(s): int(d.teams["roof"].isin(["open", "closed"]).sum()) for s, d in sorted(fitted.data.items())
        },
    }
    return Judged(tuple(gated), numbers, board, simulation, len(rows))


def _digest(frame: pd.DataFrame) -> str:
    ordered = frame.sort_values(list(frame.columns[:3])).reset_index(drop=True)
    return hashlib.sha256(ordered.to_csv(index=False, float_format="%.12g").encode()).hexdigest()


def stage_digests(fitted: Fitted, judged: Judged) -> dict[str, str]:
    """A SHA-256 of each stage's output (12 significant digits), for the record."""
    keys = ["season", "week", "club", "player_id"]
    board = judged.board
    bands = pd.DataFrame(
        [(w, p, n, *b) for (w, p), by in judged.simulation.bands.items() for n, b in by.items()],
        columns=["week", "player_id", "format", "floor", "median", "ceiling"],
    )
    found = {
        "judged_points": _digest(board[[*keys, *(f"point_{n}" for n in FORMAT_NAMES)]]),
        "judged_shares": _digest(board[[*keys, "share_targets", "share_carries", "share_dropbacks"]]),
        "judged_bands": _digest(bands),
    }
    for season, data in sorted(fitted.data.items()):
        predicted = data.teams[["season", "week", "club"]].join(predict_team(data.teams, fitted.models[season].team))
        found[f"team_expectations_{season}"] = _digest(predicted)
        priced = data.priced[data.priced["season"] == season][
            ["season", "week", "game_id", "play_id", "kind", "xfp_ppr"]
        ]
        found[f"xfp_{season}"] = _digest(priced)
    return found


def fitted_payload(fitted: Fitted) -> dict[str, Any]:
    d = fitted.dispersion
    efficiency = fitted.shared.efficiency
    return {
        "play_model_cells": {k: {str(s): repr(c) for s, c in v.items()} for k, v in fitted.play.cells.items()},
        "team_model_cells": {k: {str(s): repr(c) for s, c in v.items()} for k, v in fitted.team.cells.items()},
        "share_cells": {"-".join(map(str, k)): repr(m.cell) for k, m in fitted.shares.models.items()},
        "share_fold_losses": {"-".join(map(str, k)): dict(v) for k, v in fitted.shares.losses.items()},
        "efficiency": {
            "|".join(k): asdict(v) | {"k": v.k, "pooled_fully": v.pooled_fully} for k, v in efficiency.cells.items()
        },
        "efficiency_pooled_fully": efficiency.pooled_fully,
        "role_priors": {
            k: {"features": list(p.features), "coefficients": dict(p.coefficients)}
            for k, p in efficiency.role_priors.items()
        },
        "residual_means": dict(fitted.shared.residual_means),
        "target_rate": fitted.shared.target_rate,
        "dispersion": {
            "margin_sd": d.margin_sd,
            "script_slope": d.script_slope,
            "plays_dispersion": d.plays_dispersion,
            "plays_sd": d.plays_sd,
            "concentration": {f"{p}|{k}": v for (p, k), v in d.concentration.items()},
            "yards_sd": dict(d.yards_sd),
            "scale": dict(d.scale),
        },
        "constants": {str(s): asdict(m.constants) for s, m in fitted.models.items()},
        "reported": fitted.reported,
    }
