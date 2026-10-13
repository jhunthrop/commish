"""WHAT A MODEL CASE RETURNS, and the read-only reads of the dev store the cases compare against."""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any

import psycopg

from research.parity.model.compare import Diff
from research.parity.model.store import source_url


@dataclass(frozen=True, slots=True)
class Claim:
    """A stated fact the case checks beside its diffs (a moment taken, a run that exited cleanly)."""

    what: str
    holds: bool


@dataclass(frozen=True, slots=True)
class CaseResult:
    name: str
    diffs: list[Diff]
    notes: list[str] = field(default_factory=list)
    refusals_agree: bool = True
    claims: list[Claim] = field(default_factory=list)

    @property
    def matches(self) -> bool:
        return self.refusals_agree and all(diff.matches for diff in self.diffs) and all(c.holds for c in self.claims)


def source_rows(sql: str, params: tuple[Any, ...]) -> list[dict[str, Any]]:
    """Rows of the dev store, read only."""
    with psycopg.connect(source_url()) as conn:
        conn.read_only = True
        cursor = conn.execute(sql, params)
        names = [column.name for column in cursor.description or ()]
        return [dict(zip(names, row, strict=True)) for row in cursor]


def refusals(
    label: str, oracle_error: str | None, port_error: str | None, wording: Sequence[tuple[str, str]] = ()
) -> tuple[bool, list[str]]:
    """Both sides refuse or neither does, and a refusal is compared whole: the oracle's message with
    each declared (oracle words, port words) pair substituted must equal the port's message."""
    expected = oracle_error
    for theirs, ours in wording:
        expected = None if expected is None else expected.replace(theirs, ours)
    agree = expected == port_error
    notes = [f"{label}: oracle {oracle_error or 'did not refuse'}; port {port_error or 'did not refuse'}"]
    return agree, notes


def keyed_by(rows: Sequence[Mapping[str, Any]], *keys: str) -> dict[str, Mapping[str, Any]]:
    return {"|".join(str(row[key]) for key in keys): row for row in rows}
