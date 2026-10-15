"""The shared reads weekly round 3 leans on: the newest row a read returned, and an as-of read
narrowed to a few metrics."""

from datetime import UTC, datetime
from typing import Any, cast

from sqlalchemy import Connection

from research.model.reads.observations import ObservationQuery, WeekRange, observations_as_of
from research.model.reads.stamps import Newest, newest_of

_EARLY = datetime(2023, 10, 1, tzinfo=UTC)
_LATE = datetime(2023, 10, 9, tzinfo=UTC)


def test_the_newest_row_keeps_the_largest_week_and_apart_from_it_the_largest_stamp() -> None:
    found = newest_of([(2023, 4, _LATE), (2023, 5, _EARLY), (2022, 18, _EARLY)])
    assert found == Newest(2023, 5, _LATE)


def test_a_read_that_returned_nothing_has_no_newest_row() -> None:
    assert newest_of([]) is None


class _Recording:
    def __init__(self) -> None:
        self.calls: list[tuple[str, dict[str, Any]]] = []

    def execute(self, statement: object, params: dict[str, Any]) -> list[object]:
        self.calls.append((str(statement), params))
        return []


def test_an_as_of_read_can_be_narrowed_to_named_metrics() -> None:
    conn = _Recording()
    query = ObservationQuery(2023, WeekRange(1, 5), _LATE, metrics=("targets", "carries"))
    observations_as_of(cast(Connection, conn), query)
    sql, params = conn.calls[0]
    assert "metric = any(:metrics)" in sql
    assert params["metrics"] == ["targets", "carries"]


def test_an_unnarrowed_read_names_no_metric() -> None:
    conn = _Recording()
    observations_as_of(cast(Connection, conn), ObservationQuery(2023, 5, _LATE))
    sql, params = conn.calls[0]
    assert ":metrics" not in sql
    assert "metrics" not in params
