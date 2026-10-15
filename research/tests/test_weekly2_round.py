# ruff: noqa: PLR2004 - the expected values are hand-computed numbers, each read beside its case
"""Weekly round 2's round: the gates at their thresholds, the 26 lines, the readers' and the
queries' refusals of closed seasons (G5), the population and the pooled statistics, and the
commands' refusals (the preregistration commit, the one judgment, the scratch copy, the
preconditions)."""

from dataclasses import replace
from pathlib import Path
from types import MappingProxyType

import numpy as np
import pytest
from sqlalchemy import create_engine, text

from research.errors import ConfigurationError
from research.model.ros.outcomes import HeldOutReadError
from research.model.weekly2 import gates
from research.model.weekly2.gates import DEVELOPMENT_CHECK, ROUND_TWO, Calibration, ChanceBin, Difference, Ordering
from research.model.weekly2.guard import (
    ClosedSeasonError,
    check_parameters,
    closed_seasons,
    fit_reader,
    guard_queries,
    judgment_reader,
)
from research.model.weekly2.preconditions import StoreCounts, missing_preconditions
from research.model.weekly2.round import (
    JUDGMENT_RECORD,
    PREREGISTRATION_COMMIT,
    check_round_scratch,
    thresholds_for,
)
from research.model.weekly2.statistics import (
    NO_OPINION,
    JudgedRow,
    bootstrap_draws,
    chance_bins,
    ordering_difference,
    places_mean,
    population,
    week_ordering,
)

_STEP = 1e-12
_POSITIONS = ("QB", "RB", "WR", "TE")
_FORMATS = ("ppr", "half", "std")


# --- the constant -------------------------------------------------------------------------------


def test_the_constant_is_the_preregistration_verbatim() -> None:
    t = ROUND_TWO
    assert t.model_name == "commish_weekly_v2"
    assert (t.fit_seasons, t.judgment_season, t.weeks) == ((2021, 2022, 2023), 2024, tuple(range(6, 18)))
    assert dict(t.population) == {"QB": 36, "RB": 72, "WR": 108, "TE": 36}
    assert dict(t.starters) == {"QB": 12, "RB": 24, "WR": 24, "TE": 12}
    assert (t.adp_margin, t.form_margin, t.position_floor, t.places_margin) == (0.04, 0.02, -0.02, 0.25)
    assert (t.calibration_low, t.calibration_high, t.calibration_min_size) == (0.05, 0.15, 100)
    assert t.chance_bins == ((0.5, 0.6), (0.6, 0.7), (0.7, 0.8), (0.8, 0.9), (0.9, 1.0))
    assert (t.chance_min_pairs, t.chance_tolerance, t.chance_min_bins) == (200, 0.05, 3)
    assert (t.resamples, t.seed, t.lower_percentile) == (10_000, 42, 2.5)
    assert t.residual_percentiles == tuple(float(p) for p in range(1, 100))
    assert t.min_week_population == 8
    assert t.adp_source == "ffc_adp_ppr_12"
    assert t.adp_seasons == (2023, 2024)


def test_the_development_check_moves_only_the_seasons() -> None:
    assert (
        replace(
            ROUND_TWO,
            fit_seasons=(2021, 2022),
            judgment_season=2023,
            adp_seasons=(2023,),
            rate_round=DEVELOPMENT_CHECK.rate_round,
            rate_record=DEVELOPMENT_CHECK.rate_record,
        )
        == DEVELOPMENT_CHECK
    )
    assert DEVELOPMENT_CHECK.rate_round.fit_seasons == (2021, 2022)
    assert ROUND_TWO.rate_round.fit_seasons == (2021, 2022, 2023)
    assert ROUND_TWO.rate_round.model_name == "commish_ros_v3"


# --- G1 and G2 ----------------------------------------------------------------------------------


def _ordering(pooled: float | None, bound: float | None, each: float | None = 0.0) -> Ordering:
    return Ordering(Difference(pooled, bound, 12), MappingProxyType(dict.fromkeys(_POSITIONS, each)))


