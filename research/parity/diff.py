"""THE ROW DIFF: what the TypeScript ingest wrote against what the Python ingest wrote.

Each compared table is read whole from both scratch databases, keyed by its natural key (the
columns of its unique fact index), and compared column by column. Three things are excluded, and
only these: a surrogate serial `id` (a sequence draw, not a fact), and a bookkeeping timestamp the
DATABASE fills with `now()` that neither implementation sets (`ingested_at` and its kin). Every
other column must be equal. A float column may carry a tolerance only where a `Tolerance` names it
and says why; there are none by default.
"""

import json
import math
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from datetime import datetime
from decimal import Decimal

import psycopg

from research.db.schema import METADATA

# Bookkeeping columns Postgres fills with now(); neither implementation writes them.
DATABASE_STAMPED = frozenset({"ingested_at", "created_at", "computed_at", "published_at", "generated_at"})


@dataclass(frozen=True)
class Tolerance:
    column: str
    absolute: float
    why: str


@dataclass(frozen=True)
class TableSpec:
    """One table a case compares: its natural key, and any stated float tolerances."""

    table: str
    key: tuple[str, ...]
    tolerances: tuple[Tolerance, ...] = ()
    # Columns this case's writer stamps with the database clock even though the column has no
    # default of its own: excluded by name, with the reason in the case definition.
    also_excluded: tuple[str, ...] = ()


@dataclass
class TableDiff:
    table: str
    ts_rows: int
    py_rows: int
    only_ts: list[str] = field(default_factory=list)
    only_py: list[str] = field(default_factory=list)
    differing: list[str] = field(default_factory=list)
    duplicate_keys: list[str] = field(default_factory=list)

    @property
    def matches(self) -> bool:
        return not (self.only_ts or self.only_py or self.differing or self.duplicate_keys)


def compared_columns(spec: TableSpec) -> list[str]:
    table = METADATA.tables[spec.table]
    serial = {c.name for c in table.primary_key.columns if c.name == "id" and c.autoincrement is True}
    return [
        c.name
        for c in table.columns
        if c.name not in DATABASE_STAMPED and c.name not in serial and c.name not in spec.also_excluded
    ]


def _normalize(value: object) -> object:
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, (dict, list)):
        return json.dumps(value, sort_keys=True)
    return value


def read_table(url: str, spec: TableSpec, columns: Sequence[str]) -> list[dict[str, object]]:
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


def _key_of(row: Mapping[str, object], key: Sequence[str]) -> str:
    return "|".join(str(row[c]) for c in key)


def _index(
    rows: Sequence[dict[str, object]], key: Sequence[str], dupes: list[str], side: str
) -> dict[str, dict[str, object]]:
    indexed: dict[str, dict[str, object]] = {}
    for row in rows:
        k = _key_of(row, key)
        if k in indexed:
            dupes.append(f"{side} {k}")
        indexed[k] = row
    return indexed


def diff_table(ts_url: str, py_url: str, spec: TableSpec, limit: int = 20) -> TableDiff:
    columns = compared_columns(spec)
    ts_rows = read_table(ts_url, spec, columns)
    py_rows = read_table(py_url, spec, columns)
    result = TableDiff(table=spec.table, ts_rows=len(ts_rows), py_rows=len(py_rows))
    ts = _index(ts_rows, spec.key, result.duplicate_keys, "ts")
    py = _index(py_rows, spec.key, result.duplicate_keys, "py")
    tolerances = {t.column: t for t in spec.tolerances}
    for k in sorted(ts.keys() - py.keys()):
        result.only_ts.append(k)
    for k in sorted(py.keys() - ts.keys()):
        result.only_py.append(k)
    for k in sorted(ts.keys() & py.keys()):
        for column in columns:
            a, b = ts[k][column], py[k][column]
            if not _equal(a, b, tolerances.get(column)):
                result.differing.append(f"{k} {column}: ts={a!r} py={b!r}")
    result.only_ts = result.only_ts[:limit] + (
        [f"... {len(result.only_ts) - limit} more"] if len(result.only_ts) > limit else []
    )
    result.only_py = result.only_py[:limit] + (
        [f"... {len(result.only_py) - limit} more"] if len(result.only_py) > limit else []
    )
    total_differing = len(result.differing)
    if total_differing > limit:
        result.differing = [*result.differing[:limit], f"... {total_differing - limit} more"]
    return result
