"""Lane 157, the runners' refusals (Amendment 7 items 7 and 11; design 7.3): a clean tree descending from
the amendment's commit, each command taken once through its own exclusive file, the judgment only after the
check and only for the positions the stop rule left, never a season after 2024, and only the coordinator's
`lane157_kdef` scratch copy on 5433. B132 L1: a week the Wednesday stamp held back is counted."""

import json
from collections.abc import Callable
from dataclasses import replace
from pathlib import Path

import pytest

from research.errors import ConfigurationError
from research.model.ros.scratch import check_scratch_url
from research.model.weekly_kdef.gates import DEVELOPMENT_CHECK, KDEF_WEEKLY, POSITIONS
from research.model.weekly_kdef.round import (
    AMENDMENT,
    CHECK_CLAIM,
    CHECK_RECORD,
    JUDGMENT_CLAIM,
    MEASURED_LAST,
    SCRATCH_PREFIXES,
    RefusedError,
    Setup,
    claim,
    judged_positions,
    refusals,
    setup_for,
)
from research.model.weekly_kdef.rows import lost_a_prior_week


def _setup(
    tmp: Path,
    status: Callable[[], list[str]] = list,
    absent: Callable[[], list[str]] = list,
    record: Path | None = None,
) -> Setup:
    return Setup(KDEF_WEEKLY, tmp / "claim.json", record, status=status, absent=absent)


def _record(k: bool, defense: bool) -> str:
    def lines(passed: bool) -> list[dict[str, object]]:
        return [
            {"gate": "KD1", "subject": "pooled vs recent form", "passed": passed, "detail": ""},
            {"gate": "KD2", "subject": "pooled vs the streamer's sheet", "passed": True, "detail": ""},
            {"gate": "KD5", "subject": "below the floor", "passed": False, "detail": ""},
        ]

    return json.dumps({"command": "check", "gates": {"K": lines(k), "DEF": lines(defense)}})


def test_the_command_line_binds_the_preregistered_constants_and_paths() -> None:
    check, judgment = setup_for("check"), setup_for("judgment")
    assert (check.t, check.claim, check.record) == (DEVELOPMENT_CHECK, CHECK_CLAIM, None)
    assert (judgment.t, judgment.claim, judgment.record) == (KDEF_WEEKLY, JUDGMENT_CLAIM, CHECK_RECORD)
    assert check.claim != judgment.claim
    assert AMENDMENT == "95adfeb3" and MEASURED_LAST == 2024  # noqa: PLR2004
    assert SCRATCH_PREFIXES == ("lane157_kdef",)


def test_a_dirty_tree_or_a_missing_amendment_is_refused(tmp_path: Path) -> None:
    with pytest.raises(RefusedError, match="not clean"):
        refusals("check", _setup(tmp_path, status=lambda: [" M research/x.py"]))
    with pytest.raises(RefusedError, match="not in this tree"):
        refusals("check", _setup(tmp_path, absent=lambda: [AMENDMENT]))
    assert refusals("check", _setup(tmp_path)) == POSITIONS


def test_each_command_is_taken_once_through_its_exclusive_file(tmp_path: Path) -> None:
    path = tmp_path / "claim.json"
    claim(path, tmp_path / "out.json", "check")
    with pytest.raises(RefusedError, match="taken once"):
        claim(path, tmp_path / "out.json", "check")
    with pytest.raises(RefusedError, match="taken once"):
        refusals("check", _setup(tmp_path))
    record = tmp_path / "record.json"
    record.write_text("{}")
    with pytest.raises(RefusedError, match="taken once"):
        refusals("check", replace(_setup(tmp_path / "x"), taken=(record,)))


def test_the_judgment_runs_after_the_check_for_the_positions_it_left(tmp_path: Path) -> None:
    with pytest.raises(RefusedError, match="no development check record"):
        refusals("judgment", _setup(tmp_path, record=tmp_path / "absent.json"))
    record = tmp_path / "check.json"
    record.write_text(_record(k=True, defense=False))
    assert refusals("judgment", _setup(tmp_path, record=record)) == ("K",)
    record.write_text(_record(k=False, defense=False))
    with pytest.raises(RefusedError, match="stop rule"):
        refusals("judgment", _setup(tmp_path, record=record))
    with pytest.raises(RefusedError, match="names no"):
        judged_positions({"command": "check", "gates": {"K": []}})
    with pytest.raises(RefusedError, match="not a check's record"):
        judged_positions({"command": "judgment", "gates": {}})


def test_no_season_after_2024_is_judged(tmp_path: Path) -> None:
    late = replace(_setup(tmp_path), t=replace(KDEF_WEEKLY, judgment_season=2025))
    with pytest.raises(RefusedError, match="after 2024"):
        refusals("check", late)


def test_only_the_coordinators_scratch_copy_is_admitted() -> None:
    check_scratch_url("postgresql://commish:commish@localhost:5433/lane157_kdef", SCRATCH_PREFIXES)
    for url in (
        "postgresql://commish:commish@localhost:5432/lane157_kdef",
        "postgresql://commish:commish@localhost:5433/commish",
        "postgresql://commish:commish@localhost:5433/lane157_research_test",
        "postgresql://commish:commish@localhost:5440/lane157_kdef",
    ):
        with pytest.raises(ConfigurationError):
            check_scratch_url(url, SCRATCH_PREFIXES)


def test_a_week_the_wednesday_stamp_held_back_is_counted() -> None:
    assert lost_a_prior_week(17, {14, 15, 16}, {14, 15})
    assert not lost_a_prior_week(17, {14, 15, 16}, {14, 15, 16})
    assert not lost_a_prior_week(16, {14, 15, 16}, {14, 15})  # week W itself is never an input
