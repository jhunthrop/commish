"""THE JUDGED WEEKS, READ: the judgment season scored, G1 to G4 (G5 is the run's, `round.py`), and
every number section 4 reports without gating.
"""

from collections.abc import Mapping, Sequence
from dataclasses import asdict, dataclass
from types import MappingProxyType
from typing import Any, Final

import numpy as np
from sqlalchemy import Connection

from research.model.domain import Position
from research.model.priors import ModelArtifacts
from research.model.ros.model import FORMATS
from research.model.weekly.round.scoring import SKILL_POSITIONS
from research.model.weekly2 import gates
from research.model.weekly2.band import chance
from research.model.weekly2.gates import Ordering, Thresholds
from research.model.weekly2.guard import WeekOutcomeReader
from research.model.weekly2.judge import RoundFit, Scored, read_season, score_season
from research.model.weekly2.statistics import (
    BENCHMARKS,
    SOURCES,
    Band,
    BoardRow,
    JudgedRow,
    WeekOrdering,
    bootstrap_draws,
    calibration,
    chance_bins,
    favourite_pairs,
    ordering_difference,
    orderings,
    places_mean,
    rho_deltas,
)

FLEX: Final = ("RB", "WR", "TE")


@dataclass(frozen=True, slots=True)
class Judgment:
    lines: tuple[gates.GateLine, ...]  # G1 to G4, 25 lines
    numbers: Mapping[str, Any]
    served: tuple[int, ...]
    rows: int


def _ordering_payload(found: Ordering) -> dict[str, Any]:
    return {"pooled": asdict(found.pooled), "by_position": dict(found.by_position)}


def _pairs(scored: Scored, name: str, positions: Sequence[str] | None = None) -> list[tuple[float, float]]:
    """Same-position pairs in `name`; with `positions`, every pair across them in a week (flex)."""
    if positions is None:
        return [
            pair
            for (_, _, fmt), found in sorted(scored.contenders.items())
            if fmt == name
            for pair in favourite_pairs(found, chance)
        ]
    weeks = sorted({week for week, _, _ in scored.contenders})
    pooled: list[tuple[float, float]] = []
    for week in weeks:
        found = [c for p in positions for c in scored.contenders.get((week, p, name), ())]
        pooled.extend(favourite_pairs(found, chance))
    return pooled


def _points_error(rows: Sequence[BoardRow]) -> dict[str, dict[str, float | int]]:
    errors: dict[str, dict[str, float | int]] = {}
    for position in SKILL_POSITIONS:
        for name in FORMATS:
            gaps = np.array([r.number[name] - r.actual[name] for r in rows if r.position == position])
            size = len(gaps)
            mae = float(np.mean(np.abs(gaps))) if size else 0.0
            rmse = float(np.sqrt(np.mean(gaps**2))) if size else 0.0
            errors[f"{position}|{name}"] = {"mae": mae, "rmse": rmse, "n": size}
    return errors


def _mean_rho(found: Sequence[WeekOrdering], source: str, position: str) -> float | None:
    values = [o.rho[source] for o in found if o.position == position and o.rho[source] is not None]
    return None if not values else float(np.mean([v for v in values if v is not None]))


def _round_one_view(rows: Sequence[JudgedRow], weeks: Sequence[int], t: Thresholds) -> dict[str, Any]:
    """Round 1's population (ADP-ranked players with a number, a form and a line) as a second view."""
    kept = [r for r in rows if r.adp is not None and r.number is not None and r.form is not None]
    found = orderings(kept, weeks, "ppr", t)
    return {p: {s: _mean_rho(found, s, p) for s in SOURCES} for p in SKILL_POSITIONS}


def _counts(scored: Scored) -> dict[str, int]:
    rows = scored.rows
    return {
        "population_rows": len(rows),
        "with_number": sum(1 for r in rows if r.number is not None),
        "outside_universe": sum(1 for r in rows if r.rate is None),
        "withheld": sum(1 for r in rows if r.rate is not None and r.number is None),
        "questionable": sum(1 for r in rows if r.questionable),
        "board_rows_scored": len(scored.board),
        "board_numbers": len(scored.numbers),
        "board_withheld": sum(1 for n in scored.numbers if n.number is None),
    }


