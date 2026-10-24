"""Round 5's one new outcome read (Lane 168 review, (e)): the fit window's fumbles lost through round 2's
ledgered reader, which refuses the judged season and every season after it before any statement runs, and keeps
the seasons it served; and the digest precondition names an unchecked file (H1)."""

from typing import Any, cast

import pytest
from sqlalchemy import Connection

from research.model.ros.outcomes import HeldOutReadError
from research.model.weekly2.guard import fit_reader
from research.model.weekly5.gates import DEVELOPMENT_CHECK, ROUND_FIVE
from research.model.weekly5.preconditions import digest_mismatches
from research.model.weekly5.reads import fumbles_lost
from research.model.weekly5.round import store_clause


class _NoStatement:
    def execute(self, *args: Any, **kwargs: Any) -> Any:
        raise AssertionError("a refused season ran a statement")


@pytest.mark.parametrize(
    ("t", "season"), [(DEVELOPMENT_CHECK, 2023), (DEVELOPMENT_CHECK, 2024), (ROUND_FIVE, 2024), (ROUND_FIVE, 2026)]
)
def test_the_fumbles_reader_refuses_the_judged_season_and_after(t: Any, season: int) -> None:
    with pytest.raises(HeldOutReadError):
        fumbles_lost(cast("Connection", _NoStatement()), [season], fit_reader(t.round_three))


def test_the_fumbles_reader_keeps_its_ledger() -> None:
    reader = fit_reader(DEVELOPMENT_CHECK.round_three)
    assert reader.admit(2021).admit(2022).served == (2021, 2022)


def test_digest_mismatches_names_an_unchecked_or_moved_file_of_an_opened_season() -> None:
    record = {"features": {"digests": {"history-2023-teams.parquet": "a", "history-2022-teams.parquet": "b"}}}
    assert digest_mismatches({"history-2022-teams.parquet": "b"}, record, [2022]) == []
    assert digest_mismatches({"history-2022-teams.parquet": "b"}, record, [2022, 2023]) == [
        "history-2023-teams.parquet: not checked against a"
    ]
    assert digest_mismatches(
        {"history-2022-teams.parquet": "c", "history-2023-teams.parquet": "a"}, record, [2022, 2023]
    ) == ["history-2022-teams.parquet: c against b"]


def _report(read: list[int]) -> dict[str, Any]:
    season = {"season": 2023, "stamps": {"broken": 0}, "clause": {"team": {"holds": True}, "player": None}}
    return {"seasons": [season], "outcome_seasons_read": read}


def test_the_store_clause_fails_a_build_ledger_past_round_fours_last_season() -> None:
    assert store_clause(_report([2023, 2024]), 2023)[0]
    held, detail = store_clause(_report([2023, 2025]), 2023)
    assert not held and "2025" in detail
