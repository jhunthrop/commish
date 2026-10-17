"""The live filings (round 4 amendment 2 item 7): Tank01's word from lane 63's status rows, read as
of the capture's last check, which must be at or before t_g; a season-long status is withheld as
Out is; with no check recorded there is no filing."""

from collections import namedtuple
from datetime import UTC, datetime, timedelta
from typing import Any, cast

import pytest
from sqlalchemy import Connection

from research.model.weekly3.ledger import InputRuleError
from research.model.weekly4.features.filings import CHECKED_QUERY, live_statuses, status_of_word

_T = datetime(2026, 10, 18, 16, 59, 59, 999000, tzinfo=UTC)
_Status = namedtuple("_Status", "player_id status status_source")


class _Conn:
    def __init__(self, checked: datetime | None) -> None:
        self.checked = checked

    def execute(self, statement: Any, params: dict[str, Any]) -> list[Any]:
        if str(statement) == CHECKED_QUERY:
            assert params["sources"] == ["tank01_injuries"]
            return [] if self.checked is None else [(self.checked,)]
        return [
            _Status("00-1", "questionable", "tank01_injuries"),
            _Status("00-2", "injured_reserve", "tank01_injuries"),
            _Status("00-3", "doubtful", "tank01_injuries"),
        ]


def test_the_words_map_to_the_filter_and_an_unknown_word_is_refused() -> None:
    assert [status_of_word(w) for w in ("questionable", "doubtful", "out", "pup")] == [
        "questionable",
        "withheld",
        "withheld",
        "withheld",
    ]
    with pytest.raises(ValueError, match="does not know"):
        status_of_word("probable")


def test_the_live_filings_are_read_at_the_captures_last_check() -> None:
    found, stamp = live_statuses(cast(Connection, _Conn(_T - timedelta(hours=1))), 2026, 7, _T)
    assert found == {"00-1": "questionable", "00-2": "withheld", "00-3": "withheld"}
    assert stamp.kind == "filings" and stamp.rows == 1


def test_a_check_after_the_instant_is_refused_and_no_check_is_no_filing() -> None:
    with pytest.raises(InputRuleError):
        live_statuses(cast(Connection, _Conn(_T + timedelta(minutes=1))), 2026, 7, _T)
    found, stamp = live_statuses(cast(Connection, _Conn(None)), 2026, 7, _T)
    assert found == {} and stamp.rows == 0