@pytest.mark.parametrize(
    ("value", "bound", "passes"),
    [
        (0.04, _STEP, True),  # exactly at the margin passes
        (0.04 - _STEP, _STEP, False),
        (0.1, 0.0, False),  # a bound of exactly zero fails
        (0.1, -_STEP, False),
        (None, None, False),  # cannot answer fails
    ],
)
def test_g1_pooled_reads_the_margin_inclusively_and_the_bound_strictly(
    value: float | None, bound: float | None, passes: bool
) -> None:
    lines = gates.ordering_lines("G1", "ADP", _ordering(value, bound), ROUND_TWO.adp_margin, ROUND_TWO)
    assert lines[0].passed is passes


@pytest.mark.parametrize(("each", "passes"), [(-0.02, True), (-0.02 - _STEP, False), (0.3, True), (None, False)])
def test_no_position_may_trail_by_more_than_the_floor(each: float | None, passes: bool) -> None:
    lines = gates.ordering_lines("G2", "recent form", _ordering(0.5, 0.1, each), ROUND_TWO.form_margin, ROUND_TWO)
    assert [line.passed for line in lines[1:]] == [passes] * 4


def test_g2_reads_its_own_margin() -> None:
    lines = gates.ordering_lines("G2", "recent form", _ordering(0.02, _STEP), ROUND_TWO.form_margin, ROUND_TWO)
    assert lines[0].passed
    lines = gates.ordering_lines("G2", "recent form", _ordering(0.02 - _STEP, _STEP), ROUND_TWO.form_margin, ROUND_TWO)
    assert not lines[0].passed


# --- G3 -----------------------------------------------------------------------------------------


@pytest.mark.parametrize(("bench", "passes"), [(10.25, True), (10.25 - 1e-9, False), (None, False)])
def test_g3_needs_a_quarter_place_fewer_than_each_benchmark(bench: float | None, passes: bool) -> None:
    lines = gates.places_lines(10.0, {"adp": bench, "form": 11.0}, ROUND_TWO)
    assert [line.passed for line in lines] == [passes, True]
    assert not all(line.passed for line in gates.places_lines(None, {"adp": 11.0, "form": 11.0}, ROUND_TWO))


# --- G4 -----------------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("below", "above", "size", "passes"),
    [
        (0.05, 0.15, 100, True),
        (0.05 - _STEP, 0.1, 100, False),
        (0.1, 0.15 + _STEP, 100, False),
        (0.1, 0.1, 99, False),
        (None, None, 0, False),
    ],
)
def test_g4_cells_read_the_band_inclusively(below: float | None, above: float | None, size: int, passes: bool) -> None:
    cells = {f"{p}|{f}": Calibration(0.1, 0.1, 500) for p in _POSITIONS for f in _FORMATS}
    cells["WR|half"] = Calibration(below, above, size)
    lines = gates.calibration_lines(cells, ROUND_TWO)
    assert len(lines) == 12
    assert [line.passed for line in lines if line.subject == "WR half"] == [passes]


def _bins(*rows: tuple[int, float, float]) -> list[ChanceBin]:
    edges = ROUND_TWO.chance_bins
    return [ChanceBin(low, high, n, mean, seen) for (low, high), (n, mean, seen) in zip(edges, rows, strict=True)]


def test_the_chance_line_gates_bins_of_200_pairs_within_005() -> None:
    good = _bins((200, 0.55, 0.59), (300, 0.65, 0.61), (400, 0.75, 0.79), (199, 0.85, 0.2), (0, 0.0, 0.0))
    assert gates.chance_line(good, ROUND_TWO).passed  # the 199-pair bin is not gated
    off = _bins((200, 0.55, 0.60 + 1e-9), (300, 0.65, 0.60), (400, 0.75, 0.79), (500, 0.85, 0.85), (0, 0.0, 0.0))
    assert not gates.chance_line(off, ROUND_TWO).passed
    two = _bins((200, 0.55, 0.55), (300, 0.65, 0.65), (199, 0.75, 0.75), (10, 0.85, 0.85), (0, 0.0, 0.0))
    assert not gates.chance_line(two, ROUND_TWO).passed  # fewer than three bins gated


