# ruff: noqa: PLR2004 - the expected values are hand-computed numbers, each read beside its case
"""Weekly round 3's two stages and its number (preregistration section 2 items 2, 4 and 5): the 17
ordinary-least-squares lines with an intercept and no penalty (166 coefficients), the red-zone
slope with its intercept, x against the neutral game with pace and pass rate cancelling, and x's
floor at 0."""

from dataclasses import replace
from types import MappingProxyType

import numpy as np
import pytest

from research.model.ros.model import OpportunityLine
from research.model.weekly3.features import Features, neutral
from research.model.weekly3.stage import (
    COLUMNS,
    ClubMeans,
    RedZone,
    StageOne,
    UsageLine,
    club_means,
    design,
    fit_line,
    fit_red_zone,
    fit_stage_one,
    game_number,
    opportunity_points,
)
from research.model.weekly3.work import KINDS_BY_POSITION, ONES, ZERO, Work

_LINE = OpportunityLine(1.0, 1.5, 0.6, 0.05, 2.0)
_FALLBACK = ClubMeans(28.0, 0.6)


def _features(**changes: object) -> Features:
    base = Features(
        season_mean=Work(6.0, 2.0, 0.0, 0.7, 1.0),
        last_three=Work(8.0, 3.0, 0.0, 0.8, 2.0),
        prior=Work(5.0, 1.0, 0.0, 0.6, 1.0),
        no_prior=False,
        vacated=Work(4.0, 0.0, 0.0, 0.3, 1.0),
        pace=27.0,
        pass_rate=0.62,
        allowance=Work(1.1, 0.9, 1.0, 1.0, 1.2),
        home=1.0,
        defaults=frozenset(),
        vacating=1,
    )
    return replace(base, **changes)  # type: ignore[arg-type]


def test_a_line_has_ten_coefficients_and_snap_share_nine_for_166_in_all() -> None:
    assert COLUMNS == (
        "intercept",
        "season_mean",
        "last_three",
        "prior",
        "no_prior",
        "vacated",
        "pace",
        "pass_rate",
        "allowance",
        "home",
    )
    sizes = [len(design(_features(), kind, _FALLBACK)) for p, kinds in KINDS_BY_POSITION.items() for kind in kinds]
    assert len(sizes) == 17
    assert sum(sizes) == 166


def test_the_design_row_reads_each_input_and_the_fallback_only_without_a_pace() -> None:
    assert design(_features(), "targets", _FALLBACK) == (1.0, 6.0, 8.0, 5.0, 0.0, 4.0, 27.0, 0.62, 1.1, 1.0)
    assert design(_features(), "snap_share", _FALLBACK) == (1.0, 0.7, 0.8, 0.6, 0.0, 0.3, 27.0, 0.62, 1.0)
    assert design(_features(pace=None, pass_rate=None), "targets", _FALLBACK)[6:8] == (28.0, 0.6)


def test_ordinary_least_squares_with_an_intercept_recovers_a_noiseless_line() -> None:
    rng = np.random.default_rng(7)
    truth = np.array([0.5, 0.6, 0.3, 0.1, -0.4, 0.5, 0.02, 1.5, 2.0, 0.25])
    rows = [(1.0, *(float(v) for v in rng.uniform(0, 10, size=9))) for _ in range(200)]
    targets = [float(np.dot(truth, row)) for row in rows]
    found = fit_line(rows, targets, COLUMNS)
    assert found.coefficients == pytest.approx(tuple(truth), abs=1e-8)
    assert (found.rows, found.rank) == (200, 10)


def test_the_club_means_are_the_fit_populations() -> None:
    found = club_means([_features(pace=26.0, pass_rate=0.5), _features(pace=30.0, pass_rate=0.7), _features(pace=None)])
    assert found.pace == pytest.approx(28.0)
    assert found.pass_rate == pytest.approx((0.5 + 0.7 + 0.62) / 3)


def _stage(slopes: dict[str, float], intercept: float = 3.0) -> StageOne:
    lines = {}
    for position, kinds in KINDS_BY_POSITION.items():
        for kind in kinds:
            columns = COLUMNS if kind != "snap_share" else tuple(c for c in COLUMNS if c != "allowance")
            coefficients = tuple(intercept if c == "intercept" else slopes.get(c, 0.0) for c in columns)
            lines[f"{position}|{kind}"] = UsageLine(kind, columns, coefficients, 100, len(columns))
    return StageOne(MappingProxyType(lines), _FALLBACK)


def test_pace_pass_rate_and_the_pull_toward_the_prior_cancel_in_x() -> None:
    rz = RedZone(0.4, 2.5)
    stage = _stage({"pace": 0.3, "pass_rate": 7.0, "prior": 0.5, "no_prior": -2.0, "season_mean": 0.4})
    fast = game_number(10.0, _features(pace=24.0, pass_rate=0.7), "WR", stage, _LINE, rz)
    slow = game_number(10.0, _features(pace=33.0, pass_rate=0.4), "WR", stage, _LINE, rz)
    assert fast == pytest.approx(10.0)
    assert slow == pytest.approx(10.0)


