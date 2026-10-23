# ruff: noqa: PLR2004 - the expected values are the amendment's numbers and hand-made cases
"""Lane 157, `KDEF_WEEKLY` is Amendment 7 item 10 verbatim, each position's 12 lines are the ones it counts,
and every line passes at its threshold and fails just past it; a gate that cannot answer fails."""

from collections.abc import Callable

import pytest

from research.model.weekly2.gates import GateLine
from research.model.weekly_kdef import gates
from research.model.weekly_kdef.gates import DEVELOPMENT_CHECK, KDEF_WEEKLY, KdefWeekly
from research.model.weekly_kdef.statistics import Comparison, RangeShares

Lines = Callable[[Comparison, KdefWeekly], list[GateLine]]
_EPS = 1e-9
_CAVEAT = "the stamp caveat"


def test_the_constant_is_the_amendment_verbatim() -> None:
    t = KDEF_WEEKLY
    assert t.model_name == "commish_week_kdef_v1"
    assert (t.fit_seasons, t.judgment_season, t.weeks) == (tuple(range(2016, 2024)), 2024, tuple(range(3, 18)))
    assert (t.form_margin, t.sheet_margin, t.espn_margin) == (0.05, 0.02, 0.0)
    assert (t.calibration_low, t.calibration_high, t.median_low, t.median_high) == (0.06, 0.14, 0.44, 0.56)
    assert (t.starters, t.resamples, t.seed, t.draws, t.run_seed) == (12, 10_000, 42, 2_000, 2024)
    assert t.lower_percentile == pytest.approx(2.5)
    assert gates.LINES_PER_POSITION == 12 and gates.GATE_LINES == 24


def test_the_check_moves_only_its_seasons_and_its_seed() -> None:
    d = DEVELOPMENT_CHECK
    assert (d.fit_seasons, d.judgment_season, d.run_seed) == (tuple(range(2016, 2023)), 2023, 2023)
    assert d.weeks == KDEF_WEEKLY.weeks and d.form_margin == KDEF_WEEKLY.form_margin


@pytest.mark.parametrize(("lines", "margin"), [(gates.kd1_lines, 0.05), (gates.kd2_lines, 0.02)])
def test_kd1_and_kd2_pass_at_their_margin_and_bound_and_fail_past_them(lines: Lines, margin: float) -> None:
    at = lines(Comparison(margin, _EPS, 15), KDEF_WEEKLY)
    assert [x.passed for x in at] == [True, True]
    under = lines(Comparison(margin - _EPS, _EPS, 15), KDEF_WEEKLY)
    assert [x.passed for x in under] == [False, True]
    bound = lines(Comparison(margin + 0.1, 0.0, 15), KDEF_WEEKLY)
    assert [x.passed for x in bound] == [True, False]  # the bound must be above 0
    unanswered = lines(Comparison(None, None, 0), KDEF_WEEKLY)
    assert [x.passed for x in unanswered] == [False, False]


def test_kd3_is_a_point_comparison_at_zero_with_the_caveat_beside_it() -> None:
    at = gates.kd3_line(Comparison(0.0, -0.5, 15), KDEF_WEEKLY, _CAVEAT)
    assert at.passed and _CAVEAT in at.detail
    assert not gates.kd3_line(Comparison(-_EPS, 0.5, 15), KDEF_WEEKLY, _CAVEAT).passed
    assert not gates.kd3_line(Comparison(None, None, 0), KDEF_WEEKLY, _CAVEAT).passed


def test_kd4_needs_the_model_at_least_each_benchmark() -> None:
    lines = gates.kd4_lines({"model": 8.0, "sheet": 8.0, "espn": 8.0 + _EPS, "form": 7.0})
    assert [x.passed for x in lines] == [True, False, True]
    assert not any(x.passed for x in gates.kd4_lines({"model": None, "sheet": 1.0, "espn": 1.0, "form": 1.0}))
    assert [x.passed for x in gates.kd4_lines({"model": 8.0, "sheet": None, "espn": 1.0, "form": 1.0})] == [
        False,
        True,
        True,
    ]


@pytest.mark.parametrize(
    ("below", "above", "median", "passed"),
    [
        (0.06, 0.14, 0.44, (True, True, True)),
        (0.14, 0.06, 0.56, (True, True, True)),
        (0.06 - _EPS, 0.14 + _EPS, 0.44 - _EPS, (False, False, False)),
        (0.14 + _EPS, 0.06 - _EPS, 0.56 + _EPS, (False, False, False)),
    ],
)
def test_kd5_passes_inside_its_bands_inclusive_and_fails_past_them(
    below: float, above: float, median: float, passed: tuple[bool, ...]
) -> None:
    lines = gates.kd5_lines(RangeShares(below, above, median, 420), KDEF_WEEKLY)
    assert tuple(x.passed for x in lines) == passed
    assert not any(x.passed for x in gates.kd5_lines(RangeShares(None, None, None, 0), KDEF_WEEKLY))


def test_kd6_needs_every_reader_on_its_seasons_the_tables_unmoved_and_the_clause() -> None:
    allowed = {"inputs": range(2015, 2025), "outcomes": range(2013, 2025), "espn": (2024,)}
    served = {"inputs": [2015, 2024], "outcomes": [2013, 2024], "espn": [2024]}
    digests = {"model_artifacts": "1:a"}
    assert gates.isolation_line(served, allowed, digests, digests, (True, "held")).passed
    assert not gates.isolation_line({**served, "espn": [2025]}, allowed, digests, digests, (True, "held")).passed
    assert not gates.isolation_line(
        {**served, "outcomes": [2026]}, {**allowed, "outcomes": range(2013, 2027)}, digests, digests, (True, "")
    ).passed
    assert not gates.isolation_line(served, allowed, digests, {"model_artifacts": "2:b"}, (True, "held")).passed
    assert not gates.isolation_line(served, allowed, digests, digests, (False, "a read broke")).passed
    assert not gates.isolation_line(served, allowed, {}, {}, (True, "held")).passed


def test_the_stop_rule_reads_kd1_and_kd2_and_nothing_else() -> None:
    passing = [GateLine(g, "x", True, "") for g in ("KD1", "KD1", "KD2", "KD2", "KD3", "KD5")]
    assert not gates.stopped(passing)
    assert gates.stopped([*passing, GateLine("KD1", "lower bound vs recent form", False, "")])
    assert gates.stopped([*passing, GateLine("KD2", "pooled vs the streamer's sheet", False, "")])
    assert not gates.stopped([*passing, GateLine("KD5", "below the floor", False, "")])
    assert (
        gates.verdict(passing)
        and not gates.verdict([])
        and not gates.verdict([*passing, GateLine("KD3", "", False, "")])
    )
