"""THE ROUND'S GATES, AS ONE CONSTANT: `ROUND_FOUR`, and the 34 lines it gates.

`docs/research/2026-10-16-weekly-projection-round4-preregistration.md` (the lock `b56c05d8`, amended
in section 7) is the authority. Section 3.2: "Thresholds in one constant (`ROUND_FOUR` in the
round's `gates.py`), with a test at each threshold." The lines: G1 5, G2 5, the last-three guard 1,
G6 5, G7 1, G3 3, G4 13 (12 cells, each with its floor, ceiling and median shares, and the chance
line), G5 1: 34. A gate that cannot answer fails.

The statistics (Spearman per week and position, the week-block bootstrap, the chance bins) are round
2's functions, read through `statistics`, a round 2 `Thresholds` carrying round 4's numbers.
"""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass, replace
from types import MappingProxyType
from typing import Final

from research.model.ros.outcomes import PRISTINE_SEASON
from research.model.weekly.round.scoring import FORMATS, SKILL_POSITIONS
from research.model.weekly2 import gates as round_two
from research.model.weekly2.gates import GateLine, Ordering, Thresholds
from research.model.weekly3 import gates as round_three

FROZEN: Final = MappingProxyType
GATE_LINES: Final = 34  # 3.2: "G1 5, G2 5, the last-three guard 1, G6 5, G7 1, G3 3, G4 13 ..., G5 1: 34"
COMPARISONS: Final = 3  # 3.2, "Multiple comparisons": pooled G1, G2 and G6 are bootstrapped
ONE_SIDED: Final = 0.05


@dataclass(frozen=True, slots=True)
class RoundFour:
    model_name: str
    # 2.6, "Fit windows, settled": the player-level models on 2021 to 2023 weeks 4 to 17, the play
    # and team models on 2016 to 2023; 3.1: the judgment on 2024 weeks 6 to 17.
    player_fit_seasons: tuple[int, ...]
    team_fit_seasons: tuple[int, ...]
    judgment_season: int
    weeks: tuple[int, ...]
    fit_weeks: tuple[int, ...]
    # 3.1, "Population and statistics" (round 3's, unchanged).
    population: Mapping[str, int]
    starters: Mapping[str, int]
    min_week_population: int
    adp_source: str
    adp_seasons: tuple[int, ...]
    # 3.2, the gates.
    adp_margin: float
    form_margin: float
    last_three_margin: float
    baseline_margin: float
    round_three_margin: float
    position_floor: float
    places_margins: Mapping[str, float]
    calibration_low: float
    calibration_high: float
    median_low: float
    median_high: float
    calibration_min_size: int
    band_percentiles: tuple[float, float, float]
    chance_bins: tuple[tuple[float, float], ...]
    chance_min_pairs: int
    chance_tolerance: float
    chance_min_bins: int
    # 3.1 and 3.2: 10,000 week-block resamples, `default_rng(42)`, the 1.667th percentile.
    resamples: int
    seed: int
    lower_percentile: float
    # 2.6, the simulation: 10,000 draws, run_seed 2023 for the check and 2024 for the judgment.
    draws: int
    run_seed: int
    # Round 3's number (G7) and its rate m: round 3's own constant for the same seasons.
    round_three: Thresholds

    @property
    def statistics(self) -> Thresholds:
        """Round 2's `Thresholds` with round 4's population, statistics and chance numbers, for
        round 2's statistics functions."""
        return replace(
            self.round_three,
            population=self.population,
            starters=self.starters,
            min_week_population=self.min_week_population,
            position_floor=self.position_floor,
            chance_bins=self.chance_bins,
            chance_min_pairs=self.chance_min_pairs,
            chance_tolerance=self.chance_tolerance,
            chance_min_bins=self.chance_min_bins,
            resamples=self.resamples,
            seed=self.seed,
            lower_percentile=self.lower_percentile,
            band_percentiles=self.band_percentiles,
        )


