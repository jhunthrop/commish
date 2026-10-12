"""WHAT A PARITY CASE IS: one ingest, its recorded inputs, the tables it writes, and both runs.

A case names the fixture sets it replays, the tables it compares (with each table's natural key),
the Python steps to run, the TypeScript case of the same name in `parity/ts/run.ts`, any seed rows
both databases start from, and the fixed instant both sides read as "now". It also names how its
inputs were recorded, so `python -m research.parity record <case>` can re-record them from the
real provider.
"""

from collections.abc import Callable, Sequence
from dataclasses import dataclass, field
from datetime import datetime

from sqlalchemy import Connection

from research.parity.diff import TableSpec
from research.parity.record import RecordSpec
from research.pipeline.http import Fetcher


@dataclass(frozen=True)
class RunContext:
    fetcher: Fetcher
    now: datetime


@dataclass(frozen=True)
class Recording:
    """How a fixture set was recorded: the requests, and the note the manifest carries."""

    fixture_set: str
    # Given the live fetcher, so a recipe can read one response to learn the next URLs (a week's
    # fixtures name its box scores).
    specs: Callable[[Fetcher], Sequence[RecordSpec]]
    note: str


@dataclass(frozen=True)
class Case:
    name: str
    summary: str
    fixture_sets: tuple[str, ...]
    tables: tuple[TableSpec, ...]
    run_python: Callable[[Connection, RunContext], None]
    now: datetime
    # SQL statements run against BOTH scratch databases before either ingest, for a case whose
    # ingest reads rows another ingest (or the app) writes. Seeds are recorded real rows too.
    seed_sql: tuple[str, ...] = ()
    recordings: tuple[Recording, ...] = field(default_factory=tuple)
