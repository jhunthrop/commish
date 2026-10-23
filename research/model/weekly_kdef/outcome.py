"""ONE RUN, READ AND JUDGED: the reads, the fit, the draws, the gate lines per position and the reported
views (design 6.3), all pooled (Amendment 7 item 12: nothing club-level of the judged season).
"""

from collections.abc import Callable, Mapping, Sequence
from dataclasses import asdict, dataclass
from typing import Any, Final

import numpy as np
import pandas as pd
from sqlalchemy import Connection

from research.model.weekly2.gates import GateLine
from research.model.weekly4.features.depth import DepthRule
from research.model.weekly4.tuning import Cell, log_loss_sum, poisson_deviance_sum
from research.model.weekly_kdef import benchmarks, gates, judging
from research.model.weekly_kdef.features import LeaguePriors
from research.model.weekly_kdef.gates import LINES_PER_POSITION, KdefWeekly
from research.model.weekly_kdef.reads import KdefReader, espn_archive, espn_players
from research.model.weekly_kdef.system import PRIOR_FIRST, Fitted, fit_system, per_game_clause, points_of, read_all

FROZEN_POSITIONS: Final = ("DEF", "K")


@dataclass(frozen=True, slots=True)
class Result:
    lines: Mapping[str, tuple[GateLine, ...]]
    reported: Mapping[str, Any]

    def decision(self, command: str, position: str) -> str:
        lines = self.lines[position]
        if command == "check":
            if gates.stopped(lines):
                return f"STOP RULE: {position} fails KD1 or KD2 pooled on the check; its judged season is not judged"
            return f"DEVELOPMENT CHECK: {position} {sum(x.passed for x in lines)} of {len(lines)} lines pass; KD1 and KD2 pass, its judgment may run"
        if gates.verdict(lines):
            return f"DECISION: {position} all {LINES_PER_POSITION} lines pass; its number ships"
        return f"DECISION: {position} a line failed or cannot answer; nothing ships for it"


def _only[V](found: Mapping[str, V], positions: Sequence[str]) -> dict[str, V]:
    """A per-position view kept for the positions the run judges only (item 11: a stopped position's
    judged season is not judged, so nothing of it is printed)."""
    return {p: v for p, v in found.items() if p in positions}


def _pooled_cells(priors: LeaguePriors) -> dict[str, list[str]]:
    return {
        "per_game": sorted(name for name, p in priors.games.items() if p.pooled),
        "per_trial": sorted(name for name, p in priors.trials.items() if p.pooled),
    }


def _validation(f: Fitted, points_mean: np.ndarray) -> dict[str, Any]:
    """Each component's loss on the judged rows against its simple counterpart (reported only)."""
    rows = f.judged
    attempts = f.components.models["attempts"].predict(rows)
    actual_points = rows["d_points_allowed"].to_numpy(dtype=float)
    actual_attempts = rows["club_fg_att"].to_numpy(dtype=float)
    return {
        "points": {
            "model": poisson_deviance_sum(actual_points, points_mean),
            "the implied points alone": poisson_deviance_sum(
                actual_points, rows["implied_points"].to_numpy(dtype=float)
            ),
        },
        "attempts": {
            "model": poisson_deviance_sum(actual_attempts, attempts),
            "the club's season rate": poisson_deviance_sum(
                actual_attempts, rows["off_fg_att_per_game"].to_numpy(dtype=float)
            ),
        },
    }


def _make_validation(f: Fitted, kicks: pd.DataFrame, season: int) -> dict[str, float | None]:
    judged = kicks[kicks["season"] == season]
    if judged.empty:
        return {"model": None, "distance alone": None}
    model = f.components.models["make"].predict(judged)
    by_band = f.priors.band_make
    alone = judged["band"].map(by_band).to_numpy(dtype=float)
    y = judged["made"].to_numpy(dtype=float)
    return {"model": log_loss_sum(y, model), "distance alone": log_loss_sum(y, alone)}


