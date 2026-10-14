"""THE ROUND'S GATES, AS ONE CONSTANT: the preregistered numbers and the functions that read them.

`docs/research/2026-10-14-rest-of-season-preregistration.md` is the authority; this is its "Gates"
section as code, so the judgment and any later harness cannot disagree about what a gate measures.
A gate that cannot answer fails.
"""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass, replace
from types import MappingProxyType
from typing import Final

from research.model.ros.model import FORMATS
from research.model.weekly.round.scoring import SKILL_POSITIONS


@dataclass(frozen=True, slots=True)
class Thresholds:
    fit_seasons: tuple[int, ...]
    opportunity_seasons: tuple[int, ...]
    fit_weeks: tuple[int, ...]
    judgment_season: int
    judgment_weeks: tuple[int, ...]
    population: Mapping[str, int]
    starters: Mapping[str, int]
    rho_margin: float
    min_population: int
    coverage_low: float
    coverage_high: float
    min_coverage_size: int


PREREGISTERED: Final = Thresholds(
    fit_seasons=(2023, 2024),
    opportunity_seasons=(2021, 2022, 2023, 2024),
    fit_weeks=tuple(range(2, 16)),
    judgment_season=2025,
    judgment_weeks=(4, 8, 12),
    population=MappingProxyType({"QB": 36, "RB": 72, "WR": 108, "TE": 36}),
    starters=MappingProxyType({"QB": 12, "RB": 24, "WR": 36, "TE": 12}),
    rho_margin=0.02,
    min_population=20,
    coverage_low=0.75,
    coverage_high=0.85,
    min_coverage_size=60,
)

# The development check: the same code, fit a season short, judged on the last fit season.
DEVELOPMENT_CHECK: Final = replace(
    PREREGISTERED, fit_seasons=(2023,), opportunity_seasons=(2021, 2022, 2023), judgment_season=2024
)


@dataclass(frozen=True, slots=True)
class GateLine:
    gate: str
    subject: str
    passed: bool
    detail: str


@dataclass(frozen=True, slots=True)
class CellScore:
    """One judged (week, position, format): each source's rho and starters' rank error."""

    size: int
    model_rho: float | None
    board_rho: float | None
    model_rank_error: float | None
    board_rank_error: float | None


@dataclass(frozen=True, slots=True)
class Coverage:
    inside: int
    size: int

    @property
    def share(self) -> float | None:
        return None if self.size == 0 else self.inside / self.size


def cell_key(week: int, position: str, format_name: str) -> str:
    return f"{week}|{position}|{format_name}"


def ordering_line(key: str, score: CellScore, t: Thresholds) -> GateLine:
    if score.model_rho is None or score.board_rho is None or score.size < t.min_population:
        return GateLine("G1", key, False, f"cannot answer: a population of {score.size}")
    difference = score.model_rho - score.board_rho
    detail = (
        f"rho {score.model_rho:.4f} against the stale board's {score.board_rho:.4f}, difference "
        f"{difference:+.4f} against a margin of {t.rho_margin:+.4f}, n={score.size}"
    )
    return GateLine("G1", key, difference >= t.rho_margin, detail)


def starters_line(key: str, score: CellScore) -> GateLine:
    if score.model_rank_error is None or score.board_rank_error is None:
        return GateLine("G2", key, False, "cannot answer: no starters in the population")
    detail = f"rank error {score.model_rank_error:.3f} against the stale board's {score.board_rank_error:.3f}"
    return GateLine("G2", key, score.model_rank_error <= score.board_rank_error, detail)


def coverage_line(key: str, found: Coverage, t: Thresholds) -> GateLine:
    share = found.share
    if share is None or found.size < t.min_coverage_size:
        return GateLine("G3", key, False, f"cannot answer: {found.size} player-weeks")
    inside = t.coverage_low <= share <= t.coverage_high
    detail = f"coverage {share:.3f} against [{t.coverage_low}, {t.coverage_high}], n={found.size}"
    return GateLine("G3", key, inside, detail)


def isolation_line(
    served: Sequence[int], allowed: Sequence[int], before: Mapping[str, str], after: Mapping[str, str]
) -> GateLine:
    strays = sorted({season for season in served if season not in allowed})
    moved = sorted(table for table in before if before[table] != after.get(table))
    passed = not strays and not moved and set(before) == set(after) and bool(before)
    detail = f"outcomes read for {sorted(set(served))}, allowed {sorted(set(allowed))}; " + (
        "every table as it was" if not moved else f"moved: {', '.join(moved)}"
    )
    return GateLine("G4", "isolation", passed, detail)


def judged_lines(scores: Mapping[str, CellScore], coverage: Mapping[str, Coverage], t: Thresholds) -> list[GateLine]:
    """G1 and G2 for every judged cell, then G3 per position and format, in a fixed order."""
    keys = [cell_key(w, p, f) for w in t.judgment_weeks for p in SKILL_POSITIONS for f in FORMATS]
    missing = CellScore(0, None, None, None, None)
    lines = [ordering_line(key, scores.get(key, missing), t) for key in keys]
    lines += [starters_line(key, scores.get(key, missing)) for key in keys]
    lines += [
        coverage_line(f"{p}|{f}", coverage.get(f"{p}|{f}", Coverage(0, 0)), t) for p in SKILL_POSITIONS for f in FORMATS
    ]
    return lines


def verdict(lines: Sequence[GateLine]) -> bool:
    return bool(lines) and all(line.passed for line in lines)
