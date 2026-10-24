"""THE JUDGED WEEKS, READ (preregistration 3.1, 3.2): every source scored on round 3's population rows;
G1, G2 and its last-three guard, G6 against the decision's sheets, G7, G3 and G4 (G5 is the run's,
`round.py`), for one candidate; and the candidate choice of 2.8.

The population is round 3's (players with a week-W line in the union of ADP's top K and the
season-to-date top K), read from round 3's own scored rows, so round 3's number, ADP and the rounds'
recent form are the ones its code computed. The fill rule is round 2's (`weekly4.scoring`). G4's cells
are every numbered row of the judged weeks with a line; its chance line the population's same-position
pairs of a week, each pair's chance from the two bands' residuals (2.9), taken as independent.
"""

from collections.abc import Mapping, Sequence
from dataclasses import asdict, dataclass
from typing import Any, Final

import numpy as np
import pandas as pd

from research.model.weekly.round.scoring import FORMATS
from research.model.weekly2.gates import GateLine, Ordering
from research.model.weekly2.statistics import (
    JudgedRow,
    WeekOrdering,
    bootstrap_draws,
    chance_bins,
    ordering_difference,
    places_mean,
    rho_deltas,
)
from research.model.weekly4.scoring import Row, orderings, source_names
from research.model.weekly5 import gates
from research.model.weekly5.bands import Bands, band_of, start_over
from research.model.weekly5.benchmarks import Values
from research.model.weekly5.gates import CellShares, RoundFive

SOURCES: Final = ("model", "form", "last_three", "sheet", "damped", "round_three")
DECIMALS: Final = 4  # 2.8: "A tie is equality at four decimals, the precision the results record"
Key = tuple[int, str]


def numbers_of(board: pd.DataFrame) -> dict[Key, dict[str, float]]:
    """The candidate's number per (week, player) in each format; a row outside the projected set has none."""
    found: dict[Key, dict[str, float]] = {}
    columns = [board[f"point_{n}"].to_numpy(dtype=float) for n in FORMATS]
    for i, (week, pid) in enumerate(zip(board["week"], board["player_id"], strict=True)):
        values = [c[i] for c in columns]
        key = (int(week), str(pid))
        if all(np.isfinite(values)) and key not in found:
            found[key] = dict(zip(FORMATS, (float(v) for v in values), strict=True))
    return found


def judged_rows(
    r3_rows: Sequence[JudgedRow], numbers: Mapping[Key, Mapping[str, float]], benchmarks: Values, weeks: Sequence[int]
) -> list[Row]:
    """Round 3's population rows with every source beside them."""
    found = []
    for r in r3_rows:
        if r.week not in weeks:
            continue
        extra = benchmarks.get((r.week, r.player_id), {})
        sources = {
            "model": numbers.get((r.week, r.player_id)),
            "form": r.form,
            "last_three": extra.get("last_three"),
            "sheet": extra.get("sheet"),
            "damped": extra.get("damped"),
            "round_three": r.number,
        }
        found.append(Row(r.week, r.player_id, r.position, r.actual, sources, r.adp))
    return found


@dataclass(frozen=True, slots=True)
class Comparison:
    found: Mapping[str, list[WeekOrdering]]  # format -> week orderings
    against: Mapping[str, Ordering]  # benchmark -> the model's ordering difference (PPR)
    places: Mapping[str, float | None]


def compare(rows: Sequence[Row], t: RoundFive, source: str = "model") -> Comparison:
    """`source` against every other source (PPR, the gated format), each bootstrapped on the shared draws,
    and every source's places off."""
    weeks = list(t.weeks)
    s = t.statistics
    found = {name: orderings(rows, weeks, name, s, SOURCES) for name in FORMATS}
    draws = bootstrap_draws(len(weeks), s)
    against = {
        bench: ordering_difference(rho_deltas(found["ppr"], bench, weeks, source), draws, s)
        for bench in source_names(SOURCES)
        if bench != source
    }
    places = {name: places_mean(found["ppr"], name) for name in source_names(SOURCES)}
    return Comparison(found, against, places)


def _rate_only(board: pd.DataFrame) -> pd.Series:
    return board["default_no_game_this_season"].fillna(0).astype(int) == 1


