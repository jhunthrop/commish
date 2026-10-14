"""What a job reads once instead of on every use: the night's facts pass, a generation's candidates."""

from collections.abc import Sequence
from datetime import UTC, datetime
from typing import cast

from sqlalchemy import Connection

from research.capsules.sweep import FactsPassMemo, Subject
from research.db.read_cache import UNCACHED, ReadThrough

_CONN = cast("Connection", object())
_NIGHT = datetime(2026, 10, 15, 5, tzinfo=UTC)


def test_the_facts_pass_is_read_once_an_instant() -> None:
    calls: list[tuple[datetime, ReadThrough]] = []

    def read(conn: Connection, as_of: datetime, history: ReadThrough) -> Sequence[Subject]:
        del conn
        calls.append((as_of, history))
        return [cast("Subject", f"sheet at {as_of.isoformat()}")]

    memo = FactsPassMemo(UNCACHED, read)
    first = memo(_CONN, _NIGHT)
    assert memo(_CONN, _NIGHT) is first
    later = datetime(2026, 10, 16, 5, tzinfo=UTC)
    assert memo(_CONN, later) != first
    assert [at for at, _ in calls] == [_NIGHT, later]
    assert all(history is UNCACHED for _, history in calls)
