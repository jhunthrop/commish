# ruff: noqa: PLR2004 - the expected values are the preregistration's numbers and hand-made cases
"""Round 4's constant is the preregistration's section 3.2 verbatim, its 34 lines are the ones 3.2
counts, and each line passes at its threshold and fails just past it."""

from types import MappingProxyType

import pytest

from research.model.weekly2.gates import ChanceBin, Difference, Ordering
from research.model.weekly4.gates import (
    DEVELOPMENT_CHECK,
    GATE_LINES,
    ROUND_FOUR,
    CellShares,
    calibration_lines,
    guard_line,
    isolation_line,
    ordering_lines,
    places_lines,
    verdict,
)


def test_the_constant_is_the_preregistration_verbatim() -> None:
    t = ROUND_FOUR
    assert t.model_name == "commish_weekly_v4"
    assert (t.player_fit_seasons, t.team_fit_seasons) == ((2021, 2022, 2023), tuple(range(2016, 2024)))
    assert (t.judgment_season, t.weeks, t.fit_weeks) == (2024, tuple(range(6, 18)), tuple(range(4, 18)))
    assert (t.adp_margin, t.form_margin, t.last_three_margin) == (0.04, 0.030, 0.030)
    assert (t.baseline_margin, t.round_three_margin, t.position_floor) == (0.015, 0.015, -0.02)
    assert dict(t.places_margins) == {"adp": 0.25, "form": 0.75, "baseline": 0.25}
    assert (t.calibration_low, t.calibration_high, t.median_low, t.median_high) == (0.06, 0.14, 0.44, 0.56)
    assert t.calibration_min_size == 100
    assert (t.chance_min_pairs, t.chance_tolerance, t.chance_min_bins) == (200, 0.04, 3)
    assert (t.resamples, t.seed) == (10_000, 42)
    assert t.lower_percentile == pytest.approx(100 * 0.05 / 3)
    assert (t.draws, t.run_seed) == (10_000, 2024)
    assert dict(t.population) == {"QB": 36, "RB": 72, "WR": 108, "TE": 36}
    assert dict(t.starters) == {"QB": 12, "RB": 24, "WR": 24, "TE": 12}
    assert GATE_LINES == 34


def test_the_statistics_view_carries_round_fours_numbers() -> None:
    s = ROUND_FOUR.statistics
    assert (s.lower_percentile, s.chance_tolerance, s.position_floor) == (
        ROUND_FOUR.lower_percentile,
        0.04,
        -0.02,
    )
    assert (s.resamples, s.seed, s.min_week_population) == (10_000, 42, 8)


def test_the_development_check_moves_only_the_seasons_and_the_seed() -> None:
    d = DEVELOPMENT_CHECK
    assert (d.player_fit_seasons, d.team_fit_seasons, d.judgment_season) == (
        (2021, 2022),
        tuple(range(2016, 2023)),
        2023,
    )
    assert (d.run_seed, d.adp_seasons) == (2023, (2023,))
    assert d.form_margin == ROUND_FOUR.form_margin


def _ordering(value: float, bound: float, each: float) -> Ordering:
    return Ordering(Difference(value, bound, 12), MappingProxyType(dict.fromkeys(("QB", "RB", "WR", "TE"), each)))


def test_an_ordering_passes_at_its_margin_and_fails_below() -> None:
    lines = ordering_lines("G2", "recent form", _ordering(0.030, 0.001, -0.02), ROUND_FOUR.form_margin)
    assert len(lines) == 5
    assert all(line.passed for line in lines)
    assert not ordering_lines("G2", "recent form", _ordering(0.0299, 0.001, 0.0), 0.030)[0].passed
    assert not ordering_lines("G2", "recent form", _ordering(0.05, 0.0, 0.0), 0.030)[0].passed
    assert not ordering_lines("G2", "recent form", _ordering(0.05, 0.01, -0.0201), 0.030)[1].passed


def test_a_point_guard_passes_at_its_margin() -> None:
    assert guard_line("G2", "pooled vs last three", 0.030, 0.030).passed
    assert not guard_line("G2", "pooled vs last three", 0.0299, 0.030).passed
    assert not guard_line("G7", "pooled vs round 3", None, 0.015).passed


def test_places_off_each_against_its_own_margin() -> None:
    lines = places_lines(10.0, {"adp": 10.25, "form": 10.75, "baseline": 10.25})
    assert [line.passed for line in lines] == [True, True, True]
    lines = places_lines(10.0, {"adp": 10.24, "form": 10.74, "baseline": None})
    assert [line.passed for line in lines] == [False, False, False]


def test_a_calibration_cell_needs_its_three_shares_inside_and_a_hundred_rows() -> None:
    inside = CellShares(0.06, 0.14, 0.44, 100)
    cells = {f"{p}|{f}": inside for p in ("QB", "RB", "WR", "TE") for f in ("ppr", "half", "std")}
    lines = calibration_lines(cells)
    assert len(lines) == 12
    assert all(line.passed for line in lines)
    for broken in (
        CellShares(0.059, 0.1, 0.5, 100),
        CellShares(0.1, 0.141, 0.5, 100),
        CellShares(0.1, 0.1, 0.561, 100),
    ):
        assert not calibration_lines({**cells, "QB|ppr": broken})[0].passed
    assert not calibration_lines({**cells, "QB|ppr": CellShares(0.1, 0.1, 0.5, 99)})[0].passed


def test_g5_needs_every_reader_on_its_seasons_and_the_tables_unchanged() -> None:
    d = DEVELOPMENT_CHECK
    same = {"model_artifacts": "1:a"}
    served = {"plays and teams": [2016, 2022], "players": [2021, 2022], "judged": [2023]}
    assert isolation_line(served, same, same, (True, "ok"), d).passed
    assert not isolation_line({**served, "judged": [2023, 2024]}, same, same, (True, "ok"), d).passed
    assert not isolation_line({**served, "players": [2021, 2023]}, same, same, (True, "ok"), d).passed
    assert not isolation_line({**served, "plays and teams": [2015, 2022]}, same, same, (True, "ok"), d).passed
    assert not isolation_line(served, same, {"model_artifacts": "2:b"}, (True, "ok"), d).passed
    assert not isolation_line(served, same, same, (False, "late"), d).passed


def test_the_verdict_needs_every_line() -> None:
    lines = places_lines(10.0, {"adp": 11.0, "form": 11.0, "baseline": 11.0})
    assert verdict(lines)
    assert not verdict([*lines, guard_line("G7", "pooled vs round 3", 0.0, 0.015)])
    assert not verdict([])


def test_the_chance_bins_are_round_threes() -> None:
    assert ROUND_FOUR.statistics.chance_bins == ((0.5, 0.6), (0.6, 0.7), (0.7, 0.8), (0.8, 0.9), (0.9, 1.0))
    assert ChanceBin(0.5, 0.6, 200, 0.55, 0.59).pairs == 200
