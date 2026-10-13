"""THE ROW DIFF: what the TypeScript ingest wrote against what the Python ingest wrote.

Each compared table is read whole from both scratch databases, keyed by its natural key (the
columns of its unique fact index, as a typed tuple, so `None` and `"None"` never collide), and
compared column by column. Three things are excluded, and only these: a surrogate serial `id` (a
sequence draw, not a fact), and a bookkeeping timestamp the DATABASE fills with `now()` that
neither implementation sets (`ingested_at` and its kin). Every other column must be equal. A float
column may carry a tolerance only where a `Tolerance` names it and says why; there are none.
"""

import json
import math
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from datetime import datetime
from decimal import Decimal
from typing import Final

import psycopg

from research.db.schema import METADATA

# Bookkeeping columns Postgres fills with now(); neither implementation writes them.
DATABASE_STAMPED: Final = frozenset({"ingested_at", "created_at", "computed_at", "published_at", "generated_at"})
_SHOWN_LINES: Final = 20

Value = object
Key = tuple[Value, ...]
Row = dict[str, Value]


@dataclass(frozen=True)
class Tolerance:
    column: str
    absolute: float
    why: str


@dataclass(frozen=True)
class TableSpec:
    """One table a case compares: its natural key, any stated tolerances, and whether it is the
    ingest under test or a prerequisite the case lands first (`setup`, counted once in the totals)."""

    table: str
    key: tuple[str, ...]
    tolerances: tuple[Tolerance, ...] = ()
    also_excluded: tuple[str, ...] = ()
    # False for a table whose writer is a plain insert and may legitimately hold two identical
    # rows under one key (an event's props fetched twice): rows under a key compare as multisets.
    unique: bool = True
    setup: bool = False

    def as_setup(self) -> "TableSpec":
        return TableSpec(self.table, self.key, self.tolerances, self.also_excluded, self.unique, setup=True)


@dataclass(frozen=True)
class TableDiff:
    table: str
    setup: bool
    ts_rows: int
    py_rows: int
    only_ts: tuple[str, ...] = ()
    only_py: tuple[str, ...] = ()
    differing: tuple[str, ...] = ()
    duplicate_keys: tuple[str, ...] = ()

    @property
    def empty(self) -> bool:
        """Nothing on either side: a vacuous comparison, which fails its case."""
        return self.ts_rows == 0 and self.py_rows == 0

    @property
    def matches(self) -> bool:
        return not (self.only_ts or self.only_py or self.differing or self.duplicate_keys or self.empty)

    @property
    def rows(self) -> int:
        return max(self.ts_rows, self.py_rows)


@dataclass
class _Collector:
    only_ts: list[str] = field(default_factory=list)
    only_py: list[str] = field(default_factory=list)
    differing: list[str] = field(default_factory=list)
    duplicate_keys: list[str] = field(default_factory=list)


def compared_columns(spec: TableSpec) -> list[str]:
    table = METADATA.tables[spec.table]
    serial = {c.name for c in table.primary_key.columns if c.name == "id" and c.autoincrement is True}
    excluded = DATABASE_STAMPED | serial | set(spec.also_excluded)
    return [c.name for c in table.columns if c.name not in excluded]


def _normalize(value: object) -> object:
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, (dict, list)):
        return json.dumps(value, sort_keys=True)
    return value


def read_table(url: str, spec: TableSpec, columns: Sequence[str]) -> list[Row]:
    column_sql = ", ".join(f'"{c}"' for c in columns)
    with psycopg.connect(url) as conn:
        cursor = conn.execute(f'select {column_sql} from "{spec.table}"')
        return [{c: _normalize(v) for c, v in zip(columns, row, strict=True)} for row in cursor.fetchall()]


def _equal(a: object, b: object, tolerance: Tolerance | None) -> bool:
    if isinstance(a, float) and isinstance(b, float):
        if math.isnan(a) and math.isnan(b):
            return True
        if tolerance is not None:
            return abs(a - b) <= tolerance.absolute
    return a == b


def _index(rows: Sequence[Row], key: Sequence[str]) -> dict[Key, list[Row]]:
    indexed: dict[Key, list[Row]] = {}
    for row in rows:
        indexed.setdefault(tuple(row[c] for c in key), []).append(row)
    return indexed


def _ordered(rows: list[Row], columns: Sequence[str]) -> list[Row]:
    return sorted(rows, key=lambda row: repr([row[c] for c in columns]))


def _shown(lines: list[str]) -> tuple[str, ...]:
    if len(lines) <= _SHOWN_LINES:
        return tuple(lines)
    return (*lines[:_SHOWN_LINES], f"... {len(lines) - _SHOWN_LINES} more")


def _compare_key(
    key: Key,
    ts_rows: list[Row],
    py_rows: list[Row],
    columns: Sequence[str],
    tolerances: Mapping[str, Tolerance],
    out: _Collector,
) -> None:
    if len(ts_rows) != len(py_rows):
        out.differing.append(f"{key!r}: ts holds {len(ts_rows)} row(s), py holds {len(py_rows)}")
        return
    for ts_row, py_row in zip(_ordered(ts_rows, columns), _ordered(py_rows, columns), strict=True):
        for column in columns:
            a, b = ts_row[column], py_row[column]
            if not _equal(a, b, tolerances.get(column)):
                out.differing.append(f"{key!r} {column}: ts={a!r} py={b!r}")


def diff_table(ts_url: str, py_url: str, spec: TableSpec) -> TableDiff:
    columns = compared_columns(spec)
    ts_rows = read_table(ts_url, spec, columns)
    py_rows = read_table(py_url, spec, columns)
    ts = _index(ts_rows, spec.key)
    py = _index(py_rows, spec.key)
    out = _Collector()
    if spec.unique:
        out.duplicate_keys.extend(f"ts {k!r}" for k, v in ts.items() if len(v) > 1)
        out.duplicate_keys.extend(f"py {k!r}" for k, v in py.items() if len(v) > 1)
    out.only_ts.extend(repr(k) for k in sorted(ts.keys() - py.keys(), key=repr))
    out.only_py.extend(repr(k) for k in sorted(py.keys() - ts.keys(), key=repr))
    tolerances = {t.column: t for t in spec.tolerances}
    for key in sorted(ts.keys() & py.keys(), key=repr):
        _compare_key(key, ts[key], py[key], columns, tolerances, out)
    return TableDiff(
        table=spec.table,
        setup=spec.setup,
        ts_rows=len(ts_rows),
        py_rows=len(py_rows),
        only_ts=_shown(out.only_ts),
        only_py=_shown(out.only_py),
        differing=_shown(out.differing),
        duplicate_keys=_shown(out.duplicate_keys),
    )