def _defaults(rows: pd.DataFrame, index: Mapping[str, np.ndarray]) -> dict[str, Any]:
    found: dict[str, Any] = {name: int(rows[name].sum()) for name in judging.DEFAULT_COUNTS}
    found["projected_kicker_without_a_line"] = int(
        ((rows["kicker_id"].notna()) & (rows["kicker_withheld"] == 0) & (rows["has_kicker_line"] == 0)).sum()
    )
    found["population"] = {p: int(index[p].sum()) for p in index}
    return found


def judge(  # noqa: PLR0913, PLR0917 - one run's every input, named
    conn: Connection,
    teams: pd.DataFrame,
    t: KdefWeekly,
    reader: KdefReader,
    grid: Sequence[Cell],
    positions: Sequence[str],
    before: Mapping[str, str],
    after: Callable[[], Mapping[str, str]],
    rule: DepthRule,
) -> Result:
    read = read_all(conn, teams, t, reader, rule)
    archive, reader = espn_archive(conn, read.reader, t.judgment_season)
    crosswalk = {**espn_players(conn), **benchmarks.defense_crosswalk(sorted(set(teams["club"].astype(str))))}
    digests_after = after()
    fitted = fit_system(read, t, grid)
    defense, kicker, e = points_of(fitted, fitted.judged)
    simulated = judging.simulate(fitted, e, (defense, kicker), t)
    espn, counts = benchmarks.espn_values(archive, crosswalk)
    rows = fitted.judged
    index = {p: judging.in_population(rows, p).to_numpy() for p in FROZEN_POSITIONS}
    found = {
        "DEF": judging.population(rows, "DEF", defense, simulated.defense, espn),
        "K": judging.population(rows, "K", kicker, simulated.kicker, espn),
    }
    seasons = sorted({*t.fit_seasons, t.judgment_season})
    allowed = {
        "inputs": range(seasons[0] - 1, t.judgment_season + 1),
        "outcomes": range(PRIOR_FIRST, t.judgment_season + 1),
        "espn": (t.judgment_season,),
    }
    served = {name: reader.seasons(name) for name in allowed}
    isolation = gates.isolation_line(
        served,
        {k: tuple(v) for k, v in allowed.items()},
        before,
        digests_after,
        per_game_clause(read.games, read.stamps, read.rule),
    )
    results = {p: judging.position_lines(found[p], t, isolation) for p in positions}
    counts.population_rows_without_espn = {p: int(found[p]["espn"].isna().sum()) for p in positions}
    validation = _validation(fitted, fitted.components.models["points"].predict(fitted.judged))
    if "K" in positions:
        validation["make"] = _make_validation(fitted, read.kicks, t.judgment_season)
    else:
        validation.pop("attempts")
    reported = {
        "positions": {p: results[p].reported for p in positions},
        "defaults": _defaults(rows, {p: index[p] for p in positions}),
        "draw_mean_breaches": _only(simulated.breaches, positions),
        "pooled_fully": _pooled_cells(fitted.priors),
        "bandwidth": {
            "chosen": fitted.bandwidth.chosen,
            "losses": {str(k): v for k, v in fitted.bandwidth.losses.items()},
        },
        "calibration": {
            "rows": fitted.calibration_rows,
            "multipliers": {k: list(v) for k, v in fitted.calibration.multipliers.items()},
            "sack_dispersion": fitted.calibration.sack_dispersion,
            "yards_rho": fitted.calibration.yards_rho,
        },
        "cells": {name: {str(s): repr(c) for s, c in m.cells.items()} for name, m in fitted.components.models.items()},
        "validation": validation,
        "ablations": {k: _only(v, positions) for k, v in judging.ablations(fitted, rows, index, found, t).items()},
        "why": _only(judging.why_summary(fitted, rows, (defense, kicker), index), positions),
        "flat_three_kickers": judging.flat_view(fitted, rows, e, index["K"], t) if "K" in positions else None,
        "espn_under_its_own_scoring": {p: judging.espn_own_view(found[p], archive, crosswalk, t) for p in positions},
        "espn": asdict(counts),
        "espn_stamp_caveat": benchmarks.CAVEAT,
        "published_projection": judging.PUBLISHED_REFUSAL,
        "outcome_seasons_read": {k: list(v) for k, v in served.items()},
    }
    return Result({p: results[p].lines for p in positions}, reported)
