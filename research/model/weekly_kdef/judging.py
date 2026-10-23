"""THE JUDGED WEEKS, READ (design 6.1 to 6.3; Amendment 7 items 8 to 12): the joint draws of every judged
row, the two populations, every source scored on them, the gate lines per position, and the views the
design reports without gating. Everything here is pooled: no club's or player's figure of the judged
season is kept in what the run prints or writes (item 12).

Populations (item 8): defenses, every club with a game in the week (D of each row with a defense line);
kickers, each club's projected kicker with a stat line that week (a kicker filed Out or Doubtful, or a club
with no kicker evidenced, has no number and no row, counted).
"""

from collections.abc import Mapping, Sequence
from dataclasses import asdict, dataclass, replace
from typing import Any, Final

import numpy as np
import pandas as pd

from research.model.weekly2.gates import GateLine
from research.model.weekly_kdef import benchmarks, gates, statistics
from research.model.weekly_kdef.expectations import Expectations
from research.model.weekly_kdef.gates import KdefWeekly
from research.model.weekly_kdef.joint import bands_of, breached, club_game_seed, defense_point, draw_row, kicker_point
from research.model.weekly_kdef.reads import ArchivedRow
from research.model.weekly_kdef.scoring import FLAT_FG_POINTS
from research.model.weekly_kdef.system import Fitted, points_of, without_correlation
from research.model.weekly_kdef.why import coalition_points, neutral_frame, shapley

SOURCES: Final = ("model", "form", "sheet", "espn")
DEFAULT_COUNTS: Final = (
    "no_prior_unit_defense",
    "no_prior_unit_offense",
    "no_kicker_history",
    "no_passer_history",
    "no_kicker",
    "kicker_withheld",
    "lost_prior_week",
    "default_no_game_figure",
)
PUBLISHED_REFUSAL: Final = (
    "the published projection's archive: refused by name, no 2023 or 2024 week of it is stamped at or before t_g"
)


@dataclass(frozen=True, slots=True)
class Simulated:
    defense: np.ndarray  # rows x 3 (floor, median, ceiling)
    kicker: np.ndarray
    breaches: Mapping[str, int]


def simulate(f: Fitted, e: Expectations, points: tuple[np.ndarray, np.ndarray], t: KdefWeekly) -> Simulated:
    rows = f.judged
    defense = np.zeros((len(rows), 3))
    kicker = np.zeros((len(rows), 3))
    breaches = {"DEF": 0, "K": 0}
    for i, (season, week, club) in enumerate(zip(rows["season"], rows["week"], rows["club"], strict=True)):
        drawn = draw_row(e, i, f.calibration, club_game_seed(t.run_seed, int(season), int(week), str(club)), t.draws)
        defense[i], kicker[i] = bands_of(drawn.defense), bands_of(drawn.kicker)
        breaches["DEF"] += int(breached(float(drawn.defense.mean()), float(points[0][i])))
        breaches["K"] += int(breached(float(drawn.kicker.mean()), float(points[1][i])))
    return Simulated(defense, kicker, breaches)


def in_population(rows: pd.DataFrame, position: str) -> pd.Series:
    if position == "DEF":
        return pd.Series(True, index=rows.index)
    return rows["kicker_id"].notna() & (rows["kicker_withheld"] == 0) & (rows["has_kicker_line"] == 1)


def population(
    rows: pd.DataFrame, position: str, model: np.ndarray, bands: np.ndarray, espn: Mapping[tuple[int, str], float]
) -> pd.DataFrame:
    """One position's judged rows with every source beside its realised points."""
    kept = in_population(rows, position).to_numpy()
    r = rows[kept]
    unit = ("team-def:" + r["opponent"].astype(str)) if position == "DEF" else r["kicker_id"].astype(str)
    found = pd.DataFrame(
        {
            "week": r["week"].to_numpy(),
            "unit": unit.to_numpy(),
            "actual": (r["defense_points"] if position == "DEF" else r["kicker_points"]).to_numpy(dtype=float),
            "model": model[kept],
            "form": (r["form_defense"] if position == "DEF" else r["form_kicker"]).to_numpy(dtype=float),
            "implied": r["implied_points"].to_numpy(dtype=float),
            "floor": bands[kept, 0],
            "median": bands[kept, 1],
            "ceiling": bands[kept, 2],
        }
    )
    found["espn"] = [espn.get((int(w), str(u)), np.nan) for w, u in zip(found["week"], found["unit"], strict=True)]
    found["sheet"] = benchmarks.sheet_values(found, position)
    return found


@dataclass(frozen=True, slots=True)
class PositionResult:
    lines: tuple[GateLine, ...]
    reported: Mapping[str, Any]


