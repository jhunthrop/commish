"""THE SUB-ROUND'S GATES, AS ONE CONSTANT: `KDEF_WEEKLY` (Amendment 7 item 10; design 6.3).

Per position (K, DEF), all must pass and a gate that cannot answer fails:

- KD1 against recent form: the pooled rho difference >= +0.05, and its lower bound > 0 (2 lines);
- KD2 against the streamer's sheet: pooled >= +0.02, and its lower bound > 0 (2 lines);
- KD3 against ESPN's archived projection: pooled >= 0.000, a point comparison (1 line, the stamp caveat
  printed beside it);
- KD4 the starters' points: the model's S2 at least the sheet's, ESPN's and form's (3 lines);
- KD5 calibration: below the floor and above the ceiling each within [0.06, 0.14], below the median
  within [0.44, 0.56] (3 lines);
- KD6 isolation (1 line).

12 lines per position, 24 for both. Each lower bound is the 2.5th percentile (two bootstrapped comparisons
per position, one-sided 0.05 / 2). The stop rule after the development check: a position failing KD1 or
KD2 pooled (either of its two lines) ends there.
"""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass, replace
from types import MappingProxyType
from typing import Final

from research.model.ros.outcomes import PRISTINE_SEASON
from research.model.weekly2.gates import GateLine
from research.model.weekly_kdef.statistics import Comparison, RangeShares

FROZEN: Final = MappingProxyType
POSITIONS: Final = ("K", "DEF")
LINES_PER_POSITION: Final = 12  # "KD1 2, KD2 2, KD3 1, KD4 3, KD5 3, KD6 1: 12"
GATE_LINES: Final = LINES_PER_POSITION * len(POSITIONS)
BOOTSTRAPPED: Final = 2  # KD1 and KD2
ONE_SIDED: Final = 0.05
STOPPING: Final = ("KD1", "KD2")


@dataclass(frozen=True, slots=True)
class KdefWeekly:
    model_name: str
    # Item 7: component models fitted forward-chained on the fit seasons; the judged season's weeks 3 to 17.
    fit_seasons: tuple[int, ...]
    judgment_season: int
    weeks: tuple[int, ...]
    # Item 10.
    form_margin: float
    sheet_margin: float
    espn_margin: float
    calibration_low: float
    calibration_high: float
    median_low: float
    median_high: float
    # Item 8: S2's twelve, 10,000 week-block resamples with `default_rng(42)`, the 2.5th percentile.
    starters: int
    resamples: int
    seed: int
    lower_percentile: float
    # Item 4 and round 4's seeding rule: 2,000 joint draws, the run seed the judged season.
    draws: int
    run_seed: int


KDEF_WEEKLY: Final = KdefWeekly(
    model_name="commish_week_kdef_v1",
    fit_seasons=tuple(range(2016, 2024)),
    judgment_season=2024,
    weeks=tuple(range(3, 18)),
    form_margin=0.05,
    sheet_margin=0.02,
    espn_margin=0.0,
    calibration_low=0.06,
    calibration_high=0.14,
    median_low=0.44,
    median_high=0.56,
    starters=12,
    resamples=10_000,
    seed=42,
    lower_percentile=100 * ONE_SIDED / BOOTSTRAPPED,
    draws=2_000,
    run_seed=2024,
)
# Item 7: "Development check: 2023 weeks 3 to 17, once", fit 2016 to 2022.
DEVELOPMENT_CHECK: Final = replace(
    KDEF_WEEKLY, fit_seasons=tuple(range(2016, 2023)), judgment_season=2023, run_seed=2023
)


def _bootstrapped(gate: str, bench: str, found: Comparison, margin: float) -> list[GateLine]:
    if found.value is None or found.lower_bound is None:
        reason = "cannot answer: no week where both answer"
        return [
            GateLine(gate, f"pooled vs {bench}", False, reason),
            GateLine(gate, f"lower bound vs {bench}", False, reason),
        ]
    return [
        GateLine(
            gate,
            f"pooled vs {bench}",
            found.value >= margin,
            f"difference {found.value:+.4f} against a margin of {margin:+.4f}, over {found.weeks} weeks",
        ),
        GateLine(
            gate, f"lower bound vs {bench}", found.lower_bound > 0, f"lower bound {found.lower_bound:+.4f} against 0"
        ),
    ]


