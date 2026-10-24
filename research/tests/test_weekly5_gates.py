# ruff: noqa: PLR2004 - the preregistered thresholds, each tested at its edge
"""Round 5's gates (Lane 168; preregistration 3.2): every threshold of `ROUND_FIVE` tested at its edge, the 34
lines, decision (a)'s line-by-line join of the two spreadsheets, decision (b)'s shared margin, G5's readers and
tables, and the stop rule's two lines."""

from dataclasses import replace
from types import MappingProxyType

import pytest

from research.model.weekly2.gates import ChanceBin, Difference, GateLine, Ordering
from research.model.weekly4.gates import CellShares
from research.model.weekly5 import decisions, gates
from research.model.weekly5.gates import DEVELOPMENT_CHECK, GATE_LINES, ROUND_FIVE
from research.model.weekly5.judgment import Comparison, gate_lines

POSITIONS = ("QB", "RB", "WR", "TE")


def ordering(value: float | None, bound: float | None, each: float | None = 0.0) -> Ordering:
    return Ordering(Difference(value, bound, 12), MappingProxyType(dict.fromkeys(POSITIONS, each)))


def test_the_constant_holds_the_preregistered_numbers() -> None:
    t = ROUND_FIVE
    assert t.model_name == "commish_weekly_v5"
    assert (t.player_fit_seasons, t.judgment_season, t.weeks) == ((2021, 2022, 2023), 2024, tuple(range(6, 18)))
    assert t.team_fit_seasons == tuple(range(2016, 2024)) and t.fit_weeks == tuple(range(4, 18))
    assert dict(t.population) == {"QB": 36, "RB": 72, "WR": 108, "TE": 36}
    assert dict(t.starters) == {"QB": 12, "RB": 24, "WR": 24, "TE": 12}
    assert (t.min_week_population, t.adp_source) == (8, "ffc_adp_ppr_12")
    assert (t.adp_margin, t.form_margin, t.last_three_margin, t.sheet_margin, t.round_three_margin) == (
        0.04, 0.030, 0.030, 0.015, 0.015,
    )  # fmt: skip
    assert t.position_floor == -0.02
    assert dict(t.places_margins) == {"adp": 0.25, "form": 0.75, "sheet": 0.25}
    assert (t.calibration_low, t.calibration_high, t.median_low, t.median_high) == (0.06, 0.14, 0.44, 0.56)
    assert (t.calibration_min_size, t.band_percentiles) == (100, (10.0, 50.0, 90.0))
    assert (t.chance_min_pairs, t.chance_tolerance, t.chance_min_bins) == (200, 0.04, 3)
    assert (t.resamples, t.seed) == (10_000, 42)
    assert t.lower_percentile == pytest.approx(1.6667, abs=1e-4)
    assert t.spreadsheets == "both" and t.gated_sheets == ("sheet", "damped")


def test_the_check_is_the_same_code_one_season_earlier() -> None:
    t = DEVELOPMENT_CHECK
    assert (t.player_fit_seasons, t.judgment_season, t.band_seasons) == ((2021, 2022), 2023, (2022,))
    assert t.team_fit_seasons == tuple(range(2016, 2023))
    assert ROUND_FIVE.band_seasons == (2022, 2023)
    assert t.round_three.judgment_season == 2023 and ROUND_FIVE.round_three.judgment_season == 2024


def test_the_founder_decisions_default_as_written() -> None:
    assert decisions.SPREADSHEETS == "both"
    assert decisions.FORM_MARGIN == 0.030
    assert ROUND_FIVE.form_margin == ROUND_FIVE.last_three_margin == decisions.FORM_MARGIN


@pytest.mark.parametrize(
    ("value", "bound", "passed"),
    [(0.04, 0.0001, True), (0.0399, 0.01, False), (0.05, 0.0, False), (0.05, -0.01, False)],
)
def test_g1_pooled_needs_its_margin_and_a_bound_above_zero(value: float, bound: float, passed: bool) -> None:
    line = gates.ordering_lines("G1", "ADP", ordering(value, bound), ROUND_FIVE.adp_margin, ROUND_FIVE)[0]
    assert line.subject == "pooled vs ADP" and line.passed is passed


@pytest.mark.parametrize(("each", "passed"), [(-0.02, True), (-0.0201, False)])
def test_each_position_holds_the_floor(each: float, passed: bool) -> None:
    lines = gates.ordering_lines("G2", "recent form", ordering(0.1, 0.01, each), ROUND_FIVE.form_margin, ROUND_FIVE)
    assert [line.passed for line in lines[1:]] == [passed] * 4