# --- G5 -----------------------------------------------------------------------------------------


def test_g5_needs_the_readers_on_their_seasons_and_the_tables_unmoved() -> None:
    same = {"model_artifacts": "1:a"}
    assert gates.isolation_line((2021, 2022, 2023), (2024,), same, same, ROUND_TWO).passed
    assert not gates.isolation_line((2021, 2024), (2024,), same, same, ROUND_TWO).passed
    assert not gates.isolation_line((2021,), (2023, 2024), same, same, ROUND_TWO).passed
    assert not gates.isolation_line((2021,), (2024,), same, {"model_artifacts": "2:b"}, ROUND_TWO).passed
    assert not gates.isolation_line((2021,), (2024,), {}, {}, ROUND_TWO).passed


def test_the_judgment_has_26_lines() -> None:
    lines = [
        *gates.ordering_lines("G1", "ADP", _ordering(0.1, 0.1), ROUND_TWO.adp_margin, ROUND_TWO),
        *gates.ordering_lines("G2", "recent form", _ordering(0.1, 0.1), ROUND_TWO.form_margin, ROUND_TWO),
        *gates.places_lines(9.0, {"adp": 10.0, "form": 10.0}, ROUND_TWO),
        *gates.calibration_lines(
            {f"{p}|{f}": Calibration(0.1, 0.1, 500) for p in _POSITIONS for f in _FORMATS}, ROUND_TWO
        ),
        gates.chance_line(_bins(*[(300, 0.55, 0.55)] * 5), ROUND_TWO),
        gates.isolation_line((2021,), (2024,), {"t": "1"}, {"t": "1"}, ROUND_TWO),
    ]
    assert len(lines) == 26
    assert gates.verdict(lines)
    assert not gates.verdict([*lines[:-1], replace(lines[-1], passed=False)])
    assert not gates.verdict([])


# --- the guards ---------------------------------------------------------------------------------


def test_the_fit_reader_refuses_the_judgment_season_and_after() -> None:
    reader = fit_reader(ROUND_TWO)
    for season in ROUND_TWO.fit_seasons:
        reader = reader.admit(season)
    assert reader.served == (2021, 2022, 2023)
    for season in (2024, 2025, 2026, 2027):
        with pytest.raises(HeldOutReadError):
            fit_reader(ROUND_TWO).admit(season)


def test_the_judgment_reader_serves_the_judgment_season_and_refuses_2025_and_2026() -> None:
    assert judgment_reader(ROUND_TWO).admit(2024).served == (2024,)
    for season in (2025, 2026):
        with pytest.raises(HeldOutReadError):
            judgment_reader(ROUND_TWO).admit(season)


def test_the_development_check_closes_2024_too() -> None:
    assert closed_seasons(DEVELOPMENT_CHECK) == frozenset({2024, 2025, 2026})
    assert closed_seasons(ROUND_TWO) == frozenset({2025, 2026})
    with pytest.raises(HeldOutReadError):
        judgment_reader(DEVELOPMENT_CHECK).admit(2024)


@pytest.mark.parametrize(
    "params",
    [
        {"season": 2025},
        {"s": 2026},
        {"seasons": [2023, 2025]},
        {"season_to": 2025},
        [{"season": 2024}, {"season": 2025}],
    ],
)
def test_a_query_naming_a_closed_season_is_refused(params: object) -> None:
    with pytest.raises(ClosedSeasonError):
        check_parameters(params, closed_seasons(ROUND_TWO))


@pytest.mark.parametrize("params", [{"season": 2024}, {"s": 2021, "week": 2025}, None, (), {"seasons": [2023, 2024]}])
def test_a_query_on_open_seasons_passes(params: object) -> None:
    check_parameters(params, closed_seasons(ROUND_TWO))


# --- the population and the statistics ----------------------------------------------------------


