"""THE STORE'S FILES: one Parquet file per season and row kind, byte for byte the same for the same
rows, with a SHA-256 digest per file for the run report.

Parquet, not a table, and why: these rows are what Lane 69's fit reads once, offline, on a scratch
copy; nothing at runtime reads them. The served number computes its live week's rows in process from
the store's tables by the same code (`season.build_season` with `live_after`), so no runtime read is
file-sourced (the 2026-09-08 ruling), and no new table, migration or production write is needed for
a fit that runs once. The fit's own outputs go to `model_artifacts`, as section 4 says.

Determinism: the rows are sorted by their key, every column is written in the schema's fixed order
and type, there is no schema metadata, and the writer's options are fixed; the file then depends only
on the rows and the pinned pyarrow (`uv.lock`).
"""

import hashlib
import math
from collections.abc import Sequence
from pathlib import Path
from typing import Final

import pyarrow as pa
import pyarrow.parquet as pq

from research.model.weekly4.features.rows import Row

Schema = Sequence[tuple[str, str]]
_TYPES: Final = {"int": pa.int64(), "float": pa.float64(), "str": pa.string()}
PLAYER_KEY: Final = ("season", "week", "club", "player_id")
TEAM_KEY: Final = ("season", "week", "club")
PLAY_KEY: Final = ("season", "week", "game_id", "play_id", "kind")


def _cell(value: object, kind: str) -> object:
    if value is None:
        return None
    if kind == "float":
        return float(value)  # type: ignore[arg-type]
    if kind == "int":
        return int(value)  # type: ignore[call-overload]
    return str(value)


def _sort_key(row: Row, key: Sequence[str]) -> tuple[str, ...]:
    return tuple(f"{row[k]:>12}" if isinstance(row[k], int) else str(row[k]) for k in key)


def arrow_table(rows: Sequence[Row], schema: Schema, key: Sequence[str]) -> pa.Table:
    names = {name for name, _ in schema}
    for row in rows:
        unknown = set(row) - names
        if unknown:
            raise ValueError(f"row columns outside the schema: {sorted(unknown)}")
    ordered = sorted(rows, key=lambda r: _sort_key(r, key))
    arrays = [pa.array([_cell(r.get(name), kind) for r in ordered], type=_TYPES[kind]) for name, kind in schema]
    return pa.Table.from_arrays(arrays, schema=pa.schema([pa.field(n, _TYPES[k]) for n, k in schema]))


def write_rows(rows: Sequence[Row], schema: Schema, key: Sequence[str], path: Path) -> str:
    """Write the rows and return the file's SHA-256 digest."""
    path.parent.mkdir(parents=True, exist_ok=True)
    pq.write_table(
        arrow_table(rows, schema, key),
        path,
        compression="zstd",
        compression_level=3,
        use_dictionary=True,
        write_statistics=False,
        store_schema=False,
    )
    return hashlib.sha256(path.read_bytes()).hexdigest()


def nan_share(rows: Sequence[Row], column: str) -> float:
    values = [r.get(column) for r in rows]
    missing = sum(1 for v in values if v is None or (isinstance(v, float) and math.isnan(v)))
    return missing / len(values) if values else 0.0
