# ruff: noqa: PLR2004 - the expected values are hand-computed numbers, each read beside its case
"""The weekly round's gates at their boundaries, and every verdict of the one judgment rebuilt from
its committed numbers (the judgment is never rerun; this reads the stored record only)."""

import json
from dataclasses import asdict
from pathlib import Path
from typing import Any

import pytest

from research.model.weekly.round import gates
from research.model.weekly.round.gates import PREREGISTERED
from research.model.weekly.round.statistics import Calibration, Difference

_RECORD = Path(__file__).resolve().parents[2] / "docs/research/2026-10-13-weekly-projection-results.json"
_POSITIONS = ("QB", "RB", "WR", "TE")
_STEP = 1e-12


def _all(value: Difference) -> dict[str, Difference]:
    return dict.fromkeys(_POSITIONS, value)


@pytest.mark.parametrize(
    ("value", "bound", "passes"),
    [
        (0.03, _STEP, True),  # exactly at the margin passes
        (0.03 - _STEP, _STEP, False),
        (0.03 + _STEP, _STEP, True),
        (0.1, 0.0, False),  # a bound of exactly zero fails
        (0.1, -_STEP, False),
        (None, None, False),  # cannot answer fails
    ],
)
def test_g1_reads_the_margin_inclusively_and_the_bound_strictly(
    value: float | None, bound: float | None, passes: bool
) -> None:
    lines = gates.ordering_gates(_all(Difference(value, bound, 17)), _all(Difference(1.0, 1.0, 17)), PREREGISTERED)
    assert [line.passed for line in lines if line.gate == "G1"] == [passes] * 4


def test_g1_and_g2_judge_each_position_alone() -> None:
    adp = {"QB": Difference(0.0, -0.1, 17), "RB": Difference(0.03, 0.01, 17), "WR": Difference(0.5, 0.0, 3)}
    adp["TE"] = Difference(None, None, 0)
    form = {"QB": Difference(0.02, _STEP, 17), "RB": Difference(0.02 - _STEP, 0.1, 17)}
    form |= {"WR": Difference(0.02, -_STEP, 17), "TE": Difference(0.5, 0.5, 1)}
    lines = gates.ordering_gates(adp, form, PREREGISTERED)
    assert [(line.gate, line.subject[:2], line.passed) for line in lines] == [
        ("G1", "QB", False),
        ("G1", "RB", True),
        ("G1", "WR", False),
        ("G1", "TE", False),
        ("G2", "QB", True),
        ("G2", "RB", False),
        ("G2", "WR", False),
        ("G2", "TE", True),
    ]


@pytest.mark.parametrize(("value", "passes"), [(0.5, True), (0.5 - _STEP, False), (0.5 + _STEP, True)])
def test_g3_places_margin(value: float, passes: bool) -> None:
    lines = gates.places_gates({"adp": Difference(value, _STEP, 17), "form": Difference(value, 0.0, 17)}, PREREGISTERED)
    assert [line.passed for line in lines] == [passes, False]


def _cells(cell: Calibration) -> dict[str, Calibration]:
    return {f"{p}|{name}": cell for p in _POSITIONS for name in ("ppr", "half", "std")}


@pytest.mark.parametrize(
    ("below", "above", "size", "passes"),
    [
        (0.05, 0.15, 100, True),  # both ends of the band are inside it
        (0.05 - _STEP, 0.10, 100, False),
        (0.10, 0.15 + _STEP, 100, False),
        (0.10, 0.10, 99, False),  # fewer than 100 player-weeks cannot answer
        (None, None, 0, False),
    ],
)
def test_g4_band_is_inclusive_and_needs_one_hundred_weeks(
    below: float | None, above: float | None, size: int, passes: bool
) -> None:
    lines = gates.calibration_gates(_cells(Calibration(below, above, size)), PREREGISTERED)
    assert len(lines) == 12
    assert [line.subject for line in lines[:3]] == ["QB ppr", "QB half", "QB std"]
    assert all(line.passed == passes for line in lines)


def test_g5_and_the_verdict() -> None:
    assert gates.isolation_gate({"a": "1"}, {"a": "1"}).passed
    assert not gates.isolation_gate({"a": "1"}, {"a": "2"}).passed
    assert not gates.isolation_gate({"a": "1"}, {"a": "1", "b": "1"}).passed
    assert not gates.verdict([])
    assert PREREGISTERED.lower_bound_percentile == pytest.approx(0.5)


def _record() -> dict[str, Any]:
    loaded: dict[str, Any] = json.loads(_RECORD.read_text())
    return loaded


def test_the_record_ran_under_the_preregistered_thresholds() -> None:
    stored = _record()["thresholds"]
    assert stored == json.loads(json.dumps(asdict(PREREGISTERED)))


def test_every_verdict_of_the_judgment_rebuilds_from_its_stored_numbers() -> None:
    record = _record()
    numbers = record["numbers"]
    lines = [
        *gates.ordering_gates(
            {p: Difference(**d) for p, d in numbers["against_adp"].items()},
            {p: Difference(**d) for p, d in numbers["against_form"].items()},
            PREREGISTERED,
        ),
        *gates.places_gates({b: Difference(**d) for b, d in numbers["places"].items()}, PREREGISTERED),
        *gates.calibration_gates({k: Calibration(**c) for k, c in numbers["calibration"].items()}, PREREGISTERED),
        gates.isolation_gate(numbers["digests"]["before"], numbers["digests"]["after"]),
    ]
    assert [asdict(line) for line in lines] == record["gates"]
    assert not gates.verdict(lines)
    assert record["passed"] is False
    failed = [f"{line.gate} {line.subject}" for line in lines if not line.passed]
    assert failed == [
        "G1 QB vs ADP",
        "G1 WR vs ADP",
        "G1 TE vs ADP",
        "G2 QB vs recent form",
        "G2 RB vs recent form",
        "G2 WR vs recent form",
        "G2 TE vs recent form",
        "G3 places off vs adp",
        "G3 places off vs form",
        "G4 QB ppr",
        "G4 QB half",
        "G4 QB std",
    ]
    assert len(lines) == 23