def calibration_cells(board: pd.DataFrame, bands: Bands, weeks: Sequence[int]) -> dict[str, CellShares]:
    """G4's cells over every numbered row of the judged weeks with a line."""
    mine = board[board["week"].isin(weeks) & (board["lined"] == 1) & np.isfinite(board["point_ppr"])]
    rate = _rate_only(mine).to_numpy()
    tallies: dict[str, np.ndarray] = {}
    for name in FORMATS:
        points = mine[f"point_{name}"].to_numpy(dtype=float)
        actual = mine[f"actual_{name}"].to_numpy(dtype=float)
        for position, point, value, only in zip(mine["position"], points, actual, rate, strict=True):
            floor, median, ceiling = band_of(bands, str(position), name, float(point), bool(only))
            if not np.isfinite(floor):
                continue
            tally = tallies.setdefault(f"{position}|{name}", np.zeros(4))
            tally += (value < floor, value > ceiling, value < median, 1.0)
    return {k: CellShares(float(b / n), float(a / n), float(m / n), int(n)) for k, (b, a, m, n) in tallies.items()}


def favourite_pairs(rows: Sequence[Row], board: pd.DataFrame, bands: Bands) -> list[tuple[float, float]]:
    """Every same-position pair of a week's numbered population once: (the favourite's chance from the two
    bands' residuals, his PPR points less the other's); at exactly one half the first by id is favoured."""
    rate = dict(
        zip(zip(board["week"].astype(int), board["player_id"].astype(str), strict=True), _rate_only(board), strict=True)
    )
    groups: dict[tuple[int, str], list[Row]] = {}
    for r in rows:
        model = r.sources.get("model")
        if model is not None:
            groups.setdefault((r.week, r.position), []).append(r)
    pairs: list[tuple[float, float]] = []
    for (week, position), members in sorted(groups.items()):
        ordered = sorted(members, key=lambda r: r.player_id)
        draws = []
        for r in ordered:
            point = float((r.sources["model"] or {})["ppr"])
            draws.append((point, bands.of(position, "ppr", point, bool(rate.get((week, r.player_id), False)))))
        for i, a in enumerate(ordered):
            for j in range(i + 1, len(ordered)):
                b = ordered[j]
                chance = start_over(draws[i][1], draws[i][0], draws[j][1], draws[j][0])
                if not np.isfinite(chance):
                    continue
                if chance >= 0.5:  # noqa: PLR2004 - a favourite is the side of one half
                    pairs.append((chance, a.actual["ppr"] - b.actual["ppr"]))
                else:
                    pairs.append((1.0 - chance, b.actual["ppr"] - a.actual["ppr"]))
    return pairs


def gate_lines(
    comparison: Comparison, cells: Mapping[str, CellShares], pairs: Sequence[tuple[float, float]], t: RoundFive
) -> list[GateLine]:
    """G1, G2 and its guard, G6, G7, G3 and G4 (33 lines; G5 is the run's)."""
    a = comparison.against
    return [
        *gates.ordering_lines("G1", "ADP", a["adp"], t.adp_margin, t),
        *gates.ordering_lines("G2", "recent form", a["form"], t.form_margin, t),
        gates.guard_line("G2", "pooled vs last-three form", a["last_three"].pooled.value, t.last_three_margin),
        *gates.sheet_lines(a, t),
        gates.guard_line("G7", "pooled vs round 3's number", a["round_three"].pooled.value, t.round_three_margin),
        *gates.places_lines(comparison.places.get("model"), comparison.places, t),
        *gates.calibration_lines(cells, t),
        gates.chance_line(chance_bins(pairs, t.statistics), t),
    ]


def ordering_payload(found: Ordering) -> dict[str, Any]:
    return {"pooled": asdict(found.pooled), "by_position": dict(found.by_position)}


def mean_rho(found: Sequence[WeekOrdering], source: str, position: str) -> float | None:
    values = [o.rho[source] for o in found if o.position == position and o.rho.get(source) is not None]
    return None if not values else float(np.mean([v for v in values if v is not None]))


def missing_counts(rows: Sequence[Row]) -> dict[str, dict[str, int]]:
    """Each source's rows with no number, by position and week."""
    found: dict[str, dict[str, int]] = {}
    for r in rows:
        for source in source_names(SOURCES):
            missing = r.adp is None if source == "adp" else r.sources.get(source) is None
            key = f"{r.position}|{r.week}"
            found.setdefault(source, {}).setdefault(key, 0)
            found[source][key] += int(missing)
    return found


