"""THE ROUND'S GATES, AS ONE CONSTANT: the preregistered numbers and the functions that read them.

`docs/research/2026-10-15-weekly-projection-round2-preregistration.md` (committed `86ca79d6`) is the
authority. This is its section 2 ("Fitted in this round"), section 4 ("Population and statistics",
"Gates", "Multiple comparisons") and section 4's development check as code, so the judgment and any
later harness cannot disagree about what a gate measures. A gate that cannot answer fails. The 26
lines: G1 5, G2 5, G3 2, G4 13 (12 cells and the chance line), G5 1.
"""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass, replace
from types import MappingProxyType
from typing import Final

from research.model.ros import gates as ros_gates
from research.model.weekly.round.scoring import FORMATS, SKILL_POSITIONS

FROZEN: Final = MappingProxyType


@dataclass(frozen=True, slots=True)
class Thresholds:
    model_name: str
    # Section 2: fit seasons 2021-2023 weeks 6-17; section 3: judged 2024 weeks 6-17.
    fit_seasons: tuple[int, ...]
    judgment_season: int
    weeks: tuple[int, ...]
    # Section 2 item 1: the rate is round 3's, refit and equal to its record (section 5's precondition).
    rate_round: ros_gates.Thresholds
    rate_record: str
    # Section 2 item 2 and "Fitted in this round": the cap and the 11 x 11 grid.
    factor_low: float
    factor_high: float
    elasticity_grid: tuple[float, ...]
    # Section 2 item 5: round 1's quintile cut of x (`interval.EDGE_PERCENTILES`), the 1st to 99th
    # residual percentiles kept; floor q10, median q50, ceiling q90.
    residual_percentiles: tuple[float, ...]
    band_percentiles: tuple[float, float, float]
    # Section 4, population and statistics.
    population: Mapping[str, int]
    starters: Mapping[str, int]
    min_week_population: int
    adp_source: str
    adp_seasons: tuple[int, ...]  # section 5's preconditions
    # Section 4, gates.
    adp_margin: float
    form_margin: float
    position_floor: float
    places_margin: float
    calibration_low: float
    calibration_high: float
    calibration_min_size: int
    chance_bins: tuple[tuple[float, float], ...]
    chance_min_pairs: int
    chance_tolerance: float
    chance_min_bins: int
    # Section 4, uncertainty and multiple comparisons: one-sided 0.05 / 2, the 2.5th percentile.
    resamples: int
    seed: int
    lower_percentile: float


ROUND_TWO: Final = Thresholds(
    model_name="commish_weekly_v2",
    fit_seasons=(2021, 2022, 2023),
    judgment_season=2024,
    weeks=tuple(range(6, 18)),
    rate_round=ros_gates.ROUND_THREE,
    rate_record="2026-10-14-rest-of-season-round3-results.json",
    factor_low=0.8,
    factor_high=1.25,
    elasticity_grid=tuple(round(0.1 * i, 1) for i in range(11)),
    residual_percentiles=tuple(float(p) for p in range(1, 100)),
    band_percentiles=(10.0, 50.0, 90.0),
    population=FROZEN({"QB": 36, "RB": 72, "WR": 108, "TE": 36}),
    starters=FROZEN({"QB": 12, "RB": 24, "WR": 24, "TE": 12}),
    min_week_population=8,
    adp_source="ffc_adp_ppr_12",
    adp_seasons=(2023, 2024),
    adp_margin=0.04,
    form_margin=0.02,
    position_floor=-0.02,
    places_margin=0.25,
    calibration_low=0.05,
    calibration_high=0.15,
    calibration_min_size=100,
    chance_bins=((0.5, 0.6), (0.6, 0.7), (0.7, 0.8), (0.8, 0.9), (0.9, 1.0)),
    chance_min_pairs=200,
    chance_tolerance=0.05,
    chance_min_bins=3,
    resamples=10_000,
    seed=42,
    lower_percentile=2.5,
)

# Section 4, "Development check": the identical code, the rate from round 3's development-check
# priors (fit 2021-2022), the elasticities and range fit on 2021-2022, judged on 2023 weeks 6-17.
DEVELOPMENT_CHECK: Final = replace(
    ROUND_TWO,
    fit_seasons=(2021, 2022),
    judgment_season=2023,
    adp_seasons=(2023,),
    rate_round=ros_gates.ROUND_THREE_CHECK,
    rate_record="2026-10-14-rest-of-season-round3-dev-check.json",
)


@dataclass(frozen=True, slots=True)
class GateLine:
    gate: str
    subject: str
    passed: bool
    detail: str


@dataclass(frozen=True, slots=True)
class Difference:
    """A pooled difference over the judged weeks and its bootstrap lower bound."""

    value: float | None
    lower_bound: float | None
    weeks: int


@dataclass(frozen=True, slots=True)
class Ordering:
    """Model rho minus a benchmark's: pooled with its bound, and each position's mean over weeks."""

    pooled: Difference
    by_position: Mapping[str, float | None]


