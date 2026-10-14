"""THE ROUND, RUN: the fit, the interval, then the held-out weeks scored and every gate read.

`fit_round` fits the four shipped groups on the fit seasons and the interval on the same seasons'
scored weeks, every regular-season week through 18 (`LAST_REGULAR_WEEK`), while the judgment reads
only the weeks it was preregistered on (1-17). `judge_round` builds every held-out week's board at its moment, scores it against the
two benchmarks and the outcome, and returns every preregistered number and every reported one. The
store is only read; the isolation gate checks that by digest.
"""

import time
from collections.abc import Mapping, Sequence
from dataclasses import asdict, dataclass, field
from types import MappingProxyType
from typing import Any, Final

from sqlalchemy import Connection, text

from research.model.arithmetic import Arithmetic
from research.model.backtest import LAST_REGULAR_WEEK
from research.model.reads.teams import kickoff_instants_by_week
from research.model.weekly.fit_data import WeeklyFit, fit_weekly_priors, read_fit_data
from research.model.weekly.inputs import ROUND_READER
from research.model.weekly.model import WeeklyPriors
from research.model.weekly.round import gates
from research.model.weekly.round.interval import WeeklyInterval, fit_interval
from research.model.weekly.round.scoring import FORMATS, SKILL_POSITIONS, Arm, ScoredRow, score_week
from research.model.weekly.round.statistics import (
    SOURCES,
    Difference,
    bootstrap,
    calibration,
    mean_places_off,
    mean_rho,
    orderings,
    places_difference,
    rho_difference,
)
from research.model.weekly.teams import oracle_latest_teams

MODEL_NAME: Final = "commish_weekly_v1"
ISOLATED_TABLES: Final = (
    "preseason_projections",
    "preseason_board_reasons",
    "register_freeze_rows",
    "register_grade_rows",
    "model_artifacts",
)


@dataclass(frozen=True, slots=True)
class RoundFit:
    fit: WeeklyFit
    interval: WeeklyInterval
    seconds: Mapping[str, float]
    interval_weeks: int


def _weeks_of(conn: Connection, season: int, weeks: Sequence[int] | None = None) -> list[int]:
    held = sorted(kickoff_instants_by_week(conn, season))
    return [week for week in held if 1 <= week <= LAST_REGULAR_WEEK and (weeks is None or week in weeks)]


def fit_round(conn: Connection, t: gates.Thresholds, arithmetic: Arithmetic) -> RoundFit:
    started = time.monotonic()
    data = read_fit_data(conn, (*t.history_seasons, *t.fit_seasons), ROUND_READER)
    read = time.monotonic()
    fit = fit_weekly_priors(data, t.fit_seasons, t.held_out_seasons, arithmetic)
    fitted = time.monotonic()
    arm = Arm(MODEL_NAME, fit.priors)
    rows: list[ScoredRow] = []
    weeks = 0
    for season in t.fit_seasons:
        for week in _weeks_of(conn, season):
            rows.extend(score_week(conn, season, week, arm).rows)
            weeks += 1
    interval = fit_interval(rows)
    done = time.monotonic()
    seconds = MappingProxyType({"read": read - started, "fit": fitted - read, "interval": done - fitted})
    return RoundFit(fit, interval, seconds, weeks)


def table_digests(conn: Connection) -> dict[str, str]:
    digests: dict[str, str] = {}
    for table in ISOLATED_TABLES:
        row = conn.execute(
            text(
                f"select count(*) as n, md5(coalesce(string_agg(md5(t::text), '' order by md5(t::text)), '')) as d "
                f"from research.{table} t"
            )
        ).one()
        digests[table] = f"{row.n}:{row.d}"
    return digests


@dataclass(frozen=True, slots=True)
class Judgment:
    lines: tuple[gates.GateLine, ...]
    passed: bool
    numbers: Mapping[str, Any]
    seconds_per_week: float
    rows: int = field(default=0)