def sheet_leads(comparison: Comparison, t: RoundFive) -> dict[str, Any]:
    """3.2, reported: each sheet's lead over form (its rho less form's)."""
    weeks = list(t.weeks)
    draws = bootstrap_draws(len(weeks), t.statistics)
    return {
        sheet: ordering_payload(
            ordering_difference(rho_deltas(comparison.found["ppr"], "form", weeks, sheet), draws, t.statistics)
        )
        for sheet in gates.SHEETS
    }


@dataclass(frozen=True, slots=True)
class Assessed:
    """One candidate on the judged weeks: its 33 lines, its comparison and its reported numbers."""

    lines: tuple[GateLine, ...]
    comparison: Comparison
    rows: tuple[Row, ...]
    numbers: Mapping[str, Any]


def assess(
    board: pd.DataFrame,
    bands: Bands,
    r3_rows: Sequence[JudgedRow],
    benchmarks: Values,
    t: RoundFive,
) -> Assessed:
    rows = judged_rows(r3_rows, numbers_of(board), benchmarks, t.weeks)
    comparison = compare(rows, t)
    cells = calibration_cells(board, bands, t.weeks)
    pairs = favourite_pairs(rows, board, bands)
    lines = gate_lines(comparison, cells, pairs, t)
    numbers = {
        "against": {bench: ordering_payload(o) for bench, o in comparison.against.items()},
        "mean_rho": {
            name: {p: {src: mean_rho(found, src, p) for src in source_names(SOURCES)} for p in ("QB", "RB", "WR", "TE")}
            for name, found in comparison.found.items()
        },
        "places_off_pooled": dict(comparison.places),
        "per_week_rho": [
            {"week": o.week, "position": o.position, "n": o.size, **dict(o.rho)} for o in comparison.found["ppr"]
        ],
        "sheet_leads_over_form": sheet_leads(comparison, t),
        "missing": missing_counts(rows),
        "calibration": {k: asdict(v) for k, v in sorted(cells.items())},
        "chance_ppr": [asdict(b) for b in chance_bins(pairs, t.statistics)],
        "population_rows": len(rows),
    }
    return Assessed(tuple(lines), comparison, tuple(rows), numbers)


@dataclass(frozen=True, slots=True)
class Choice:
    """2.8's choice, made once on the check: the candidate with the higher pooled G2 point difference at four
    decimals, a tie to the components."""

    chosen: str
    values: Mapping[str, float | None]
    rule: str


def choose(assessed: Mapping[str, Assessed]) -> Choice:
    values = {name: a.comparison.against["form"].pooled.value for name, a in assessed.items()}
    rounded = {name: None if v is None else round(v, DECIMALS) for name, v in values.items()}
    components, rival = rounded.get("components"), rounded.get("rival")
    chosen = "rival" if rival is not None and (components is None or rival > components) else "components"
    shown = ", ".join(f"{name} {'none' if v is None else f'{v:+.4f}'}" for name, v in rounded.items())
    rule = (
        f"pooled G2 point difference (model minus recent form) at four decimals: {shown}; the higher goes to the "
        f"judgment, a tie to the components: {chosen}"
    )
    return Choice(chosen, values, rule)


FORM_TOLERANCE: Final = 1e-9


def form_mismatches(r3_rows: Sequence[JudgedRow], forms: pd.DataFrame, season: int) -> int:
    """Guard 5 on the run's own rows: the population rows whose rival form (`forms`) differs from the G2
    benchmark's in any format, or exists on one side only."""
    mine = forms[forms["season"] == season]
    rival: dict[Key, dict[str, float]] = {
        (int(w), str(p)): {n: float(v) for n, v in zip(FORMATS, values, strict=True)}
        for w, p, *values in zip(mine["week"], mine["player_id"], *(mine[f"form_{n}"] for n in FORMATS), strict=True)
    }
    found = 0
    for r in r3_rows:
        own = rival.get((r.week, r.player_id))
        if r.form is None or own is None:
            found += int((own is None) != (r.form is None))
            continue
        found += int(any(abs(own[n] - float(r.form[n])) > FORM_TOLERANCE for n in FORMATS))
    return found
