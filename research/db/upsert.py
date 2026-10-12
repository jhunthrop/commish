"""THE UPSERT HELPERS (`src/db/upsert.ts`), with the same semantics.

`excluded_set` updates EVERY non-key column from `excluded` (a column the insert did not name
arrives there as its default, exactly as in the TypeScript), optionally keeping the stored value
where the incoming one is null. `changed_row_where` makes an unchanged re-insert a true no-op:
`(stored columns) IS DISTINCT FROM (incoming columns)`, so RETURNING counts only rows that moved.
"""

from collections.abc import Iterable, Sequence

from sqlalchemy import ColumnElement, Table, func, tuple_
from sqlalchemy.dialects.postgresql import Insert


def _non_key(table: Table, keys: Iterable[str]) -> list[str]:
    excluded = set(keys)
    return [column.name for column in table.columns if column.name not in excluded]


def _incoming(statement: Insert, table: Table, column: str, keep_when_null: Sequence[str]) -> ColumnElement[object]:
    incoming: ColumnElement[object] = statement.excluded[column]
    if column in keep_when_null:
        return func.coalesce(incoming, table.c[column])
    return incoming


def excluded_set(
    statement: Insert, table: Table, keys: Sequence[str], keep_when_null: Sequence[str] = ()
) -> dict[str, ColumnElement[object]]:
    return {column: _incoming(statement, table, column, keep_when_null) for column in _non_key(table, keys)}


def changed_row_where(
    statement: Insert, table: Table, keys: Sequence[str], keep_when_null: Sequence[str] = ()
) -> ColumnElement[bool]:
    columns = _non_key(table, keys)
    stored = tuple_(*[table.c[column] for column in columns])
    incoming = tuple_(*[_incoming(statement, table, column, keep_when_null) for column in columns])
    return stored.is_distinct_from(incoming)
