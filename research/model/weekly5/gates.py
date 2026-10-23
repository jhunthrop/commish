"""THE ROUND'S GATES, AS ONE CONSTANT: `ROUND_FIVE`, and the 34 lines it gates.

`docs/research/2026-10-26-weekly-projection-round5-preregistration.md` is the authority. Section 3.2:
"Thresholds in one constant (`ROUND_FIVE` in `research/model/weekly5/gates.py`), with a test at each
threshold. The model name is `commish_weekly_v5`." The lines: G1 5, G2 5, the last-three guard 1, G6 5,
G7 1, G3 3, G4 13, G5 1: 34. A gate that cannot answer fails. Each pooled line carries its point margin
and its lower bound together.

Decision (a) (`decisions.SPREADSHEETS`): under "both" each G6 line and G3's spreadsheet line pass only if
they pass against the preregistered sheet and the damped one, line by line, each value printed; under one
sheet, that sheet alone. Decision (b) (`decisions.FORM_MARGIN`): G2 pooled's margin and the last-three
guard's together; G7 stays +0.015.

The statistics (Spearman per week and position, the week-block bootstrap, the chance bins) are round 2's,
read through `statistics`, a round 2 `Thresholds` carrying round 5's numbers.
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
from research.model.weekly5 import decisions
from research.model.weekly5.decisions import Spreadsheets

FROZEN: Final = MappingProxyType
GATE_LINES: Final = 34  # 3.2: "G1 5, G2 5, the last-three guard 1, G6 5, G7 1, G3 3, G4 13, G5 1: 34"
COMPARISONS: Final = 3  # 3.2, "Multiple comparisons": pooled G1, G2 and G6
ONE_SIDED: Final = 0.05
SHEETS: Final = ("sheet", "damped")  # the preregistered spreadsheet and the damped one (3.1)
SHEET_LABELS: Final = FROZEN({"sheet": "the preregistered spreadsheet", "damped": "the damped spreadsheet"})


@dataclass(frozen=True, slots=True)
class RoundFive:
    model_name: str
    # 2.11: the player-level fits on 2021 to 2023 (weeks 4 to 17, lined rows), the play and team models on
    # 2016 to 2023, the residual bands on 2022 and 2023; 3.1: the judgment on 2024 weeks 6 to 17.
    player_fit_seasons: tuple[int, ...]
    team_fit_seasons: tuple[int, ...]
    judgment_season: int
    weeks: tuple[int, ...]
    fit_weeks: tuple[int, ...]
    # 3.1, population and statistics (round 3's, unchanged).
    population: Mapping[str, int]
    starters: Mapping[str, int]
    min_week_population: int
    adp_source: str
    adp_seasons: tuple[int, ...]
    # 3.2, the gates.
    adp_margin: float
    form_margin: float
    last_three_margin: float
    sheet_margin: float
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
    # Decision (a): the sheets G6 and G3's spreadsheet line are judged against.
    spreadsheets: Spreadsheets
    # Round 3's number (G7) and its population: round 3's own constant for the same seasons.
    round_three: Thresholds

    @property
    def statistics(self) -> Thresholds:
        """Round 2's `Thresholds` with round 5's population, statistics and chance numbers."""
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

    @property
    def band_seasons(self) -> tuple[int, ...]:
        """2.9: the player fit seasons after the first (2022 for the check, 2022 and 2023 for the judgment)."""
        return self.player_fit_seasons[1:]

    @property
    def gated_sheets(self) -> tuple[str, ...]:
        """Decision (a): the sheets each G6 line and G3's spreadsheet line must pass against."""
        if self.spreadsheets == "both":
            return SHEETS
        return ("sheet",) if self.spreadsheets == "preregistered" else ("damped",)


ROUND_FIVE: Final = RoundFive(
    model_name="commish_weekly_v5",
    player_fit_seasons=(2021, 2022, 2023),
    team_fit_seasons=tuple(range(2016, 2024)),
    judgment_season=2024,
    weeks=tuple(range(6, 18)),
    fit_weeks=tuple(range(4, 18)),  # 2.11: "weeks 4 to 17, lined rows"
    population=FROZEN({"QB": 36, "RB": 72, "WR": 108, "TE": 36}),
    starters=FROZEN({"QB": 12, "RB": 24, "WR": 24, "TE": 12}),
    min_week_population=8,
    adp_source="ffc_adp_ppr_12",
    adp_seasons=(2023, 2024),
    # 3.2: G1 >= +0.04; G2 and its last-three guard >= decision (b); G6 >= +0.015; G7 >= +0.015;
    # each position >= -0.02.
    adp_margin=0.04,
    form_margin=decisions.FORM_MARGIN,
    last_three_margin=decisions.FORM_MARGIN,
    sheet_margin=0.015,
    round_three_margin=0.015,
    position_floor=-0.02,
    # 3.2, G3: at least 0.25 fewer places off than ADP's, 0.75 fewer than form's, 0.25 fewer than each sheet's.
    places_margins=FROZEN({"adp": 0.25, "form": 0.75, "sheet": 0.25}),
    # 3.2, G4: below the floor and above the ceiling each within [0.06, 0.14], below the median within
    # [0.44, 0.56], each cell with n >= 100; floor, median, ceiling the 10th, 50th, 90th percentiles (2.9).
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
    spreadsheets=decisions.SPREADSHEETS,
    round_three=round_three.ROUND_THREE,
)

