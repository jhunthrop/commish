"""THE JUDGED WEEKS, READ (preregistration sections 3.1 and 3.2): the judged season's board, simulated
game by game; every source scored on round 3's population rows; G1, G2 and its last-three guard, G6,
G7, G3 and G4 (G5 is the run's, `round.py`); and the numbers 3.2 reports without gating.

The population is round 3's (players with a week-W line in the union of ADP's top K and the
season-to-date top K), read from round 3's own scored rows, so round 3's number, ADP and the rounds'
recent form are the ones its code computed. The model's number is the point; its range is the
simulation's (2.6). A player on the rate m (no game this season, 2.10) takes the range of his
position's bottom quintile cell from the same week's simulation: the quintile's mean floor, median and
ceiling as shares of its points, applied to m; his draws for the chance are his own scaled to m.
"""

from collections.abc import Mapping, Sequence
from dataclasses import asdict, dataclass, field
from typing import Any, Final

import numpy as np
import pandas as pd

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
from research.model.weekly4 import gates
from research.model.weekly4.benchmarks import baseline, last_three, points_allowed
from research.model.weekly4.board import SeasonModels
from research.model.weekly4.gates import CellShares, RoundFour
from research.model.weekly4.play_model import FORMAT_NAMES
from research.model.weekly4.scoring import Row, orderings, source_names
from research.model.weekly4.simulate import BAND, Dispersion, chance_matrix, mean_check
from research.model.weekly4.system import simulate_board

SOURCES: Final = ("model", "form", "last_three", "baseline", "round_three")
QUINTILE: Final = 0.2
Band = tuple[float, float, float]


@dataclass(slots=True)
class Simulation:
    """The judged weeks' simulation: per (week, player) bands in each format and the PPR mean, the
    mean-against-point breaches, and the population's PPR draws by (week, player)."""

    bands: dict[tuple[int, str], dict[str, Band]] = field(default_factory=dict)
    means: dict[tuple[int, str], float] = field(default_factory=dict)
    breaches: list[str] = field(default_factory=list)
    draws: dict[tuple[int, str], np.ndarray] = field(default_factory=dict)


def numbers_of(board: pd.DataFrame) -> dict[tuple[int, str], dict[str, float]]:
    """The model's number per (week, player) in each format; a withheld row has none."""
    found: dict[tuple[int, str], dict[str, float]] = {}
    columns = [board[f"point_{n}"].to_numpy(dtype=float) for n in FORMAT_NAMES]
    for i, (week, pid) in enumerate(zip(board["week"], board["player_id"], strict=True)):
        points = [c[i] for c in columns]
        key = (int(week), str(pid))
        if all(np.isfinite(points)) and key not in found:
            found[key] = dict(zip(FORMAT_NAMES, (float(p) for p in points), strict=True))
    return found


def _bottom_quintile(rated: Sequence[tuple[str, float, Mapping[str, Band]]]) -> dict[str, dict[str, Band]]:
    """Per position, the bottom quintile by point: its mean floor, median and ceiling over its points."""
    found: dict[str, dict[str, Band]] = {}
    for position in sorted({p for p, _, _ in rated}):
        mine = sorted(((point, bands) for p, point, bands in rated if p == position and point > 0), key=lambda x: x[0])
        cut = mine[: max(1, int(len(mine) * QUINTILE))]
        if not cut:
            continue
        found[position] = {
            name: (
                float(np.mean([b[name][0] / point for point, b in cut])),
                float(np.mean([b[name][1] / point for point, b in cut])),
                float(np.mean([b[name][2] / point for point, b in cut])),
            )
            for name in FORMAT_NAMES
        }
    return found