def ordering_lines(gate: str, bench: str, found: Ordering, margin: float, t: Thresholds) -> list[GateLine]:
    """G1 or G2: the pooled difference at its margin with a bound above zero, then no position below
    the floor."""
    pooled = found.pooled
    if pooled.value is None or pooled.lower_bound is None:
        lines = [GateLine(gate, f"pooled vs {bench}", False, "cannot answer: no week where all four positions answer")]
    else:
        passed = pooled.value >= margin and pooled.lower_bound > 0
        detail = (
            f"difference {pooled.value:+.4f} against a margin of {margin:+.4f}, "
            f"lower bound {pooled.lower_bound:+.4f} against 0, over {pooled.weeks} weeks"
        )
        lines = [GateLine(gate, f"pooled vs {bench}", passed, detail)]
    for position in SKILL_POSITIONS:
        mean = found.by_position.get(position)
        if mean is None:
            lines.append(GateLine(gate, f"{position} vs {bench}", False, "cannot answer: no week holds 8 players"))
            continue
        detail = f"mean difference {mean:+.4f} against a floor of {t.position_floor:+.4f}"
        lines.append(GateLine(gate, f"{position} vs {bench}", mean >= t.position_floor, detail))
    return lines


def places_lines(model: float | None, benches: Mapping[str, float | None], t: Thresholds) -> list[GateLine]:
    """G3: the model's pooled places off at least the margin fewer than each benchmark's."""
    lines: list[GateLine] = []
    for bench, label in (("adp", "ADP"), ("form", "recent form")):
        found = benches.get(bench)
        if model is None or found is None:
            lines.append(GateLine("G3", f"places off vs {label}", False, "cannot answer: no starter scored"))
            continue
        lead = found - model
        detail = f"model {model:.3f}, {label} {found:.3f}: {lead:+.3f} fewer against a margin of {t.places_margin}"
        lines.append(GateLine("G3", f"places off vs {label}", lead >= t.places_margin, detail))
    return lines


@dataclass(frozen=True, slots=True)
class Calibration:
    below: float | None
    above: float | None
    size: int


def calibration_lines(cells: Mapping[str, Calibration], t: Thresholds) -> list[GateLine]:
    """G4's twelve cells: below the floor and above the ceiling each inside the band, n >= 100."""
    lines: list[GateLine] = []
    for position in SKILL_POSITIONS:
        for name in FORMATS:
            cell = cells.get(f"{position}|{name}", Calibration(None, None, 0))
            subject = f"{position} {name}"
            if cell.below is None or cell.above is None or cell.size < t.calibration_min_size:
                lines.append(GateLine("G4", subject, False, f"cannot answer: {cell.size} player-weeks"))
                continue
            inside = all(t.calibration_low <= share <= t.calibration_high for share in (cell.below, cell.above))
            detail = (
                f"below floor {cell.below:.3f}, above ceiling {cell.above:.3f}, "
                f"each against [{t.calibration_low}, {t.calibration_high}], n={cell.size}"
            )
            lines.append(GateLine("G4", subject, inside, detail))
    return lines


@dataclass(frozen=True, slots=True)
class ChanceBin:
    low: float
    high: float
    pairs: int
    mean_chance: float | None
    observed: float | None


def chance_line(bins: Sequence[ChanceBin], t: Thresholds) -> GateLine:
    """G4's chance line: every bin of at least 200 pairs within the tolerance, at least three gated."""
    gated = [b for b in bins if b.pairs >= t.chance_min_pairs and b.mean_chance is not None and b.observed is not None]
    misses = [b for b in gated if abs((b.observed or 0.0) - (b.mean_chance or 0.0)) > t.chance_tolerance]
    parts = [
        f"[{b.low}, {b.high}) n={b.pairs} chance {b.mean_chance:.3f} observed {b.observed:.3f}"
        for b in gated
        if b.mean_chance is not None and b.observed is not None
    ]
    passed = len(gated) >= t.chance_min_bins and not misses
    detail = f"{len(gated)} bins gated (at least {t.chance_min_bins}), tolerance {t.chance_tolerance}: " + "; ".join(
        parts
    )
    return GateLine("G4", "chance", passed, detail)


def isolation_line(
    fit_served: Sequence[int],
    judged_served: Sequence[int],
    before: Mapping[str, str],
    after: Mapping[str, str],
    t: Thresholds,
) -> GateLine:
    """G5: the fit's outcomes from the fit seasons only, the judgment's from the judgment season
    only, and the five tables as they were."""
    stray_fit = sorted({s for s in fit_served if s not in t.fit_seasons})
    stray_judged = sorted({s for s in judged_served if s != t.judgment_season})
    moved = sorted(table for table in before if before[table] != after.get(table))
    passed = not stray_fit and not stray_judged and not moved and bool(before) and set(before) == set(after)
    detail = (
        f"fit outcomes read for {sorted(set(fit_served))} (allowed {list(t.fit_seasons)}), judgment outcomes "
        f"for {sorted(set(judged_served))} (allowed [{t.judgment_season}]); "
        + ("every table as it was" if not moved else f"moved: {', '.join(moved)}")
    )
    return GateLine("G5", "isolation", passed, detail)


def verdict(lines: Sequence[GateLine]) -> bool:
    return bool(lines) and all(line.passed for line in lines)