def test_the_population_is_the_lined_players_in_either_top_k() -> None:
    positions = {"a": "WR", "b": "WR", "c": "WR", "d": "WR", "e": "WR", "q": "QB"}
    adp = {"a": 1.0, "b": 2.0, "c": 30.0, "q": 0.5}
    to_date = {"c": 50.0, "d": 40.0, "e": 10.0}
    lined = {"a", "c", "d", "e", "q"}  # b recorded no line this week
    found = population("WR", lined, adp, to_date, positions, size=2)
    assert found == frozenset({"a", "c", "d"})  # ADP's top 2 (a, b) with the top 2 so far (c, d), lined


def _row(week: int, pid: str, number: float | None, adp: float | None, form: float | None, actual: float) -> JudgedRow:  # noqa: PLR0913, PLR0917 - one row, every source
    per = MappingProxyType
    return JudgedRow(
        week,
        pid,
        "QB",
        None if number is None else per(dict.fromkeys(_FORMATS, number)),
        per(dict.fromkeys(_FORMATS, number or 0.0)),
        None,
        adp,
        None if form is None else per(dict.fromkeys(_FORMATS, form)),
        per(dict.fromkeys(_FORMATS, actual)),
        False,
    )


def test_a_source_with_no_opinion_ranks_the_player_below_every_player_it_has() -> None:
    rows = [_row(6, f"p{i}", float(20 - i), float(i + 1), float(20 - i), float(20 - i)) for i in range(8)]
    rows.append(_row(6, "out", None, None, None, 30.0))  # withheld, off ADP, no form, top scorer
    found = week_ordering(6, "QB", rows, "ppr", ROUND_TWO)
    assert found.size == 9
    assert found.rho["model"] == found.rho["adp"] == found.rho["form"]
    assert found.rho["model"] is not None
    assert found.rho["model"] < 1.0
    assert NO_OPINION < 0.0


def test_a_week_of_fewer_than_eight_players_does_not_answer() -> None:
    rows = [_row(6, f"p{i}", float(i), float(i), float(i), float(i)) for i in range(7)]
    found = week_ordering(6, "QB", rows, "ppr", ROUND_TWO)
    assert found.rho["model"] is None
    assert found.places_off["model"] == ()


def test_places_off_count_the_starters_by_actual_rank() -> None:
    # 14 quarterbacks; the model swaps the top two, ADP is perfect.
    rows = [_row(6, f"p{i}", float(100 - i), float(i + 1), float(100 - i), float(100 - i)) for i in range(14)]
    rows[0] = _row(6, "p0", 98.5, 1.0, 100.0, 100.0)
    found = week_ordering(6, "QB", rows, "ppr", ROUND_TWO)
    assert len(found.places_off["model"]) == 12
    assert places_mean([found], "model") == pytest.approx(2 / 12)
    assert places_mean([found], "adp") == 0.0


def test_the_pooled_difference_needs_all_four_positions_in_a_week() -> None:
    weeks = (6, 7)
    by_position: dict[str, list[float | None]] = {
        "QB": [0.1, 0.2],
        "RB": [0.1, 0.2],
        "WR": [0.1, 0.2],
        "TE": [0.1, None],
    }
    draws = bootstrap_draws(len(weeks), ROUND_TWO)
    found = ordering_difference(by_position, draws, ROUND_TWO)
    assert found.pooled.value == pytest.approx(0.1)  # week 7 does not answer at tight end
    assert found.pooled.weeks == 1
    assert found.by_position["QB"] == pytest.approx(0.15)
    assert found.by_position["TE"] == pytest.approx(0.1)


def test_the_bootstrap_is_the_preregistered_seed_and_shape() -> None:
    draws = bootstrap_draws(12, ROUND_TWO)
    assert draws.shape == (10_000, 12)
    assert np.array_equal(draws, np.random.default_rng(42).integers(0, 12, size=(10_000, 12)))


def test_the_chance_bins_count_the_favourite_and_ties_half() -> None:
    # (favourite's chance, favourite's points minus the other's)
    pairs = [(0.55, 1.0), (0.55, -1.0), (0.65, 0.0), (0.95, 2.0), (1.0, 3.0)]
    bins = chance_bins(pairs, ROUND_TWO)
    assert [(b.pairs, b.mean_chance, b.observed) for b in bins] == [
        (2, pytest.approx(0.55), 0.5),
        (1, pytest.approx(0.65), 0.5),
        (0, None, None),
        (0, None, None),
        (2, pytest.approx(0.975), 1.0),
    ]