def simulate_week(  # noqa: PLR0913, PLR0917 - one week's simulation, read once
    week_board: pd.DataFrame,
    dispersion: Dispersion,
    models: SeasonModels,
    t: RoundFour,
    population: frozenset[str],
    out: Simulation,
) -> None:
    """Simulate the week's games into `out`: bands for every numbered row, the mean check, and the
    population's PPR draws."""
    week = int(week_board["week"].iloc[0])
    rated: list[tuple[str, float, Mapping[str, Band]]] = []
    rate_only: list[tuple[str, str, np.ndarray, Mapping[str, float]]] = []
    for game, simulated in simulate_board(
        week_board, dispersion, {models.season: models.constants}, t.run_seed, t.draws
    ):
        played = game[game["default_no_game_this_season"] == 0]
        out.breaches += [f"week {week} {b}" for b in mean_check(simulated, played)]
        points = {n: game.set_index("player_id")[f"point_{n}"].to_dict() for n in FORMAT_NAMES}
        rate = game.set_index("player_id")["default_no_game_this_season"].to_dict()
        pct = {n: np.percentile(simulated.points[n], BAND, axis=1) for n in FORMAT_NAMES}
        for i, pid in enumerate(simulated.players):
            point = {n: float(points[n][pid]) for n in FORMAT_NAMES}
            if not np.isfinite(point["ppr"]):
                continue
            if int(rate[pid]) == 1:
                rate_only.append((pid, simulated.positions[i], simulated.points["ppr"][i], point))
                continue
            bands = {n: (float(pct[n][0][i]), float(pct[n][1][i]), float(pct[n][2][i])) for n in FORMAT_NAMES}
            out.bands[(week, pid)] = bands
            out.means[(week, pid)] = float(simulated.points["ppr"][i].mean())
            rated.append((simulated.positions[i], point["ppr"], bands))
            if pid in population:
                out.draws[(week, pid)] = simulated.points["ppr"][i]
    cells = _bottom_quintile(rated)
    for pid, position, draws, rate_point in rate_only:
        cell = cells.get(position)
        if cell is not None:
            out.bands[(week, pid)] = {
                n: (rate_point[n] * cell[n][0], rate_point[n] * cell[n][1], rate_point[n] * cell[n][2])
                for n in FORMAT_NAMES
            }
        mean = float(draws.mean())
        if pid in population:
            out.draws[(week, pid)] = draws * (rate_point["ppr"] / mean if mean > 0 else 0.0)


def favourite_pairs(rows: Sequence[Row], draws: Mapping[tuple[int, str], np.ndarray]) -> list[tuple[float, float]]:
    """Every same-position pair of a week's numbered population once: (the favourite's chance from the
    paired draws, his PPR points less the other's); at exactly one half the first by id is favoured."""
    pairs: list[tuple[float, float]] = []
    groups: dict[tuple[int, str], list[Row]] = {}
    for r in rows:
        if r.sources.get("model") is not None and (r.week, r.player_id) in draws:
            groups.setdefault((r.week, r.position), []).append(r)
    for (week, _), members in sorted(groups.items()):
        ordered = sorted(members, key=lambda r: r.player_id)
        matrix = chance_matrix([draws[(week, r.player_id)] for r in ordered])
        for i, a in enumerate(ordered):
            for j in range(i + 1, len(ordered)):
                b = ordered[j]
                chance = float(matrix[i, j])
                if chance >= 0.5:  # noqa: PLR2004 - a favourite is the side of one half
                    pairs.append((chance, a.actual["ppr"] - b.actual["ppr"]))
                else:
                    pairs.append((1.0 - chance, b.actual["ppr"] - a.actual["ppr"]))
    return pairs


def judged_rows(
    r3_rows: Sequence[JudgedRow],
    numbers: Mapping[tuple[int, str], Mapping[str, float]],
    benchmarks: Mapping[tuple[int, str], Mapping[str, Mapping[str, float] | None]],
    weeks: Sequence[int],
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
            "baseline": extra.get("baseline"),
            "round_three": r.number,
        }
        found.append(Row(r.week, r.player_id, r.position, r.actual, sources, r.adp))
    return found


def benchmark_values(
    r3_rows: Sequence[JudgedRow],
    board: pd.DataFrame,
    lines: pd.DataFrame,
    teams: pd.DataFrame,
    positions: Mapping[str, str],
) -> tuple[dict[tuple[int, str], dict[str, Mapping[str, float] | None]], dict[str, int]]:
    """Last-three form and the expert's spreadsheet for every population row, and the rows the
    spreadsheet read without a club (A and T / T-own at 1)."""
    pairing = teams[["week", "club", "opponent"]]
    implied = teams.set_index(["week", "club"])["implied_points"].to_dict()
    placed = (
        board.drop_duplicates(["week", "player_id"])
        .set_index(["week", "player_id"])[["club", "opponent"]]
        .to_dict("index")
    )
    found: dict[tuple[int, str], dict[str, Mapping[str, float] | None]] = {}
    counts = {"baseline_without_a_club": 0}
    for week in sorted({r.week for r in r3_rows}):
        three = last_three(lines, week)
        allowed = points_allowed(lines, pairing, positions, week)
        before = teams[teams["week"] < week]
        own = before.groupby("club")["implied_points"].mean().to_dict()
        league = float(before["implied_points"].mean()) if not before.empty else float("nan")
        for r in (r for r in r3_rows if r.week == week):
            spot = placed.get((week, r.player_id))
            if spot is None:
                counts["baseline_without_a_club"] += 1
                value = baseline(r.form, 1.0, float("nan"), 1.0)
            else:
                club, opponent = str(spot["club"]), str(spot["opponent"])
                own_mean = float(own.get(club, league))
                value = baseline(
                    r.form, allowed.get((opponent, r.position), 1.0), float(implied.get((week, club), np.nan)), own_mean
                )
            found[(week, r.player_id)] = {"last_three": three.get(r.player_id), "baseline": value}
    return found, counts