# 3.1 and 2.11: "Development check: 2023 weeks 6 to 17, once, before the judgment, identical code": the
# player-level fits on 2021 to 2022, the play and team models on 2016 to 2022, the bands on 2022.
DEVELOPMENT_CHECK: Final = replace(
    ROUND_FIVE,
    player_fit_seasons=(2021, 2022),
    team_fit_seasons=tuple(range(2016, 2023)),
    judgment_season=2023,
    adp_seasons=(2023,),
    round_three=round_three.DEVELOPMENT_CHECK,
)

G2_POOLED: Final = ("G2", "pooled vs recent form")
G6_POOLED: Final = "G6"  # its pooled line's subject names the sheets it is judged against


def ordering_lines(gate: str, bench: str, found: Ordering, margin: float, t: RoundFive) -> list[GateLine]:
    """G1, G2 or one sheet's G6: round 2's five lines, the pooled margin with its bound above zero and each
    position at the floor."""
    return round_two.ordering_lines(gate, bench, found, margin, t.statistics)


def _joined(gate: str, per_sheet: Mapping[str, Sequence[GateLine]], sheets: Sequence[str]) -> list[GateLine]:
    """Line by line, each passing only if it passes against every named sheet, every value printed."""
    first = per_sheet[sheets[0]]
    lines: list[GateLine] = []
    for i, line in enumerate(first):
        parts = [per_sheet[s][i] for s in sheets]
        subject = line.subject.replace(SHEET_LABELS[sheets[0]], "the spreadsheets") if len(sheets) > 1 else line.subject
        detail = "; ".join(f"{SHEET_LABELS[s]}: {p.detail}" for s, p in zip(sheets, parts, strict=True))
        lines.append(GateLine(gate, subject, all(p.passed for p in parts), detail))
    return lines


def sheet_lines(against: Mapping[str, Ordering], t: RoundFive) -> list[GateLine]:
    """G6's five lines against the decision's sheets (3.1, decision (a))."""
    per_sheet = {s: ordering_lines("G6", SHEET_LABELS[s], against[s], t.sheet_margin, t) for s in t.gated_sheets}
    return _joined("G6", per_sheet, t.gated_sheets)


def guard_line(gate: str, subject: str, value: float | None, margin: float) -> GateLine:
    """A point comparison (the last-three guard, G7): the pooled difference at its margin."""
    if value is None:
        return GateLine(gate, subject, False, "cannot answer: no week where all four positions answer")
    detail = f"difference {value:+.4f} against a margin of {margin:+.4f} (a point comparison)"
    return GateLine(gate, subject, value >= margin, detail)


def _places(model: float | None, found: float | None, label: str, margin: float) -> GateLine:
    if model is None or found is None:
        return GateLine("G3", f"places off vs {label}", False, "cannot answer: no starter scored")
    lead = found - model
    detail = f"model {model:.3f}, {label} {found:.3f}: {lead:+.3f} fewer against a margin of {margin}"
    return GateLine("G3", f"places off vs {label}", lead >= margin, detail)


def places_lines(model: float | None, benches: Mapping[str, float | None], t: RoundFive) -> list[GateLine]:
    """G3: the model's pooled places off at least each benchmark's margin fewer; the spreadsheet line
    against the decision's sheets."""
    m = t.places_margins
    lines = [
        _places(model, benches.get("adp"), "ADP", m["adp"]),
        _places(model, benches.get("form"), "recent form", m["form"]),
    ]
    per_sheet = {s: [_places(model, benches.get(s), SHEET_LABELS[s], m["sheet"])] for s in t.gated_sheets}
    return [*lines, *_joined("G3", per_sheet, t.gated_sheets)]


@dataclass(frozen=True, slots=True)
class CellShares:
    """One G4 cell: the shares of outcomes below the floor, above the ceiling and below the median."""

    below: float | None
    above: float | None
    below_median: float | None
    size: int


def _inside(value: float, low: float, high: float) -> bool:
    return low <= value <= high


def calibration_lines(cells: Mapping[str, CellShares], t: RoundFive) -> list[GateLine]:
    """G4's twelve cells, each with n >= 100: floor and ceiling shares in [0.06, 0.14], the median's in
    [0.44, 0.56]."""
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


def chance_line(bins: Sequence[round_two.ChanceBin], t: RoundFive) -> GateLine:
    """G4's chance line: round 2's rule at round 5's tolerance of 0.04."""
    return round_two.chance_line(bins, t.statistics)


PLAYS_AND_TEAMS: Final = "plays and teams"
PLAYERS: Final = "players"
JUDGED: Final = "judged"


def _allowed(name: str, t: RoundFive) -> frozenset[int]:
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
    t: RoundFive,
) -> GateLine:
    """G5: each outcome reader on its seasons only (the play and team fits, the player fits, the judged
    season), none after the judged season or the pristine one, the six tables as they were, and the
    per-game clause."""
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


def stopping(lines: Sequence[GateLine]) -> list[str]:
    """The stop rule's lines (3.2) that fail: G2 pooled and G6 pooled, each with its bound (reading 13).
    A missing line is a failure."""
    failed = []
    g2 = [x for x in lines if (x.gate, x.subject) == G2_POOLED]
    if not g2 or not all(x.passed for x in g2):
        failed.append(f"{G2_POOLED[0]} {G2_POOLED[1]}")
    g6 = [x for x in lines if x.gate == G6_POOLED and x.subject.startswith("pooled vs")]
    if not g6 or not all(x.passed for x in g6):
        failed.append(g6[0].subject if g6 else "G6 pooled")
    return failed


verdict = round_two.verdict