def _scored(conn: Connection, season: int, weeks: Sequence[int], arm: Arm) -> tuple[list[ScoredRow], float]:
    rows: list[ScoredRow] = []
    started = time.monotonic()
    for week in weeks:
        rows.extend(score_week(conn, season, week, arm).rows)
    return rows, (time.monotonic() - started) / max(1, len(weeks))


def _reported(rows: Sequence[ScoredRow], oracle_rows: Sequence[ScoredRow], weeks: Sequence[int]) -> dict[str, Any]:
    """The numbers the preregistration reports and does not gate."""
    found = {name: orderings(rows, weeks, name) for name in FORMATS}
    oracle = orderings(oracle_rows, weeks)
    scored = [row for row in rows if row.actual is not None]
    errors = {}
    for position in SKILL_POSITIONS:
        gaps = [row.projected["ppr"] - row.actual["ppr"] for row in scored if row.position == position and row.actual]
        errors[position] = {
            "mae": sum(abs(g) for g in gaps) / max(1, len(gaps)),
            "rmse": (sum(g * g for g in gaps) / max(1, len(gaps))) ** 0.5,
            "n": len(gaps),
        }
    return {
        "mean_rho": {
            name: {p: {s: mean_rho(found[name], s, p) for s in SOURCES} for p in SKILL_POSITIONS} for name in FORMATS
        },
        "places_off": {p: {s: mean_places_off(found["ppr"], s, p) for s in SOURCES} for p in SKILL_POSITIONS},
        "places_off_pooled": {s: mean_places_off(found["ppr"], s) for s in SOURCES},
        "per_week_rho": [
            {"week": o.week, "position": o.position, "n": o.size, **{s: o.rho[s] for s in SOURCES}}
            for o in found["ppr"]
        ],
        "points_error": errors,
        "oracle_v1": {
            "mean_rho": {p: mean_rho(oracle, "model", p) for p in SKILL_POSITIONS},
            "places_off_pooled": mean_places_off(oracle, "model"),
        },
    }


def judge_round(conn: Connection, t: gates.Thresholds, fitted: RoundFit, oracle_priors: WeeklyPriors) -> Judgment:
    before = table_digests(conn)
    weeks = _weeks_of(conn, t.judgment_season, t.judgment_weeks)
    rows, per_week = _scored(conn, t.judgment_season, weeks, Arm(MODEL_NAME, fitted.fit.priors))
    oracle_rows, _ = _scored(conn, t.judgment_season, weeks, Arm("oracle_v1", oracle_priors, oracle_latest_teams))
    after = table_digests(conn)
    bands = {
        (row.week, row.player_id, name): fitted.interval.band(row.position, name, row.projected[name])
        for row in rows
        for name in FORMATS
    }
    found = orderings(rows, weeks)
    spec = bootstrap(len(weeks), t.resamples, t.seed, t.lower_bound_percentile)
    against_adp: dict[str, Difference] = {p: rho_difference(found, p, "adp", weeks, spec) for p in SKILL_POSITIONS}
    against_form: dict[str, Difference] = {p: rho_difference(found, p, "form", weeks, spec) for p in SKILL_POSITIONS}
    places = {bench: places_difference(found, bench, weeks, spec) for bench in ("adp", "form")}
    calibrated = calibration(rows, bands)
    lines = [
        *gates.ordering_gates(against_adp, against_form, t),
        *gates.places_gates(places, t),
        *gates.calibration_gates(calibrated, t),
        gates.isolation_gate(before, after),
    ]
    numbers = {
        "season": t.judgment_season,
        "weeks": weeks,
        "scored_rows": sum(1 for row in rows if row.actual is not None),
        "board_rows": len(rows),
        "against_adp": {p: asdict(d) for p, d in against_adp.items()},
        "against_form": {p: asdict(d) for p, d in against_form.items()},
        "places": {bench: asdict(d) for bench, d in places.items()},
        "calibration": {key: asdict(c) for key, c in calibrated.items()},
        "digests": {"before": before, "after": after},
        "reported": _reported(rows, oracle_rows, weeks),
    }
    return Judgment(tuple(lines), gates.verdict(lines), MappingProxyType(numbers), per_week, len(rows))