# --- the commands' refusals ---------------------------------------------------------------------


def test_the_judgment_is_refused_without_the_preregistration_commit() -> None:
    assert PREREGISTRATION_COMMIT == "86ca79d6"
    with pytest.raises(ConfigurationError, match="86ca79d6"):
        thresholds_for("judge", committed=lambda: False, exists=lambda path: False)
    assert thresholds_for("judge", committed=lambda: True, exists=lambda path: False) is ROUND_TWO


def test_the_judgment_is_taken_once() -> None:
    def exists(path: Path) -> bool:
        return path == JUDGMENT_RECORD

    with pytest.raises(ConfigurationError, match="once"):
        thresholds_for("judge", committed=lambda: True, exists=exists)


def test_the_development_check_runs_the_check_constant() -> None:
    assert thresholds_for("develop", committed=lambda: True, exists=lambda path: False) is DEVELOPMENT_CHECK


@pytest.mark.parametrize(
    ("command", "url", "admitted"),
    [
        ("judge", "postgres://u:p@localhost:5433/lane42_weekly", True),
        ("judge", "postgres://u:p@localhost:5433/lane44_weekly", False),
        ("develop", "postgres://u:p@localhost:5433/lane44_weekly", True),
        ("develop", "postgres://u:p@localhost:5433/lane42_weekly", True),
        ("develop", "postgres://u:p@localhost:5432/lane44_weekly", False),
        ("develop", "postgres://u:p@localhost:5433/commish", False),
        ("judge", "postgres://u:p@db.neon.tech:5433/lane42_weekly", False),
    ],
)
def test_the_round_runs_only_on_its_scratch_copy(command: str, url: str, admitted: bool) -> None:
    if admitted:
        check_round_scratch(command, url)
    else:
        with pytest.raises(ConfigurationError):
            check_round_scratch(command, url)


def _counts(
    filings: dict[tuple[int, int], int] | None = None,
    ratings: dict[tuple[int, int], int] | None = None,
    adp: dict[int, int] | None = None,
) -> StoreCounts:
    full = {(s, w): 10 for s in (2021, 2022, 2023, 2024) for w in range(6, 18)}
    return StoreCounts(
        filings=full if filings is None else filings,
        ratings=full if ratings is None else ratings,
        adp={2023: 180, 2024: 180} if adp is None else adp,
    )


def test_preconditions_pass_on_a_full_store() -> None:
    assert missing_preconditions(_counts(), ROUND_TWO) == []


def test_each_missing_precondition_is_named() -> None:
    full = {(s, w): 1 for s in (2021, 2022, 2023, 2024) for w in range(6, 18)}
    counts = _counts(
        filings={k: v for k, v in full.items() if k != (2024, 17)},
        ratings={k: v for k, v in full.items() if k != (2022, 9)},
        adp={2023: 180},
    )
    missing = missing_preconditions(counts, ROUND_TWO)
    assert missing == [
        "stamped injury filings (injury_report_status) for 2024 week 17",
        "opponent ratings (commish_opponent_adjustment) for 2022 week 9",
        "ADP (ffc_adp_ppr_12) for 2024",
    ]


def test_the_development_check_needs_only_its_own_seasons() -> None:
    dev = {(s, w): 1 for s in (2021, 2022, 2023) for w in range(6, 18)}
    counts = _counts(filings=dev, ratings=dev, adp={2023: 180})
    assert missing_preconditions(counts, DEVELOPMENT_CHECK) == []


def test_the_guarded_connection_refuses_a_statement_naming_a_closed_season() -> None:
    engine = create_engine("sqlite://")
    with engine.connect() as conn:
        guard_queries(conn, closed_seasons(ROUND_TWO))
        assert conn.execute(text("select :season"), {"season": 2024}).scalar() == 2024
        with pytest.raises(ClosedSeasonError):
            conn.execute(text("select :season"), {"season": 2025})
