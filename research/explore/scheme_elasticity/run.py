"""THE PROBE'S ONE RUN (plan sections 3 to 7): read, build, compare, write the JSON record.

`python -m research.explore.scheme_elasticity run --scratch <lane245_ url> --dev <dev url> --out <path>`
"""

import json
import logging
import time
from collections import Counter
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Final

import numpy as np
import pandas as pd

from research.explore.scheme_elasticity import db
from research.explore.scheme_elasticity.bar import evaluate
from research.explore.scheme_elasticity.baseline import BaseRow, Points, week_rows
from research.explore.scheme_elasticity.fetch import FTN_TABLE, PARTICIPATION_TABLE
from research.explore.scheme_elasticity.inputs import SeasonInputs, lines_of, season_inputs, skill_positions
from research.explore.scheme_elasticity.measure import (
    Key,
    calibration,
    difference,
    mean_rho,
    places,
    scored_rows,
    week_key,
    week_orderings,
)
from research.explore.scheme_elasticity.plays import build
from research.explore.scheme_elasticity.seasons import FORM_SEASON, JUDGED_WEEKS, PROBE_SEASONS
from research.explore.scheme_elasticity.terms import TERM_POSITIONS, TERMS, TermValue
from research.explore.scheme_elasticity.week_terms import Opportunities, opportunities, product, week_terms
from research.model.weekly4.play_model import FORMAT_NAMES

LOG = logging.getLogger("lane245")
ROUND_FOUR_RECORD: Final = (
    Path(__file__).resolve().parents[3]
    / "docs"
    / Path("research/2026-10-16-weekly-projection-round4-development-check.json")
)
BASE_SOURCES: Final = ("sheet", "form", "damped")
UNSHRUNK: Final = "terms_unshrunk"


def _scaled(points: Points | None, factor: float) -> Points | None:
    return None if points is None else {n: points[n] * factor for n in FORMAT_NAMES}


def _term_sets() -> dict[str, tuple[str, ...]]:
    sets: dict[str, tuple[str, ...]] = {"terms": TERMS}
    for term in TERMS:
        sets[f"only_{term}"] = (term,)
        sets[f"without_{term}"] = tuple(t for t in TERMS if t != term)
    return sets


def _asked(rows: Sequence[BaseRow]) -> dict[tuple[str, str], list[tuple[str, str | None]]]:
    asked: dict[tuple[str, str], list[tuple[str, str | None]]] = {}
    for term in TERMS:
        for position in TERM_POSITIONS[term].split(","):
            asked[(term, position)] = [(r.player_id, r.opponent) for r in rows if r.position == position]
    return asked


def _season_rows(
    inputs: SeasonInputs, last: pd.DataFrame, positions: Mapping[str, str], ops: Opportunities, shrink: bool = True
) -> tuple[list[BaseRow], dict[Key, dict[str, TermValue]], dict[str, int]]:
    base: list[BaseRow] = []
    values: dict[Key, dict[str, TermValue]] = {}
    pooled: Counter[str] = Counter()
    for week in JUDGED_WEEKS:
        rows = week_rows(inputs, last, positions, week)
        found = week_terms(ops, inputs.season, week, _asked(rows), positions, shrink)
        pooled.update(k for k, v in found.pooled_fully.items() if v)
        for r in rows:
            values[(r.season, r.week, r.player_id)] = {
                t: found.values[(r.player_id, t)] for t in TERMS if (r.player_id, t) in found.values
            }
        base.extend(rows)
    return base, values, dict(pooled)


def _sources(
    base: Sequence[BaseRow],
    values: Mapping[Key, Mapping[str, TermValue]],
    unshrunk: Mapping[Key, Mapping[str, TermValue]],
) -> dict[str, dict[Key, Points | None]]:
    """Every source per row; `terms_unshrunk` is the view added after the plan (never the bar)."""
    names = (*BASE_SOURCES, *_term_sets(), UNSHRUNK)
    sources: dict[str, dict[Key, Points | None]] = {name: {} for name in names}
    for r in base:
        key = (r.season, r.week, r.player_id)
        sources["sheet"][key] = r.sheet
        sources["form"][key] = r.form
        sources["damped"][key] = r.damped
        own = {(r.player_id, t): v for t, v in values.get(key, {}).items()}
        for name, terms in _term_sets().items():
            sources[name][key] = _scaled(r.sheet, product(own, r.player_id, terms))
        raw = {(r.player_id, t): v for t, v in unshrunk.get(key, {}).items()}
        sources[UNSHRUNK][key] = _scaled(r.sheet, product(raw, r.player_id, TERMS))
    return sources


def _usage(base: Sequence[BaseRow], values: Mapping[Key, Mapping[str, TermValue]]) -> list[dict[str, Any]]:
    tally: dict[tuple[str, str, int], Counter[str]] = {}
    spread: dict[tuple[str, str, int], list[float]] = {}
    for r in base:
        for term, v in values.get((r.season, r.week, r.player_id), {}).items():
            c = tally.setdefault((term, r.position, r.season), Counter())
            c["rows"] += 1
            c["used"] += int(v.used)
            c["capped"] += int(v.capped)
            if v.used:
                spread.setdefault((term, r.position, r.season), []).append(v.m)
    return [
        {
            "term": t,
            "position": p,
            "season": s,
            **dict(c),
            "fallback_share": 1 - c["used"] / c["rows"],
            "m_percentiles_5_50_95": [float(q) for q in np.percentile(spread.get((t, p, s), [1.0]), (5, 50, 95))],
        }
        for (t, p, s), c in sorted(tally.items())
    ]


