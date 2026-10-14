"""THE TRANSFER METER: what each statement a job runs brings back over the wire, for measuring.

One `after_cursor_execute` listener on an engine. psycopg 3's client-side cursor holds the whole
result once `execute` returns, so the listener reads its row count and the width of every value
from the result itself (`pgresult.get_value`; a null carries no value bytes), and the wire's DataRow framing on top (a message
header of five bytes, a field count of two, a length word of four per value): the bytes the server
sent for those rows, short only of the result's column descriptions. A result past `sample_rows`
is measured on evenly spaced rows and scaled, and says so.

Nothing the job does changes: the listener reads the result the cursor already holds. Each read is
attributed to the job's step by the call stack (the innermost frame whose function a scenario names
as a step) and to its reader (the innermost frame in the research package outside the meter).
"""

import hashlib
import re
import sys
from collections.abc import Mapping
from dataclasses import dataclass
from types import FrameType
from typing import Any, Final, Protocol

from sqlalchemy import Engine, event

_DATA_ROW_HEADER: Final = 5 + 2
_LENGTH_WORD: Final = 4
DEFAULT_SAMPLE_ROWS: Final = 2_000
UNATTRIBUTED: Final = "(outside a named step)"
_PACKAGE: Final = "research."
_SKIPPED_MODULES: Final = ("research.db.meter", "research.transfer")
_TABLE: Final = re.compile(r"\b(?:from|join)\s+([a-z_]+\.[a-z_]+)", re.IGNORECASE)
_EXPANDED: Final = re.compile(r"(%\([a-z_]+_\d+\)s(?:,\s*)?)+", re.IGNORECASE)
_SPACE: Final = re.compile(r"\s+")
_PARAMETERS_WIDTH: Final = 240


class PgResult(Protocol):
    """The part of psycopg's `PGresult` the meter reads."""

    @property
    def ntuples(self) -> int: ...

    @property
    def nfields(self) -> int: ...

    def get_value(self, row_number: int, column_number: int) -> bytes | None: ...


@dataclass(frozen=True, slots=True)
class WireSize:
    rows: int
    bytes: int
    sampled: bool


def wire_size(result: PgResult | None, sample_rows: int = DEFAULT_SAMPLE_ROWS) -> WireSize:
    """The DataRow bytes `result` took on the wire; values of a sample of rows when there are many."""
    if result is None or result.ntuples == 0:
        return WireSize(0, 0, False)
    rows, fields = result.ntuples, result.nfields
    step = max(1, rows // sample_rows)
    measured = range(0, rows, step)
    values = sum(len(result.get_value(row, column) or b"") for row in measured for column in range(fields))
    per_row = values / len(measured) + _DATA_ROW_HEADER + _LENGTH_WORD * fields
    return WireSize(rows, round(per_row * rows), step > 1)


def statement_shape(sql: str) -> str:
    """The statement with its whitespace collapsed and an expanded IN list as one placeholder."""
    return _SPACE.sub(" ", _EXPANDED.sub("%(list)s", sql)).strip()


def tables_read(sql: str) -> tuple[str, ...]:
    """The schema-qualified tables a statement names after `from` or `join`, each once, in order."""
    return tuple(dict.fromkeys(match.lower() for match in _TABLE.findall(sql)))


@dataclass(frozen=True, slots=True)
class StatementRead:
    step: str
    reader: str
    shape: str
    rows: int
    bytes: int
    sampled: bool
    # The bound parameters, abbreviated: two reads of one shape with equal parameters read the same rows.
    parameters: str


def _abbreviated(parameters: Any) -> str:
    shown = repr(parameters)
    if len(shown) <= _PARAMETERS_WIDTH:
        return shown
    return f"{shown[:_PARAMETERS_WIDTH]}... (sha1 {hashlib.sha1(shown.encode()).hexdigest()[:12]})"


def attribution(frame: FrameType | None, steps: Mapping[str, str]) -> tuple[str, str]:
    """(the innermost named step on the stack, the innermost research function outside the meter)."""
    step: str | None = None
    reader: str | None = None
    while frame is not None and step is None:
        module = str(frame.f_globals.get("__name__", ""))
        name = frame.f_code.co_name
        if reader is None and module.startswith(_PACKAGE) and not module.startswith(_SKIPPED_MODULES):
            reader = f"{module.removeprefix(_PACKAGE)}:{name}"
        step = steps.get(name)
        frame = frame.f_back
    return step or UNATTRIBUTED, reader or "(no research frame)"


class TransferMeter:
    """Every statement's read on the engines it is attached to, in the order they ran."""

    def __init__(self, steps: Mapping[str, str], sample_rows: int = DEFAULT_SAMPLE_ROWS) -> None:
        self._steps = dict(steps)
        self._sample_rows = sample_rows
        self._reads: list[StatementRead] = []

    def attach(self, engine: Engine) -> None:
        event.listen(engine, "after_cursor_execute", self._after)

    @property
    def reads(self) -> tuple[StatementRead, ...]:
        return tuple(self._reads)

    def _after(  # noqa: PLR0913, PLR0917 - SQLAlchemy's listener signature
        self, conn: Any, cursor: Any, statement: str, parameters: Any, context: Any, executemany: bool
    ) -> None:
        del conn, context, executemany
        size = wire_size(getattr(cursor, "pgresult", None), self._sample_rows)
        step, reader = attribution(sys._getframe(1), self._steps)
        shape = statement_shape(statement)
        read = StatementRead(step, reader, shape, size.rows, size.bytes, size.sampled, _abbreviated(parameters))
        self._reads.append(read)