def test_x_adds_what_this_game_adds_through_each_line_valued_at_the_positions_line() -> None:
    rz = RedZone(0.4, 2.5)
    stage = _stage({"last_three": 0.5, "vacated": 0.2, "allowance": 4.0, "home": 0.6})
    f = _features()
    found = game_number(10.0, f, "WR", stage, _LINE, rz)
    # Per kind: 0.5 (last three - season) + 0.2 vacated + 4.0 (allowance - 1) + 0.6 (home - 0.5).
    targets = 0.5 * 2.0 + 0.2 * 4.0 + 4.0 * 0.1 + 0.3
    carries = 0.5 * 1.0 + 0.0 + 4.0 * -0.1 + 0.3
    snap = 0.5 * 0.1 + 0.2 * 0.3 + 0.3
    red_zone = 0.5 * 1.0 + 0.2 * 1.0 + 4.0 * 0.2 + 0.3
    expected = 10.0 + 1.5 * targets + 0.6 * carries + 2.0 * snap + 2.5 * red_zone
    assert found == pytest.approx(expected)


def test_x_floors_at_zero() -> None:
    stage = _stage({"allowance": -40.0})
    assert game_number(1.0, _features(), "WR", stage, _LINE, RedZone(0.0, 0.0)) == 0.0


def test_a_non_quarterbacks_expected_pass_attempts_are_his_season_mean_in_both_games() -> None:
    stage = _stage({"vacated": 1.0})
    found = stage.expected("WR", _features(season_mean=Work(6.0, 2.0, 3.0, 0.7, 1.0)))
    assert found.pass_attempts == 3.0
    qb = stage.expected("QB", _features(vacated=Work(0.0, 0.0, 30.0, 0.0, 0.0)))
    assert qb.pass_attempts == pytest.approx(3.0 + 30.0)


def test_the_neutral_game_has_no_vacated_volume_so_vacated_moves_x() -> None:
    stage = _stage({"vacated": 1.0})
    f = _features(
        vacated=Work(2.0, 0.0, 0.0, 0.0, 0.0), last_three=Work(6.0, 2.0, 0.0, 0.7, 1.0), allowance=ONES, home=0.5
    )
    assert neutral(f).vacated == ZERO
    assert game_number(10.0, f, "WR", stage, _LINE, RedZone(0.0, 0.0)) == pytest.approx(10.0 + 1.5 * 2.0)


def test_the_red_zone_slope_is_fitted_with_its_intercept() -> None:
    usage = [Work(5.0, 2.0, 0.0, 0.7, rz) for rz in (0.0, 1.0, 2.0, 3.0, 4.0)]
    points = [opportunity_points(_LINE, RedZone(0.0, 0.0), w) + 1.7 + 3.2 * w.red_zone for w in usage]
    found = fit_red_zone(list(zip(points, usage, strict=True)), _LINE)
    assert found.intercept == pytest.approx(1.7)
    assert found.slope == pytest.approx(3.2)


def test_opportunity_points_are_the_line_plus_the_red_zone_slope() -> None:
    work = Work(5.0, 2.0, 10.0, 0.5, 2.0)
    expected = 1.0 + 1.5 * 5.0 + 0.6 * 2.0 + 0.05 * 10.0 + 2.0 * 0.5 + 2.5 * 2.0
    assert opportunity_points(_LINE, RedZone(0.4, 2.5), work) == pytest.approx(expected)


def test_the_stage_one_fit_keeps_one_line_per_position_and_kind() -> None:
    rng = np.random.default_rng(3)
    rows = []
    for position in ("QB", "RB", "WR", "TE"):
        for _ in range(60):
            f = _features(
                season_mean=Work(*rng.uniform(0, 9, size=5)),
                last_three=Work(*rng.uniform(0, 9, size=5)),
                prior=Work(*rng.uniform(0, 9, size=5)),
                no_prior=bool(rng.integers(0, 2)),
                vacated=Work(*rng.uniform(0, 3, size=5)),
                pace=float(rng.uniform(24, 32)),
                pass_rate=float(rng.uniform(0.4, 0.7)),
                allowance=Work(*rng.uniform(0.8, 1.2, size=5)),
                home=float(rng.integers(0, 2)),
            )
            rows.append((position, f, Work(*rng.uniform(0, 9, size=5))))
    found = fit_stage_one(rows, _FALLBACK)
    assert sorted(found.lines) == sorted(f"{p}|{k}" for p, kinds in KINDS_BY_POSITION.items() for k in kinds)
    assert sum(len(line.coefficients) for line in found.lines.values()) == 166