@pytest.mark.parametrize(("value", "passed"), [(0.030, True), (0.0299, False)])
def test_g2_pooled_and_its_last_three_guard_share_decision_b(value: float, passed: bool) -> None:
    pooled = gates.ordering_lines("G2", "recent form", ordering(value, 0.01), ROUND_FIVE.form_margin, ROUND_FIVE)[0]
    guard = gates.guard_line("G2", "pooled vs last-three form", value, ROUND_FIVE.last_three_margin)
    assert pooled.passed is passed and guard.passed is passed


@pytest.mark.parametrize(("value", "passed"), [(0.015, True), (0.0149, False), (None, False)])
def test_g7_is_a_point_comparison_at_its_margin(value: float | None, passed: bool) -> None:
    assert gates.guard_line("G7", "pooled vs round 3's number", value, ROUND_FIVE.round_three_margin).passed is passed


def test_g6_passes_a_line_only_against_both_sheets() -> None:
    both = gates.sheet_lines({"sheet": ordering(0.015, 0.001), "damped": ordering(0.02, 0.001)}, ROUND_FIVE)
    assert [line.subject for line in both] == [
        "pooled vs the spreadsheets", *(f"{p} vs the spreadsheets" for p in POSITIONS),
    ]  # fmt: skip
    assert all(line.passed for line in both)
    assert "the preregistered spreadsheet: " in both[0].detail and "the damped spreadsheet: " in both[0].detail
    one = gates.sheet_lines({"sheet": ordering(0.03, 0.001), "damped": ordering(0.0149, 0.001)}, ROUND_FIVE)
    assert not one[0].passed and all(line.passed for line in one[1:])
    floor = gates.sheet_lines({"sheet": ordering(0.03, 0.001, -0.03), "damped": ordering(0.03, 0.001)}, ROUND_FIVE)
    assert floor[0].passed and not any(line.passed for line in floor[1:])


@pytest.mark.parametrize(
    ("choice", "label"), [("preregistered", "the preregistered spreadsheet"), ("damped", "the damped spreadsheet")]
)
def test_under_one_sheet_the_other_is_reported_only(choice: str, label: str) -> None:
    t = replace(ROUND_FIVE, spreadsheets=choice)  # type: ignore[arg-type]
    other = "damped" if choice == "preregistered" else "sheet"
    mine = "sheet" if choice == "preregistered" else "damped"
    lines = gates.sheet_lines({mine: ordering(0.02, 0.001), other: ordering(-0.5, -0.5)}, t)
    assert lines[0].subject == f"pooled vs {label}" and all(line.passed for line in lines)
    places = gates.places_lines(3.0, {"adp": 4.0, "form": 4.0, mine: 3.25, other: 1.0}, t)
    assert places[2].subject == f"places off vs {label}" and places[2].passed


@pytest.mark.parametrize(
    ("benches", "passed"),
    [
        ({"adp": 3.25, "form": 3.75, "sheet": 3.25, "damped": 3.25}, [True, True, True]),
        ({"adp": 3.2499, "form": 3.7499, "sheet": 3.25, "damped": 3.2499}, [False, False, False]),
        ({"adp": 3.25, "form": 3.75, "sheet": 3.2499, "damped": 4.0}, [True, True, False]),
    ],
)
def test_g3_margins_and_its_spreadsheet_line_against_both(benches: dict[str, float], passed: list[bool]) -> None:
    lines = gates.places_lines(3.0, benches, ROUND_FIVE)
    assert [line.passed for line in lines] == passed
    assert lines[2].subject == "places off vs the spreadsheets"


def _cells(**changes: float | int) -> dict[str, CellShares]:
    base = {"below": 0.10, "above": 0.10, "below_median": 0.50, "size": 100}
    cell = CellShares(**{**base, **changes})  # type: ignore[arg-type]
    return {f"{p}|{n}": cell for p in POSITIONS for n in ("ppr", "half", "std")}


@pytest.mark.parametrize(
    ("changes", "passed"),
    [
        ({}, True),
        ({"below": 0.06, "above": 0.14}, True),
        ({"below": 0.0599}, False),
        ({"above": 0.1401}, False),
        ({"below_median": 0.44}, True),
        ({"below_median": 0.56}, True),
        ({"below_median": 0.4399}, False),
        ({"below_median": 0.5601}, False),
        ({"size": 99}, False),
    ],
)
def test_g4_cells_at_their_edges(changes: dict[str, float | int], passed: bool) -> None:
    lines = gates.calibration_lines(_cells(**changes), ROUND_FIVE)
    assert len(lines) == 12 and all(line.passed is passed for line in lines)


def _bins(observed: float, pairs: int = 200, count: int = 3) -> list[ChanceBin]:
    lows = (0.5, 0.6, 0.7, 0.8, 0.9)
    return [
        ChanceBin(low, low + 0.1, pairs if i < count else 0, low + 0.05, observed + low) for i, low in enumerate(lows)
    ]