def _comparisons(rows: Sequence[Any], names: Sequence[str]) -> dict[str, Any]:
    weeks_by: dict[str, list[int]] = {
        "pooled": [week_key(s, w) for s in PROBE_SEASONS for w in JUDGED_WEEKS],
        **{str(s): [week_key(s, w) for w in JUDGED_WEEKS] for s in PROBE_SEASONS},
    }
    out: dict[str, Any] = {}
    for label, weeks in weeks_by.items():
        found = {fmt: week_orderings(rows, weeks, names, fmt) for fmt in FORMAT_NAMES}
        ppr = found["ppr"]
        out[label] = {
            "vs_sheet": {n: difference(ppr, weeks, n, "sheet") for n in names if n != "sheet"},
            "vs_form": {n: difference(ppr, weeks, n, "form") for n in names if n != "form"},
            "mean_rho": {fmt: {n: mean_rho(f, n) for n in names} for fmt, f in found.items()},
            "places_off": {n: places(ppr, n) for n in names},
            "terms_vs_sheet_other_formats": {
                fmt: difference(found[fmt], weeks, "terms", "sheet") for fmt in FORMAT_NAMES if fmt != "ppr"
            },
        }
        if label == "2023":
            out[label]["per_week_rho"] = [
                {"week": o.week % 100, "position": o.position, "n": o.size, **dict(o.rho)} for o in ppr
            ]
    return out


def reproduction(per_week: Sequence[Mapping[str, Any]], record: Path = ROUND_FOUR_RECORD) -> dict[str, Any]:
    """The probe's 2023 sheet and form rho against round 4's recorded ones, per week and position."""
    if not record.exists():
        return {"refused": f"{record} is not in this checkout"}
    recorded = {(r["week"], r["position"]): r for r in json.loads(record.read_text())["numbers"]["per_week_rho"]}
    cells = []
    for r in per_week:
        theirs = recorded.get((r["week"], r["position"]))
        if theirs is None:
            continue
        cells.append(
            {
                "week": r["week"],
                "position": r["position"],
                "n_probe": r["n"],
                "n_round4": theirs["n"],
                "sheet_probe": r["sheet"],
                "sheet_round4": theirs["baseline"],
                "form_probe": r["form"],
                "form_round4": theirs["form"],
            }
        )
    return {"cells": cells, "same_n": sum(c["n_probe"] == c["n_round4"] for c in cells), "of": len(cells)}


@dataclass(frozen=True, slots=True)
class Read:
    positions: Mapping[str, str]
    inputs: Mapping[int, SeasonInputs]
    last: Mapping[int, pd.DataFrame]
    ops: Opportunities


def read_all(scratch: str, dev: str) -> Read:
    """Every read of the run: the scratch's two files, and dev's lines, games and plays (2021 lines
    for last season's form only)."""
    engine = db.scratch_engine(scratch)
    participation = db.read_frame(engine, PARTICIPATION_TABLE, PROBE_SEASONS)
    ftn = db.read_frame(engine, FTN_TABLE, PROBE_SEASONS)
    with db.dev_reader(dev) as conn:
        positions = skill_positions(conn)
        earlier = lines_of(conn, FORM_SEASON, positions)
        inputs = {s: season_inputs(conn, s, positions) for s in PROBE_SEASONS}
        play_frame = build(db.plays(conn, PROBE_SEASONS), db.play_outcomes(conn, PROBE_SEASONS), participation, ftn)
    last = {PROBE_SEASONS[0]: earlier, PROBE_SEASONS[1]: inputs[PROBE_SEASONS[0]].lines}
    return Read(positions, inputs, last, opportunities(play_frame))


def _all_rows(
    read: Read, shrink: bool
) -> tuple[list[BaseRow], dict[Key, dict[str, TermValue]], dict[str, dict[str, int]]]:
    base: list[BaseRow] = []
    values: dict[Key, dict[str, TermValue]] = {}
    pooled: dict[str, dict[str, int]] = {}
    for season in PROBE_SEASONS:
        rows, found, fully = _season_rows(read.inputs[season], read.last[season], read.positions, read.ops, shrink)
        base.extend(rows)
        values.update(found)
        pooled[str(season)] = fully
    return base, values, pooled


def run(scratch: str, dev: str, out: Path) -> int:
    started = time.monotonic()
    read = read_all(scratch, dev)
    base, values, pooled = _all_rows(read, shrink=True)
    _, unshrunk, _ = _all_rows(read, shrink=False)
    sources = _sources(base, values, unshrunk)
    rows_scored = scored_rows(base, sources)
    comparisons = _comparisons(rows_scored, list(sources))
    record = {
        "seasons_read": {"outcomes": [FORM_SEASON, *PROBE_SEASONS], "files": list(PROBE_SEASONS)},
        "population_rows": Counter(f"{r.season}|{r.position}" for r in base),
        "missing": {n: sum(v is None for v in sources[n].values()) for n in BASE_SOURCES},
        "usage": _usage(base, values),
        "usage_unshrunk": _usage(base, unshrunk),
        "weeks_pooled_fully": pooled,
        "comparisons": comparisons,
        "reproduction_2023": reproduction(comparisons["2023"]["per_week_rho"]),
        "calibration": {
            f"fit_{a}_measure_{b}": {src: calibration(rows_scored, src, a, b) for src in ("sheet", "terms")}
            for a, b in ((2022, 2023), (2023, 2022))
        },
        "bar": evaluate(comparisons),
        "seconds": time.monotonic() - started,
    }
    out.write_text(json.dumps(record, indent=1, default=str))
    LOG.warning("bar: %s", json.dumps(record["bar"]))
    return 0