def kd1_lines(found: Comparison, t: KdefWeekly) -> list[GateLine]:
    return _bootstrapped("KD1", "recent form", found, t.form_margin)


def kd2_lines(found: Comparison, t: KdefWeekly) -> list[GateLine]:
    return _bootstrapped("KD2", "the streamer's sheet", found, t.sheet_margin)


def kd3_line(found: Comparison, t: KdefWeekly, caveat: str) -> GateLine:
    if found.value is None:
        return GateLine("KD3", "pooled vs ESPN", False, f"cannot answer: no week where both answer ({caveat})")
    detail = f"difference {found.value:+.4f} against {t.espn_margin:+.4f} (a point comparison); {caveat}"
    return GateLine("KD3", "pooled vs ESPN", found.value >= t.espn_margin, detail)


_STARTER_BENCHES: Final = (("sheet", "the streamer's sheet"), ("espn", "ESPN"), ("form", "recent form"))


def kd4_lines(points: Mapping[str, float | None]) -> list[GateLine]:
    model = points.get("model")
    lines = []
    for bench, label in _STARTER_BENCHES:
        found = points.get(bench)
        subject = f"starters' points vs {label}"
        if model is None or found is None:
            lines.append(GateLine("KD4", subject, False, "cannot answer: no week scored"))
            continue
        lines.append(GateLine("KD4", subject, model >= found, f"model {model:.3f} against {found:.3f}"))
    return lines


def _within(value: float | None, low: float, high: float) -> bool:
    return value is not None and low <= value <= high


def kd5_lines(shares: RangeShares, t: KdefWeekly) -> list[GateLine]:
    cells = (
        ("below the floor", shares.below_floor, t.calibration_low, t.calibration_high),
        ("above the ceiling", shares.above_ceiling, t.calibration_low, t.calibration_high),
        ("below the median", shares.below_median, t.median_low, t.median_high),
    )
    lines = []
    for subject, value, low, high in cells:
        if value is None:
            lines.append(GateLine("KD5", subject, False, "cannot answer: no row with a range"))
            continue
        detail = f"{value:.3f} against [{low}, {high}], n={shares.size}"
        lines.append(GateLine("KD5", subject, _within(value, low, high), detail))
    return lines


def isolation_line(
    served: Mapping[str, Sequence[int]],
    allowed: Mapping[str, Sequence[int]],
    before: Mapping[str, str],
    after: Mapping[str, str],
    per_game: tuple[bool, str],
) -> GateLine:
    """KD6: every reader on its seasons only and none on the pristine one, the isolated tables as they
    were, and the input rule's per-game clause."""
    stray = {
        name: sorted(s for s in seasons if s not in set(allowed.get(name, ())) or s >= PRISTINE_SEASON)
        for name, seasons in served.items()
    }
    strayed = {name: found for name, found in stray.items() if found}
    moved = sorted(table for table in before if before[table] != after.get(table))
    held, detail = per_game
    passed = not strayed and not moved and bool(before) and set(before) == set(after) and held
    readers = "; ".join(f"{name} read {sorted(set(seasons))}" for name, seasons in sorted(served.items()))
    tables = "every isolated table as it was" if not moved else f"moved: {', '.join(moved)}"
    outside = "" if not strayed else f"; outside their seasons: {strayed}"
    return GateLine("KD6", "isolation", passed, f"{readers}{outside}; {tables}; per-game clause: {detail}")


def verdict(lines: Sequence[GateLine]) -> bool:
    return bool(lines) and all(line.passed for line in lines)


def stopped(lines: Sequence[GateLine]) -> bool:
    """The stop rule: a KD1 or KD2 line failed."""
    return any(line.gate in STOPPING and not line.passed for line in lines)
