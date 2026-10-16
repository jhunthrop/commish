# ruff: noqa: PLR2004 - the expected values are the rows written beside them
"""The store's files (lane 68, item 4): the same rows give byte-identical files and digests whatever
order they arrive in, NaN stays NaN, and a row with a column outside the schema is refused."""

import math
from pathlib import Path

import pyarrow.parquet as pq
import pytest

from research.model.weekly4.features.store import arrow_table, write_rows

_SCHEMA = (("season", "int"), ("week", "int"), ("club", "str"), ("value", "float"))
_KEY = ("season", "week", "club")


def _rows() -> list[dict[str, object]]:
    return [
        {"season": 2023, "week": 10, "club": "KC", "value": 1.5},
        {"season": 2023, "week": 9, "club": "BUF", "value": math.nan},
        {"season": 2023, "week": 9, "club": "ARI", "value": None},
    ]


def test_the_same_rows_in_any_order_give_byte_identical_files(tmp_path: Path) -> None:
    first = write_rows(_rows(), _SCHEMA, _KEY, tmp_path / "a.parquet")
    second = write_rows(list(reversed(_rows())), _SCHEMA, _KEY, tmp_path / "b.parquet")
    assert first == second
    assert (tmp_path / "a.parquet").read_bytes() == (tmp_path / "b.parquet").read_bytes()
    table = pq.read_table(tmp_path / "a.parquet")
    assert table.column("week").to_pylist() == [9, 9, 10]  # week 9 before week 10: numeric order
    values = table.column("value").to_pylist()
    assert values[0] is None and math.isnan(values[1]) and values[2] == 1.5


def test_a_column_outside_the_schema_is_refused() -> None:
    with pytest.raises(ValueError, match="outside the schema"):
        arrow_table([{**_rows()[0], "game_result": 1.0}], _SCHEMA, _KEY)
