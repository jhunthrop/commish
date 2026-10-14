# ruff: noqa: PLR2004 - the expected values are hand-computed numbers, each read beside its case
"""The rest-of-season round: the model's arithmetic by hand, the gates at their thresholds, and the
outcome reader's refusals (G4)."""

from types import MappingProxyType

import pytest

from research.model.ros import gates
from research.model.ros.gates import PREREGISTERED, CellScore, Coverage
from research.model.ros.model import (
    FORMATS,
    GamePlayed,
    OpportunityLine,
    PlayerToDate,
    RosPriors,
    Shrinkage,
    StaleEntry,
    band_of,
    expected_games,
    interval,
    project,
)
from research.model.ros.outcomes import HeldOutReadError, fit_reader, judgment_reader
from research.model.ros.payload import priors_from, priors_payload
from research.model.ros.reads import stale_entry

_STEP = 1e-12
_ALL = dict.fromkeys(FORMATS)


def _per_format(value: float) -> MappingProxyType[str, float]:
    return MappingProxyType(dict.fromkeys(FORMATS, value))


def _priors() -> RosPriors:
    line = OpportunityLine(1.0, 1.0, 0.5, 0.0, 0.0)
    keys = [f"{p}|{f}" for p in ("QB", "RB", "WR", "TE") for f in FORMATS]
    return RosPriors(
        opportunity=MappingProxyType(dict.fromkeys(keys, line)),
        shrinkage=MappingProxyType(dict.fromkeys(keys, Shrinkage(4.0, 0.5))),
        availability_k=MappingProxyType(dict.fromkeys(("QB", "RB", "WR", "TE"), 4.0)),
        return_next=(0.5, 0.3, 0.1),
        return_later=(0.8, 0.6, 0.4),
        offboard_rate=MappingProxyType(dict.fromkeys(keys, 3.0)),
        offboard_availability=MappingProxyType(dict.fromkeys(("QB", "RB", "WR", "TE"), 0.5)),
        interval=MappingProxyType(
            {f"{k}|{band}": (0.25, 1.0, 1.75) for k in keys for band in ("early", "middle", "late")}
        ),
    )


def _game(week: int, points: float, targets: float, carries: float) -> GamePlayed:
    return GamePlayed(week, _per_format(points), targets, carries, 0.0, 0.8)


def _player(played: tuple[GamePlayed, ...], club_weeks: tuple[int, ...], stale: StaleEntry | None) -> PlayerToDate:
    return PlayerToDate("p", "WR", club_weeks, played, (5, 6, 7, 8), stale)


def test_the_model_by_hand() -> None:
    stale = StaleEntry(_per_format(170.0), _per_format(10.0), 1.0)
    # Four club games, played weeks 1, 2 and 4 for 16, 20 and 12: form 16; opportunity 1 + 6 + 0.5 * 2 = 8.
    games = (_game(1, 16, 6, 2), _game(2, 20, 6, 2), _game(4, 12, 6, 2))
    player = _player(games, (1, 2, 3, 4), stale)
    projection = project(player, _priors())
    # u = 0.5 * 16 + 0.5 * 8 = 12; m = (4 * 10 + 3 * 12) / 7 = 76 / 7.
    assert projection.per_game["ppr"] == pytest.approx(76 / 7)
    # q = (4 * 1 + 3) / (4 + 4) = 7 / 8, four games left.
    assert projection.expected_games == pytest.approx(3.5)
    assert projection.projected["half"] == pytest.approx(76 / 7 * 3.5)


def test_an_absence_takes_the_return_rates_and_no_games_take_the_prior() -> None:
    stale = StaleEntry(_per_format(170.0), _per_format(10.0), 1.0)
    missed_two = _player((_game(1, 16, 6, 2),), (1, 2, 3), stale)
    assert missed_two.streak == 2
    assert expected_games(missed_two, _priors()) == pytest.approx(0.3 + 0.6 * 3)
    unseen = _player((), (1, 2, 3), None)
    projection = project(unseen, _priors())
    assert projection.per_game["ppr"] == 3.0  # the off-board rate, with no game to shrink toward
    assert unseen.streak == 3