def position_lines(found: pd.DataFrame, t: KdefWeekly, isolation: GateLine) -> PositionResult:
    weeks = list(t.weeks)
    draws = statistics.bootstrap_draws(len(weeks), t.resamples, t.seed)
    rhos = statistics.week_rhos(found, SOURCES, weeks)
    against = {b: statistics.compare(rhos, "model", b, draws, t.lower_percentile) for b in ("form", "sheet", "espn")}
    starters = {s: statistics.starters_points(found, s, weeks, t.starters) for s in SOURCES}
    shares = statistics.range_shares(
        found["actual"].to_numpy(), found["floor"].to_numpy(), found["median"].to_numpy(), found["ceiling"].to_numpy()
    )
    lines = (
        *gates.kd1_lines(against["form"], t),
        *gates.kd2_lines(against["sheet"], t),
        gates.kd3_line(against["espn"], t, benchmarks.CAVEAT),
        *gates.kd4_lines(starters),
        *gates.kd5_lines(shares, t),
        isolation,
    )
    sds = {b: _week_sd(rhos, b) for b in ("form", "sheet", "espn")}
    reported = {
        "rows": len(found),
        "weeks_answered": {b: c.weeks for b, c in against.items()},
        "against": {b: asdict(c) for b, c in against.items()},
        "pooled_rho": {s: statistics.pooled_rho(rhos, s) for s in SOURCES},
        "starters_points": starters,
        "range_shares": asdict(shares),
        "per_week_sd_of_the_difference": sds,
        "rows_without_espn": int(found["espn"].isna().sum()),
        "rows_without_form": int(found["form"].isna().sum()),
    }
    return PositionResult(lines, reported)


def _week_sd(rhos: Sequence[statistics.WeekRho], bench: str) -> float | None:
    values = []
    for o in rhos:
        model, other = o.rho["model"], o.rho[bench]
        if model is not None and other is not None:
            values.append(model - other)
    return float(np.std(values, ddof=1)) if len(values) > 1 else None


def _pooled(found: pd.DataFrame, values: np.ndarray, t: KdefWeekly) -> float | None:
    rhos = statistics.week_rhos(found.assign(model=values), ("model",), list(t.weeks))
    return statistics.pooled_rho(rhos, "model")


def ablations(
    f: Fitted,
    rows: pd.DataFrame,
    population_index: Mapping[str, np.ndarray],
    found: Mapping[str, pd.DataFrame],
    t: KdefWeekly,
) -> dict[str, Any]:
    """Prediction-time ablations (reported only): the point without weather, without the team model's
    sacks (at the calibration rows' mean), without the kicker's accuracy, without the joint's correlation."""
    variants = {
        "without weather": neutral_frame(rows, frozenset({"weather"}), f.means, f.priors, None),
        "without the kicker's accuracy": rows.assign(kicker_accuracy_over_expected=0.0),
    }
    points = {name: points_of(f, frame)[:2] for name, frame in variants.items()}
    base = points_of(f, rows)
    e = base[2]
    flat_sacks = e.sacks.mean()
    without_sacks = defense_point(replace(e, sacks=np.full(len(e.sacks), flat_sacks)), f.calibration)
    points["without the team model's sacks"] = (without_sacks, base[1])
    loose = without_correlation(f.calibration)
    points["without the joint correlation"] = (defense_point(e, loose), kicker_point(e, loose))
    out: dict[str, Any] = {}
    for name, (d, k) in points.items():
        out[name] = {
            "DEF": _pooled(found["DEF"], d[population_index["DEF"]], t),
            "K": _pooled(found["K"], k[population_index["K"]], t),
        }
    return out


def why_summary(
    f: Fitted, rows: pd.DataFrame, points: tuple[np.ndarray, np.ndarray], index: Mapping[str, np.ndarray]
) -> dict[str, Any]:
    """The why's exact Shapley values, pooled: each group's mean absolute value per position, and the
    largest gap between their sum and the point less the neutral point (zero but for float error)."""
    values = coalition_points(rows, lambda frame: points_of(f, frame)[:2], f.means, f.priors)
    by_group = shapley(values)
    neutral = values[frozenset()]
    found: dict[str, Any] = {}
    for p, position in enumerate(("DEF", "K")):
        kept = index[position]
        total = sum(by_group[g][p] for g in by_group)
        gap = np.abs(total - (points[p] - neutral[p]))[kept]
        found[position] = {
            "mean_absolute": {
                g: float(np.mean(np.abs(by_group[g][p][kept]))) if kept.any() else None for g in by_group
            },
            "largest_sum_gap": float(gap.max()) if kept.any() else None,
        }
    return found


def flat_view(f: Fitted, rows: pd.DataFrame, e: Expectations, index: np.ndarray, t: KdefWeekly) -> float | None:
    """The kickers' pooled rho with every field goal 3 points, the model and the outcome both."""
    model = kicker_point(e, f.calibration, FLAT_FG_POINTS)[index]
    kept = rows[index]
    found = pd.DataFrame(
        {
            "week": kept["week"].to_numpy(),
            "unit": kept["kicker_id"].astype(str).to_numpy(),
            "actual": kept["kicker_points_flat"].to_numpy(dtype=float),
            "model": model,
        }
    )
    return statistics.pooled_rho(statistics.week_rhos(found, ("model",), list(t.weeks)), "model")


def espn_own_view(
    found: pd.DataFrame, archive: Sequence[ArchivedRow], crosswalk: Mapping[str, str], t: KdefWeekly
) -> float | None:
    """ESPN's pooled rho under its own scoring (its total), on the same rows."""
    totals = {(r.week, crosswalk[r.espn_id]): r.applied_total for r in archive if r.espn_id in crosswalk}
    own = np.array([totals.get((int(w), str(u)), np.nan) for w, u in zip(found["week"], found["unit"], strict=True)])
    return statistics.pooled_rho(statistics.week_rhos(found.assign(espn=own), ("espn",), list(t.weeks)), "espn")