@pytest.mark.parametrize(
    ("bins", "passed"),
    [(_bins(0.0899), True), (_bins(0.0901), False), (_bins(0.05, pairs=199), False), (_bins(0.05, count=2), False)],
)
def test_the_chance_line_at_its_tolerance_and_counts(bins: list[ChanceBin], passed: bool) -> None:
    assert gates.chance_line(bins, ROUND_FIVE).passed is passed


def _comparison() -> Comparison:
    against = {k: ordering(0.1, 0.01) for k in ("adp", "form", "last_three", "sheet", "damped", "round_three")}
    places = {"model": 1.0, "adp": 3.0, "form": 3.0, "sheet": 3.0, "damped": 3.0}
    return Comparison({}, against, places)


def test_thirty_four_lines_with_g5() -> None:
    lines = gate_lines(_comparison(), _cells(), [], ROUND_FIVE)
    g5 = gates.isolation_line(
        {gates.PLAYS_AND_TEAMS: (2016,), gates.PLAYERS: (2021,), gates.JUDGED: (2024,)},
        {"t": "1"},
        {"t": "1"},
        (True, "ok"),
        ROUND_FIVE,
    )
    counts = {g: sum(1 for x in [*lines, g5] if x.gate == g) for g in ("G1", "G2", "G6", "G7", "G3", "G4", "G5")}
    assert counts == {"G1": 5, "G2": 6, "G6": 5, "G7": 1, "G3": 3, "G4": 13, "G5": 1}
    assert len([*lines, g5]) == GATE_LINES == 34


@pytest.mark.parametrize(
    ("served", "before", "after", "passed"),
    [
        ({"plays and teams": (2016, 2023), "players": (2021, 2023), "judged": (2024,)}, {"t": "a"}, {"t": "a"}, True),
        ({"plays and teams": (2016, 2024), "players": (2021,), "judged": (2024,)}, {"t": "a"}, {"t": "a"}, False),
        ({"plays and teams": (2016,), "players": (2020,), "judged": (2024,)}, {"t": "a"}, {"t": "a"}, False),
        ({"plays and teams": (2016,), "players": (2021,), "judged": (2025,)}, {"t": "a"}, {"t": "a"}, False),
        ({"plays and teams": (2016,), "players": (2021,), "judged": (2024,)}, {"t": "a"}, {"t": "b"}, False),
        ({"plays and teams": (2016,), "players": (2021,)}, {"t": "a"}, {"t": "a"}, False),
    ],
)
def test_g5_readers_and_tables(
    served: dict[str, tuple[int, ...]], before: dict[str, str], after: dict[str, str], passed: bool
) -> None:
    assert gates.isolation_line(served, before, after, (True, "ok"), ROUND_FIVE).passed is passed
    assert not gates.isolation_line(served, before, after, (False, "broken"), ROUND_FIVE).passed


@pytest.mark.parametrize("bound", [0.0, -0.001])
def test_the_stop_rule_fires_on_a_pooled_line_at_its_margin_with_no_bound_above_zero(bound: float) -> None:
    """Reading 13 end to end: a G2 or G6 pooled line meeting its margin with its bound at or below 0 stops."""
    passing = ordering(0.05, 0.01)
    g2 = gates.ordering_lines("G2", "recent form", ordering(0.05, bound), ROUND_FIVE.form_margin, ROUND_FIVE)
    g6 = gates.sheet_lines({"sheet": passing, "damped": passing}, ROUND_FIVE)
    assert gates.stopping([*g2, *g6]) == ["G2 pooled vs recent form"]
    g2 = gates.ordering_lines("G2", "recent form", passing, ROUND_FIVE.form_margin, ROUND_FIVE)
    g6 = gates.sheet_lines({"sheet": passing, "damped": ordering(0.05, bound)}, ROUND_FIVE)
    assert gates.stopping([*g2, *g6]) == ["pooled vs the spreadsheets"]


def test_the_stop_rule_reads_g2_pooled_and_g6_pooled_only() -> None:
    lines = [
        GateLine("G2", "pooled vs recent form", True, ""),
        GateLine("G6", "pooled vs the spreadsheets", True, ""),
        GateLine("G4", "QB ppr", False, ""),
    ]
    assert gates.stopping(lines) == []
    assert gates.stopping([replace(lines[0], passed=False), *lines[1:]]) == ["G2 pooled vs recent form"]
    assert gates.stopping([lines[0], replace(lines[1], passed=False)]) == ["pooled vs the spreadsheets"]
    assert gates.stopping(lines[2:]) == ["G2 pooled vs recent form", "G6 pooled"]