def calibration_cells(
    board: pd.DataFrame, lines: pd.DataFrame, simulation: Simulation, weeks: Sequence[int]
) -> dict[str, CellShares]:
    """G4's cells over every numbered row of the judged weeks with a line (round 3's S3 rows)."""
    actual = lines.set_index(["week", "player_id"])[list(FORMAT_NAMES)].to_dict("index")
    position = board.drop_duplicates(["week", "player_id"]).set_index(["week", "player_id"])["position"].to_dict()
    tallies: dict[str, np.ndarray] = {}
    for key, by_format in simulation.bands.items():
        if key[0] not in weeks or key not in actual:
            continue
        for name in FORMAT_NAMES:
            floor, median, ceiling = by_format[name]
            value = float(actual[key][name])
            tally = tallies.setdefault(f"{position[key]}|{name}", np.zeros(4))
            tally += (value < floor, value > ceiling, value < median, 1.0)
    return {k: CellShares(float(b / n), float(a / n), float(m / n), int(n)) for k, (b, a, m, n) in tallies.items()}


@dataclass(frozen=True, slots=True)
class Comparison:
    found: Mapping[str, list[WeekOrdering]]  # format -> week orderings
    against: Mapping[str, Ordering]  # benchmark -> the model's ordering difference (PPR)
    places: Mapping[str, float | None]


def compare(rows: Sequence[Row], t: RoundFour, source: str = "model") -> Comparison:
    """`source` against every benchmark (PPR, the gated format), and every source's places off."""
    weeks = list(t.weeks)
    s = t.statistics
    found = {name: orderings(rows, weeks, name, s, SOURCES) for name in FORMAT_NAMES}
    draws = bootstrap_draws(len(weeks), s)
    against = {
        bench: ordering_difference(rho_deltas(found["ppr"], bench, weeks, source), draws, s)
        for bench in source_names(SOURCES)
        if bench != source
    }
    places = {name: places_mean(found["ppr"], name) for name in source_names(SOURCES)}
    return Comparison(found, against, places)


def gate_lines(
    comparison: Comparison, cells: Mapping[str, CellShares], pairs: Sequence[tuple[float, float]], t: RoundFour
) -> list[GateLine]:
    """G1, G2 and its guard, G6, G7, G3 and G4 (33 lines; G5 is the run's)."""
    a = comparison.against
    return [
        *gates.ordering_lines("G1", "ADP", a["adp"], t.adp_margin),
        *gates.ordering_lines("G2", "recent form", a["form"], t.form_margin),
        gates.guard_line("G2", "pooled vs last-three form", a["last_three"].pooled.value, t.last_three_margin),
        *gates.ordering_lines("G6", "the expert's spreadsheet", a["baseline"], t.baseline_margin),
        gates.guard_line("G7", "pooled vs round 3's number", a["round_three"].pooled.value, t.round_three_margin),
        *gates.places_lines(comparison.places.get("model"), comparison.places),
        *gates.calibration_lines(cells),
        gates.chance_line(chance_bins(pairs, t.statistics)),
    ]


def ordering_payload(found: Ordering) -> dict[str, Any]:
    return {"pooled": asdict(found.pooled), "by_position": dict(found.by_position)}


def mean_rho(found: Sequence[WeekOrdering], source: str, position: str) -> float | None:
    values = [o.rho[source] for o in found if o.position == position and o.rho.get(source) is not None]
    return None if not values else float(np.mean([v for v in values if v is not None]))


def missing_counts(rows: Sequence[Row]) -> dict[str, dict[str, int]]:
    """Each source's rows with no number, by position and week (3.1: "the results report each
    source's missing count per position and week")."""
    found: dict[str, dict[str, int]] = {}
    for r in rows:
        for source in source_names(SOURCES):
            missing = r.adp is None if source == "adp" else r.sources.get(source) is None
            key = f"{r.position}|{r.week}"
            found.setdefault(source, {}).setdefault(key, 0)
            found[source][key] += int(missing)
    return found


def reported(comparison: Comparison, rows: Sequence[Row], t: RoundFour) -> dict[str, Any]:
    weeks = list(t.weeks)
    s = t.statistics
    draws = bootstrap_draws(len(weeks), s)
    lead = ordering_difference(rho_deltas(comparison.found["ppr"], "form", weeks, "baseline"), draws, s)
    return {
        "against": {bench: ordering_payload(o) for bench, o in comparison.against.items()},
        "mean_rho": {
            name: {p: {src: mean_rho(found, src, p) for src in source_names(SOURCES)} for p in ("QB", "RB", "WR", "TE")}
            for name, found in comparison.found.items()
        },
        "places_off_pooled": dict(comparison.places),
        "per_week_rho": [
            {"week": o.week, "position": o.position, "n": o.size, **dict(o.rho)} for o in comparison.found["ppr"]
        ],
        "baseline_lead_over_form": ordering_payload(lead),
        "missing": missing_counts(rows),
    }
