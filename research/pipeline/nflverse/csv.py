"""A STRICT RFC 4180 reader, ported from `src/projections/nflverse/csv.ts` character for character.

Python's `csv` module is lenient in exactly the ways the TypeScript docblock rules out (a ragged
row is returned as-is, a stray quote is recovered from), and parity is row for row, so this keeps
the TypeScript splitter's own state machine: quoted fields may hold commas, newlines and doubled
quotes; a lone `\\r` is dropped; a ragged row or a duplicated header THROWS.
"""

from collections.abc import Iterable, Mapping

from research.errors import SchemaDriftError

CsvRow = Mapping[str, str]


class CsvSplitter:
    """Splits CSV text into records across chunk boundaries (`CsvSplitter` in csv.ts)."""

    def __init__(self) -> None:
        self._fields: list[str] = []
        self._field: list[str] = []
        self._quoted = False
        self._started = False
        self._pending_quote = False

    def _end_field(self) -> None:
        self._fields.append("".join(self._field))
        self._field = []
        self._started = True

    def feed(self, text: str) -> list[list[str]]:
        records: list[list[str]] = []
        for char in text:
            if self._pending_quote:
                self._pending_quote = False
                if char == '"':
                    self._field.append('"')
                    continue
                self._quoted = False
            if self._quoted:
                if char != '"':
                    self._field.append(char)
                else:
                    self._pending_quote = True
                continue
            if char == '"' and not self._field:
                self._quoted = True
            elif char == ",":
                self._end_field()
            elif char == "\n":
                self._end_field()
                records.append(self._fields)
                self._fields = []
                self._started = False
            elif char != "\r":
                self._field.append(char)
            else:
                self._started = self._started or len(self._field) > 0
        return records

    def end(self) -> list[list[str]]:
        if not self._field and not self._fields and not self._started:
            return []
        self._fields.append("".join(self._field))
        record = self._fields
        self._fields = []
        self._field = []
        self._started = False
        return [record]


def split_records(text: str) -> list[list[str]]:
    splitter = CsvSplitter()
    return [*splitter.feed(text), *splitter.end()]


def parse_csv(text: str) -> list[dict[str, str]]:
    """`parseCsv`: header-keyed rows, throwing on a missing or duplicated header or a ragged row."""
    records = split_records(text)
    header = records[0] if records else None
    if header is None or len(header) == 0 or (len(header) == 1 and header[0] == ""):
        raise SchemaDriftError("nflverse CSV has no header row.")
    for index, name in enumerate(header):
        if header.index(name) != index:
            raise SchemaDriftError(f'nflverse CSV header has a duplicate column "{name}".')
    rows: list[dict[str, str]] = []
    for index, record in enumerate(records[1:]):
        if len(record) != len(header):
            raise SchemaDriftError(
                f"nflverse CSV row {index + 2} has {len(record)} fields; the header declares {len(header)}. "
                "The download is truncated or the schema changed."
            )
        rows.append(dict(zip(header, record, strict=True)))
    return rows


def project_records(records: Iterable[list[str]], columns: tuple[str, ...], asset: str) -> Iterable[dict[str, str]]:
    """`streamCsv`'s projection: the first record is the header, each later record yields only
    `columns`, a named column the header lacks or a ragged row is a schema change."""
    wanted: list[tuple[str, int]] | None = None
    width = 0
    rows = 0
    for record in records:
        if wanted is None:
            width = len(record)
            wanted = []
            for name in columns:
                if name not in record:
                    raise SchemaDriftError(f'nflverse asset {asset} has no column "{name}"; the schema changed.')
                wanted.append((name, record.index(name)))
            continue
        if len(record) != width:
            raise SchemaDriftError(
                f"nflverse asset {asset} row {rows + 2} has {len(record)} fields; the header declares {width}. "
                "The download is truncated or the schema changed."
            )
        rows += 1
        yield {name: record[index] for name, index in wanted}
    if wanted is None:
        raise SchemaDriftError(f"nflverse returned an empty body for {asset}.")