def test_the_interval_and_its_bands() -> None:
    assert [band_of(w) for w in (1, 2, 5, 6, 10, 11, 15, 16)] == [
        "early", "early", "early", "middle", "middle", "late", "late", "late",
    ]  # fmt: skip
    assert interval(40.0, "WR", "ppr", 8, _priors()) == (10.0, 40.0, 70.0)
    assert interval(0.0, "WR", "ppr", 8, _priors()) == (0.0, 0.0, 0.0)


def test_the_stale_entry_reads_points_a_game_and_caps_availability() -> None:
    entry = stale_entry({"ppr": 180.0, "half": 153.0, "std": 0.0}, 18.0)
    assert dict(entry.per_game) == {"ppr": 10.0, "half": 8.5, "std": 0.0}
    assert entry.availability == 1.0
    assert stale_entry({"ppr": 10.0, "half": 8.0, "std": 6.0}, 0.0).per_game["half"] == 0.0


def test_the_priors_round_trip_through_their_payload() -> None:
    priors = _priors()
    assert priors_from(priors_payload(priors)) == priors


def _score(model: float | None, board: float | None, size: int = 30) -> CellScore:
    return CellScore(size, model, board, 5.0, 5.0)


@pytest.mark.parametrize(
    ("model", "board", "size", "passes"),
    [
        (0.52, 0.50, 30, True),  # exactly the margin passes
        (0.52 - 2 * _STEP, 0.50, 30, False),
        (0.60, 0.50, 19, False),  # too small a population cannot answer
        (0.60, 0.50, 20, True),
        (None, 0.5, 30, False),
    ],
)
def test_g1_reads_the_margin_inclusively(model: float | None, board: float | None, size: int, passes: bool) -> None:
    assert gates.ordering_line("4|QB|ppr", _score(model, board, size), PREREGISTERED).passed is passes


@pytest.mark.parametrize(
    ("model", "board", "passes"), [(5.0, 5.0, True), (5.0 + _STEP, 5.0, False), (None, 5.0, False)]
)
def test_g2_passes_when_no_worse(model: float | None, board: float, passes: bool) -> None:
    assert gates.starters_line("4|QB|ppr", CellScore(30, 0.5, 0.5, model, board)).passed is passes


@pytest.mark.parametrize(
    ("inside", "size", "passes"),
    [(75, 100, True), (85, 100, True), (74, 100, False), (86, 100, False), (48, 60, True), (47, 59, False)],
)
def test_g3_reads_the_band_inclusively_with_a_minimum_size(inside: int, size: int, passes: bool) -> None:
    assert gates.coverage_line("QB|ppr", Coverage(inside, size), PREREGISTERED).passed is passes


def test_every_judged_cell_is_gated_and_a_missing_one_fails() -> None:
    lines = gates.judged_lines({}, {}, PREREGISTERED)
    assert len(lines) == 36 + 36 + 12
    assert not any(line.passed for line in lines)
    assert not gates.verdict(lines)
    assert not gates.verdict([])


def test_g4_refuses_a_stray_season_and_a_moved_table() -> None:
    digests = {"model_artifacts": "1:a"}
    allowed = (2021, 2022, 2023, 2024, 2025)
    assert gates.isolation_line([2023, 2025], allowed, digests, digests).passed
    assert not gates.isolation_line([2023, 2026], allowed, digests, digests).passed
    assert not gates.isolation_line([2023], allowed, digests, {"model_artifacts": "2:b"}).passed
    assert not gates.isolation_line([2023], allowed, {}, {}).passed


def test_the_fit_reader_refuses_the_judgment_season_and_after() -> None:
    reader = fit_reader(2025)
    reader.admit(2024)
    for season in (2025, 2026, 2027):
        with pytest.raises(HeldOutReadError):
            reader.admit(season)
    assert reader.served == [2024]
    dev = fit_reader(2024)
    for season in (2024, 2025):
        with pytest.raises(HeldOutReadError):
            dev.admit(season)


def test_the_judgment_reader_refuses_only_the_pristine_season() -> None:
    reader = judgment_reader()
    reader.admit(2025)
    with pytest.raises(HeldOutReadError):
        reader.admit(2026)
    assert reader.served == [2025]
