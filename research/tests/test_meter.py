"""The transfer meter's arithmetic: wire bytes from a result, a statement's shape and tables, its step."""

import sys
from dataclasses import dataclass

from research.db.meter import UNATTRIBUTED, attribution, statement_shape, tables_read, wire_size


@dataclass(frozen=True, slots=True)
class FakeResult:
    values: tuple[tuple[bytes | None, ...], ...]

    @property
    def ntuples(self) -> int:
        return len(self.values)

    @property
    def nfields(self) -> int:
        return len(self.values[0]) if self.values else 0

    def get_value(self, row_number: int, column_number: int) -> bytes | None:
        return self.values[row_number][column_number]


def test_wire_size_counts_values_and_the_data_row_framing() -> None:
    result = FakeResult(((b"abc", None), (b"", b"12345")))
    # Each row: a 5-byte header, a 2-byte field count, a 4-byte length per value, then the values.
    assert wire_size(result) == wire_size(result, sample_rows=10)
    size = wire_size(result)
    assert (size.rows, size.bytes, size.sampled) == (2, 2 * (7 + 8) + 3 + 5, False)


def test_a_large_result_is_sampled_and_scaled() -> None:
    result = FakeResult(tuple((b"x" * 10,) for _ in range(1000)))
    size = wire_size(result, sample_rows=10)
    assert size.sampled
    assert size.bytes == 1000 * (7 + 4 + 10)


def test_no_result_is_no_bytes() -> None:
    assert wire_size(None).bytes == 0


def test_a_statement_shape_folds_an_expanded_list_and_names_its_tables() -> None:
    sql = "select a\n  from research.players p join research.player_crosswalk c on 1=1 where id in (%(id_1)s, %(id_2)s)"
    assert statement_shape(sql) == (
        "select a from research.players p join research.player_crosswalk c on 1=1 where id in (%(list)s)"
    )
    assert tables_read(sql) == ("research.players", "research.player_crosswalk")


def _named_step() -> tuple[str, str]:
    return attribution(sys._getframe(0), {"_named_step": "the step"})


def test_attribution_finds_the_innermost_named_step() -> None:
    step, _ = _named_step()
    assert step == "the step"
    assert attribution(sys._getframe(0), {})[0] == UNATTRIBUTED