def _reported(
    scored: Scored, found: Mapping[str, list[WeekOrdering]], weeks: Sequence[int], t: Thresholds
) -> dict[str, Any]:
    draws = bootstrap_draws(len(weeks), t)
    ablation = {
        f"{source} vs {bench}": _ordering_payload(
            ordering_difference(rho_deltas(found["ppr"], bench, weeks, source), draws, t)
        )
        for source in ("rate", "board")
        for bench in BENCHMARKS
    }
    return {
        "mean_rho": {
            name: {p: {s: _mean_rho(found[name], s, p) for s in SOURCES} for p in SKILL_POSITIONS} for name in FORMATS
        },
        "places_off": {p: {s: places_mean(found["ppr"], s, p) for s in SOURCES} for p in SKILL_POSITIONS},
        "places_off_pooled": {s: places_mean(found["ppr"], s) for s in SOURCES},
        "per_week_rho": [
            {"week": o.week, "position": o.position, "n": o.size, **{s: o.rho[s] for s in SOURCES}}
            for o in found["ppr"]
        ],
        "ablation_and_board": ablation,
        "chance": {
            "half": [asdict(b) for b in chance_bins(_pairs(scored, "half"), t)],
            "std": [asdict(b) for b in chance_bins(_pairs(scored, "std"), t)],
            "flex_ppr": [asdict(b) for b in chance_bins(_pairs(scored, "ppr", FLEX), t)],
        },
        "points_error": _points_error(scored.board),
        "round_one_population": _round_one_view(scored.rows, weeks, t),
        "counts": _counts(scored),
    }


def assess(scored: Scored, band: Band, t: Thresholds) -> tuple[list[gates.GateLine], dict[str, Any]]:
    """G1 to G4 on the scored season, and every gated and reported number, the range read through
    `band` (the fitted range's floor, median and ceiling of a number)."""
    weeks = list(t.weeks)
    found = {name: orderings(scored.rows, weeks, name, t) for name in FORMATS}
    draws = bootstrap_draws(len(weeks), t)
    against = {bench: ordering_difference(rho_deltas(found["ppr"], bench, weeks), draws, t) for bench in BENCHMARKS}
    places = {source: places_mean(found["ppr"], source) for source in ("model", *BENCHMARKS)}
    calibrated = calibration(scored.board, band, FORMATS)
    bins = chance_bins(_pairs(scored, "ppr"), t)
    lines = [
        *gates.ordering_lines("G1", "ADP", against["adp"], t.adp_margin, t),
        *gates.ordering_lines("G2", "recent form", against["form"], t.form_margin, t),
        *gates.places_lines(places["model"], places, t),
        *gates.calibration_lines(calibrated, t),
        gates.chance_line(bins, t),
    ]
    numbers = {
        "season": t.judgment_season,
        "weeks": weeks,
        "against_adp": _ordering_payload(against["adp"]),
        "against_form": _ordering_payload(against["form"]),
        "places_off_pooled": places,
        "calibration": {key: asdict(cell) for key, cell in calibrated.items()},
        "chance_ppr": [asdict(b) for b in bins],
        "reported": _reported(scored, found, weeks, t),
    }
    return lines, numbers


def judge_round(  # noqa: PLR0913, PLR0917 - the judgment's every input, named
    conn: Connection,
    t: Thresholds,
    fitted: RoundFit,
    artifacts: ModelArtifacts,
    positions: Mapping[str, Position],
    version: str,
    reader: WeekOutcomeReader,
) -> Judgment:
    """The judgment season read once through its reader, scored and assessed."""
    read, reader = read_season(conn, t.judgment_season, t, fitted.rate, artifacts, positions, reader)
    scored = score_season(read, fitted, positions, t, version)
    lines, numbers = assess(scored, fitted.ranges.band, t)
    numbers = {**numbers, "board_moment": read.board_moment}
    return Judgment(tuple(lines), MappingProxyType(numbers), reader.served, len(scored.rows))
