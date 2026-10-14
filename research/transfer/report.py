"""The measurement as markdown: a row per step, then the statements that brought back the most."""

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Final

from research.db.meter import StatementRead, tables_read
from research.transfer.proxy import WireTotals

SQL_WIDTH: Final = 160


@dataclass(frozen=True, slots=True)
class Tally:
    key: str
    statements: int
    rows: int
    bytes: int
    sampled: bool


def tally(reads: Sequence[StatementRead], key_of: str) -> list[Tally]:
    """Reads summed by `step` or by statement (`shape` within its step), most bytes first."""
    sums: dict[str, list[int]] = {}
    sampled: set[str] = set()
    for read in reads:
        key = read.step if key_of == "step" else f"{read.step}\x00{read.reader}\x00{read.shape}"
        cell = sums.setdefault(key, [0, 0, 0])
        cell[0] += 1
        cell[1] += read.rows
        cell[2] += read.bytes
        if read.sampled:
            sampled.add(key)
    return sorted(
        (Tally(key, n, rows, size, key in sampled) for key, (n, rows, size) in sums.items()),
        key=lambda t: -t.bytes,
    )


def mb(size: int) -> str:
    return f"{size / 1_000_000:,.2f} MB"


def render(scenario: str, summary: str, reads: Sequence[StatementRead], wire: WireTotals, top: int) -> str:
    total = sum(r.bytes for r in reads)
    lines = [
        f"## {scenario}",
        "",
        f"Outcome: {summary}",
        "",
        f"Meter: {len(reads)} statements, {sum(r.rows for r in reads):,} rows, {mb(total)} of DataRow bytes. "
        f"Relay: {mb(wire.from_server)} from the server, {mb(wire.to_server)} to it, {wire.connections} connections.",
        "",
        "| step | statements | rows | bytes |",
        "|---|---:|---:|---:|",
    ]
    lines += [
        f"| {t.key} | {t.statements:,} | {t.rows:,} | {mb(t.bytes)}{' (sampled)' if t.sampled else ''} |"
        for t in tally(reads, "step")
    ]
    lines += ["", f"Top {top} statements by bytes:", "", "| step | reader | runs | rows | bytes | tables | SQL |"]
    lines += ["|---|---|---:|---:|---:|---|---|"]
    for t in tally(reads, "statement")[:top]:
        step, reader, shape = t.key.split("\x00")
        sql = shape[:SQL_WIDTH].replace("|", "\\|")
        tables = ", ".join(tables_read(shape)) or "-"
        lines.append(f"| {step} | {reader} | {t.statements:,} | {t.rows:,} | {mb(t.bytes)} | {tables} | `{sql}` |")
    return "\n".join(lines) + "\n\n"
