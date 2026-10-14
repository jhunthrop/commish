"""THE ROUND'S GATES, AS ONE CONSTANT: the preregistered numbers and the functions that read them.

`docs/research/2026-10-13-weekly-projection-preregistration.md` is the authority; this is its
"Gates" and "Multiple comparisons" sections as code, so the judgment and any later harness cannot
disagree about what a gate measures. A gate that cannot answer fails.
"""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass, replace
from typing import Final

from research.model.weekly.round.scoring import FORMATS, SKILL_POSITIONS
from research.model.weekly.round.statistics import Calibration, Difference


@dataclass(frozen=True, slots=True)
class Thresholds:
    fit_seasons: tuple[int, ...]
    history_seasons: tuple[int, ...]
    held_out_seasons: tuple[int, ...]
    judgment_season: int
    judgment_weeks: tuple[int, ...]
    adp_margin: float
    form_margin: float
    places_margin: float
    calibration_low: float
    calibration_high: float
    calibration_min_size: int
    resamples: int
    seed: int
    bootstrap_comparisons: int
    family_alpha: float

    @property
    def lower_bound_percentile(self) -> float:
        """The one-sided Bonferroni level, as a percentile: 100 * 0.05 / 10 = 0.5."""
        return 100 * self.family_alpha / self.bootstrap_comparisons


PREREGISTERED: Final = Thresholds(
    fit_seasons=(2021, 2022, 2023, 2024),
    history_seasons=(2020,),
    held_out_seasons=(2025, 2026),
    judgment_season=2025,
    judgment_weeks=tuple(range(1, 18)),
    adp_margin=0.03,
    form_margin=0.02,
    places_margin=0.5,
    calibration_low=0.05,
    calibration_high=0.15,
    calibration_min_size=100,
    resamples=10_000,
    seed=12,
    bootstrap_comparisons=10,
    family_alpha=0.05,
)

# The development check: the same code, fit a season short, judged on the last fit season.
DEVELOPMENT_CHECK: Final = replace(
    PREREGISTERED, fit_seasons=(2021, 2022, 2023), held_out_seasons=(2024, 2025, 2026), judgment_season=2024
)


@dataclass(frozen=True, slots=True)
class GateLine:
    gate: str
    subject: str
    passed: bool
    detail: str


def _difference_line(gate: str, subject: str, found: Difference, margin: float) -> GateLine:
    if found.value is None or found.lower_bound is None:
        return GateLine(gate, subject, False, "cannot answer: no week holds enough players")
    passed = found.value >= margin and found.lower_bound > 0
    detail = (
        f"difference {found.value:+.4f} against a margin of {margin:+.4f}, "
        f"lower bound {found.lower_bound:+.4f} against 0, over {found.weeks} weeks"
    )
    return GateLine(gate, subject, passed, detail)


def ordering_gates(
    against_adp: Mapping[str, Difference], against_form: Mapping[str, Difference], t: Thresholds
) -> list[GateLine]:
    lines = [_difference_line("G1", f"{p} vs ADP", against_adp[p], t.adp_margin) for p in SKILL_POSITIONS]
    lines += [_difference_line("G2", f"{p} vs recent form", against_form[p], t.form_margin) for p in SKILL_POSITIONS]
    return lines


def places_gates(places: Mapping[str, Difference], t: Thresholds) -> list[GateLine]:
    return [
        _difference_line("G3", f"places off vs {bench}", places[bench], t.places_margin) for bench in ("adp", "form")
    ]


def calibration_gates(found: Mapping[str, Calibration], t: Thresholds) -> list[GateLine]:
    lines: list[GateLine] = []
    for position in SKILL_POSITIONS:
        for name in FORMATS:
            cell = found[f"{position}|{name}"]
            if cell.below is None or cell.above is None or cell.size < t.calibration_min_size:
                lines.append(GateLine("G4", f"{position} {name}", False, f"cannot answer: {cell.size} player-weeks"))
                continue
            inside = all(t.calibration_low <= share <= t.calibration_high for share in (cell.below, cell.above))
            detail = (
                f"below floor {cell.below:.3f}, above ceiling {cell.above:.3f}, "
                f"each against [{t.calibration_low}, {t.calibration_high}], n={cell.size}"
            )
            lines.append(GateLine("G4", f"{position} {name}", inside, detail))
    return lines


def isolation_gate(before: Mapping[str, str], after: Mapping[str, str]) -> GateLine:
    moved = sorted(table for table in before if before[table] != after.get(table))
    detail = "every table as it was" if not moved else f"moved: {', '.join(moved)}"
    return GateLine("G5", "isolation", not moved and set(before) == set(after), detail)


def verdict(lines: Sequence[GateLine]) -> bool:
    return bool(lines) and all(line.passed for line in lines)