ROUND_FOUR: Final = RoundFour(
    model_name="commish_weekly_v4",
    player_fit_seasons=(2021, 2022, 2023),
    team_fit_seasons=tuple(range(2016, 2024)),
    judgment_season=2024,
    weeks=tuple(range(6, 18)),
    fit_weeks=tuple(range(4, 18)),  # 2.6: "Weeks 4 and 5 add fit rows without adding a judged week"
    population=FROZEN({"QB": 36, "RB": 72, "WR": 108, "TE": 36}),
    starters=FROZEN({"QB": 12, "RB": 24, "WR": 24, "TE": 12}),
    min_week_population=8,
    adp_source="ffc_adp_ppr_12",
    adp_seasons=(2023, 2024),
    # 3.2: G1 >= +0.04; G2 >= +0.030; the last-three guard >= +0.030; G6 >= +0.015; G7 >= +0.015;
    # each position >= -0.02.
    adp_margin=0.04,
    form_margin=0.030,
    last_three_margin=0.030,
    baseline_margin=0.015,
    round_three_margin=0.015,
    position_floor=-0.02,
    # 3.2, G3: "at least 0.25 fewer than ADP's, 0.75 fewer than form's and 0.25 fewer than the
    # baseline's".
    places_margins=FROZEN({"adp": 0.25, "form": 0.75, "baseline": 0.25}),
    # 3.2, G4: below the floor and above the ceiling each within [0.06, 0.14], below the median
    # within [0.44, 0.56], n >= 100; floor, median, ceiling the 10th, 50th, 90th percentiles (2.6).
    calibration_low=0.06,
    calibration_high=0.14,
    median_low=0.44,
    median_high=0.56,
    calibration_min_size=100,
    band_percentiles=(10.0, 50.0, 90.0),
    # 3.2, G4's chance line: bins of at least 200 pairs within +-0.04, at least three gated.
    chance_bins=((0.5, 0.6), (0.6, 0.7), (0.7, 0.8), (0.8, 0.9), (0.9, 1.0)),
    chance_min_pairs=200,
    chance_tolerance=0.04,
    chance_min_bins=3,
    resamples=10_000,
    seed=42,
    lower_percentile=100 * ONE_SIDED / COMPARISONS,  # "the 1.667th percentile (one-sided 0.05 / 3)"
    draws=10_000,
    run_seed=2024,
    round_three=round_three.ROUND_THREE,
)

# 3.1, "Development check: 2023 weeks 6 to 17, player-level fit 2021 and 2022, play and team models
# 2016 to 2022, identical code, once"; 2.6: run_seed 2023 for the development check.
DEVELOPMENT_CHECK: Final = replace(
    ROUND_FOUR,
    player_fit_seasons=(2021, 2022),
    team_fit_seasons=tuple(range(2016, 2023)),
    judgment_season=2023,
    adp_seasons=(2023,),
    run_seed=2023,
    round_three=round_three.DEVELOPMENT_CHECK,
)


def ordering_lines(gate: str, bench: str, found: Ordering, margin: float) -> list[GateLine]:
    """G1, G2 or G6: round 2's five lines, the pooled margin with its bound above zero and each
    position at the floor."""
    return round_two.ordering_lines(gate, bench, found, margin, ROUND_FOUR.statistics)


def guard_line(gate: str, subject: str, value: float | None, margin: float) -> GateLine:
    """A point comparison (the last-three guard, G7): the pooled difference at its margin."""
    if value is None:
        return GateLine(gate, subject, False, "cannot answer: no week where all four positions answer")
    detail = f"difference {value:+.4f} against a margin of {margin:+.4f} (a point comparison)"
    return GateLine(gate, subject, value >= margin, detail)


_PLACES_LABELS: Final = (("adp", "ADP"), ("form", "recent form"), ("baseline", "the expert's spreadsheet"))


