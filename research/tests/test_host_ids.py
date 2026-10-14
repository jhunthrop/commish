"""The fantasy hosts' ids onto the universe: ambiguous ids left off, and a map that would wipe the
ids the companion places picks by refused whole."""

from collections.abc import Mapping
from typing import Any, cast

import pytest
from sqlalchemy import Connection

from research.errors import SchemaDriftError
from research.pipeline.host_ids import HostIds, ingest_host_ids, map_host_ids
from research.pipeline.http import HttpResponse

_HEADER = "gsis_id,sleeper_id,yahoo_id,mfl_id,name"


def _row(gsis: str, sleeper: str, yahoo: str = "NA", mfl: str = "NA") -> dict[str, str]:
    return {"gsis_id": gsis, "sleeper_id": sleeper, "yahoo_id": yahoo, "mfl_id": mfl, "name": "x"}


def test_ambiguous_ids_are_left_off() -> None:
    mapped, dropped = map_host_ids(
        [
            _row("00-1", "11", mfl="501"),
            _row("00-2", "11", mfl="502"),  # one Sleeper id on two players: off both
            _row("00-3", "33"),
            _row("00-3", "34"),  # one player stated two ways: off him
            _row("NA", "99"),
        ]
    )
    assert mapped == [HostIds("00-1", None, None, "501"), HostIds("00-2", None, None, "502")]
    assert dropped == 3  # noqa: PLR2004 - the two shared Sleeper ids and the player stated twice


def test_an_empty_map_is_refused() -> None:
    with pytest.raises(SchemaDriftError, match="empty"):
        map_host_ids([])


class _Result:
    def __init__(self, rows: list[tuple[Any, ...]]) -> None:
        self._rows = rows

    def __iter__(self) -> Any:
        return iter(self._rows)

    def scalar_one(self) -> Any:
        return self._rows[0][0]


class _Conn:
    """The universe of two players, both carrying an id now; records any write."""

    def __init__(self) -> None:
        self.writes = 0

    def execute(self, statement: Any, params: Mapping[str, Any] | None = None) -> _Result:
        sql = str(statement)
        if sql.startswith("select id"):
            return _Result([("00-1",), ("00-2",)])
        if sql.startswith("select count"):
            return _Result([(2,)])
        self.writes += 1
        return _Result([])


class _Fetcher:
    def __init__(self, body: str) -> None:
        self.body = body

    def get(self, url: str, headers: Mapping[str, str] | None = None) -> HttpResponse:
        del url, headers
        return HttpResponse(200, self.body.encode(), {})


def test_a_map_naming_too_few_of_ours_changes_nothing() -> None:
    conn = _Conn()
    with pytest.raises(SchemaDriftError, match="refused and nothing was changed"):
        ingest_host_ids(cast(Connection, conn), cast(Any, _Fetcher(f"{_HEADER}\n00-1,11,NA,NA,a\n")))
    assert conn.writes == 0
