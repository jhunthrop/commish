"""What a job reads once instead of on every use: the night's facts pass, a generation's candidates."""

from collections.abc import Sequence
from contextlib import nullcontext
from datetime import UTC, datetime
from typing import Any, cast

from sqlalchemy import Connection

from research.boards.custom import CandidateMemo
from research.capsules.sweep import FactsPassMemo, Subject
from research.db.read_cache import UNCACHED, ReadThrough
from research.model.preseason.candidates import BoardCandidate

_CONN = cast("Connection", object())
_SNAPSHOT = cast("Connection", object())
_NIGHT = datetime(2026, 10, 15, 5, tzinfo=UTC)


def test_the_facts_pass_is_read_once_an_instant() -> None:
    calls: list[tuple[datetime, ReadThrough]] = []

    def read(conn: Connection, as_of: datetime, history: ReadThrough) -> Sequence[Subject]:
        assert conn is _SNAPSHOT, "the pass reads its own snapshot, not the caller's connection"
        calls.append((as_of, history))
        return [cast("Subject", f"sheet at {as_of.isoformat()}")]

    memo = FactsPassMemo(lambda: nullcontext(_SNAPSHOT), UNCACHED, read)
    first = memo(_CONN, _NIGHT)
    assert memo(_CONN, _NIGHT) is first
    later = datetime(2026, 10, 16, 5, tzinfo=UTC)
    assert memo(_CONN, later) != first
    assert [at for at, _ in calls] == [_NIGHT, later]
    assert all(history is UNCACHED for _, history in calls)


def test_a_generations_candidates_are_read_once_and_a_newer_generation_replaces_them() -> None:
    reads: list[tuple[int, str, datetime]] = []

    def read(conn: Connection, season: int, source: str, as_of: datetime) -> list[BoardCandidate]:
        del conn
        reads.append((season, source, as_of))
        return [cast("Any", (source, as_of))]

    memo = CandidateMemo(read)
    newer = datetime(2026, 10, 16, tzinfo=UTC)
    memo(_CONN, 2026, "ppr", _NIGHT)
    memo(_CONN, 2026, "ppr", _NIGHT)
    memo(_CONN, 2026, "half", _NIGHT)
    assert list(memo(_CONN, 2026, "ppr", newer)) == [cast("Any", ("ppr", newer))]
    memo(_CONN, 2026, "ppr", newer)
    assert reads == [(2026, "ppr", _NIGHT), (2026, "half", _NIGHT), (2026, "ppr", newer)]