def places_lines(model: float | None, benches: Mapping[str, float | None]) -> list[GateLine]:
    """G3: the model's pooled places off at least each benchmark's margin fewer than its own."""
    lines: list[GateLine] = []
    for bench, label in _PLACES_LABELS:
        found = benches.get(bench)
        margin = ROUND_FOUR.places_margins[bench]
        if model is None or found is None:
            lines.append(GateLine("G3", f"places off vs {label}", False, "cannot answer: no starter scored"))
            continue
        lead = found - model
        detail = f"model {model:.3f}, {label} {found:.3f}: {lead:+.3f} fewer against a margin of {margin}"
        lines.append(GateLine("G3", f"places off vs {label}", lead >= margin, detail))
    return lines


@dataclass(frozen=True, slots=True)
class CellShares:
    """One G4 cell: the shares of outcomes below the floor, above the ceiling and below the median."""

    below: float | None
    above: float | None
    below_median: float | None
    size: int


def _inside(value: float, low: float, high: float) -> bool:
    return low <= value <= high


def calibration_lines(cells: Mapping[str, CellShares]) -> list[GateLine]:
    """G4's twelve cells, each with n >= 100: floor and ceiling shares in [0.06, 0.14], the median's
    in [0.44, 0.56]."""
    t = ROUND_FOUR
    lines: list[GateLine] = []
    for position in SKILL_POSITIONS:
        for name in FORMATS:
            cell = cells.get(f"{position}|{name}", CellShares(None, None, None, 0))
            subject = f"{position} {name}"
            if (
                cell.below is None
                or cell.above is None
                or cell.below_median is None
                or cell.size < t.calibration_min_size
            ):
                lines.append(GateLine("G4", subject, False, f"cannot answer: {cell.size} player-weeks"))
                continue
            passed = (
                _inside(cell.below, t.calibration_low, t.calibration_high)
                and _inside(cell.above, t.calibration_low, t.calibration_high)
                and _inside(cell.below_median, t.median_low, t.median_high)
            )
            detail = (
                f"below floor {cell.below:.3f}, above ceiling {cell.above:.3f}, each against "
                f"[{t.calibration_low}, {t.calibration_high}]; below median {cell.below_median:.3f} against "
                f"[{t.median_low}, {t.median_high}]; n={cell.size}"
            )
            lines.append(GateLine("G4", subject, passed, detail))
    return lines


def chance_line(bins: Sequence[round_two.ChanceBin]) -> GateLine:
    """G4's chance line: round 2's rule at round 4's tolerance of 0.04."""
    return round_two.chance_line(bins, ROUND_FOUR.statistics)


PLAYS_AND_TEAMS: Final = "plays and teams"
PLAYERS: Final = "players"
JUDGED: Final = "judged"


def _allowed(name: str, t: RoundFour) -> frozenset[int]:
    if name == PLAYS_AND_TEAMS:
        return frozenset(t.team_fit_seasons)
    if name == PLAYERS:
        return frozenset(t.player_fit_seasons)
    return frozenset({t.judgment_season})


def isolation_line(
    served: Mapping[str, Sequence[int]],
    before: Mapping[str, str],
    after: Mapping[str, str],
    per_game: tuple[bool, str],
    t: RoundFour,
) -> GateLine:
    """G5: each outcome reader on its seasons only (the play and team fits, the player fits, the
    judged season), none after the judgment season or the pristine one, the five tables as they
    were, and the per-game clause."""
    strays = {
        name: sorted(s for s in seasons if s not in _allowed(name, t) or s >= PRISTINE_SEASON)
        for name, seasons in served.items()
    }
    stray = {name: found for name, found in strays.items() if found}
    moved = sorted(table for table in before if before[table] != after.get(table))
    held, detail = per_game
    passed = (
        not stray
        and set(served) == {PLAYS_AND_TEAMS, PLAYERS, JUDGED}
        and not moved
        and bool(before)
        and set(before) == set(after)
        and held
    )
    readers = "; ".join(f"{name} outcomes read for {sorted(set(seasons))}" for name, seasons in sorted(served.items()))
    tables = "every table as it was" if not moved else f"moved: {', '.join(moved)}"
    strayed = "" if not stray else f"; outside their seasons: {stray}"
    return GateLine("G5", "isolation", passed, f"{readers}{strayed}; {tables}; per-game clause: {detail}")


verdict = round_two.verdict
