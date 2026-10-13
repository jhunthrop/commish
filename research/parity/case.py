"""WHAT A PARITY CASE IS: one ingest, its recorded inputs, the tables it writes, and both runs.

A case names:

- the fixture sets it replays, and optionally an EARLIER recording to run first (`prior_fixture_sets`),
  so the later release lands on top of the earlier one exactly as a nightly run lands on yesterday;
- the tables it compares, each with its natural key, and whether a table is the ingest under test
  or a prerequisite the case had to land first (`TableSpec.setup`);
- the Python steps, which return the exit status of each operator script they mirror;
- the TypeScript side: the case of the same name in `parity/ts/cases.ts` (its setup, or the whole
  run when the oracle is a library function) and the operator scripts run unmodified after it;
- the fixed instant both sides read as now, and how its inputs were recorded.
"""

from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass, field
from datetime import datetime
from types import MappingProxyType

from sqlalchemy import Connection

from research.parity.diff import TableSpec
from research.parity.record import RecordSpec
from research.pipeline.checkpoint import Checkpoint
from research.pipeline.http import Fetcher

# A replayed run never holds a real key: the replay strips keys from URLs and checks none.
REPLAY_ENVIRON: Mapping[str, str] = MappingProxyType({"TANK01_API_KEY": "replay", "ODDS_API_KEY": "replay"})


@dataclass(frozen=True)
class RunContext:
    fetcher: Fetcher
    now: datetime
    # Commits the Python side's work so far, at the points the TypeScript's writes became durable.
    checkpoint: Checkpoint
    environ: Mapping[str, str] = REPLAY_ENVIRON


@dataclass(frozen=True)
class Recording:
    """How a fixture set was recorded: the requests, and the note the manifest carries."""

    fixture_set: str
    # Given the live fetcher, so a recipe can read one response to learn the next URLs (a week's
    # fixtures name its box scores).
    specs: Callable[[Fetcher], Sequence[RecordSpec]]
    note: str


@dataclass(frozen=True)
class Script:
    """An operator script the TypeScript side runs AS IS: a path under the repository root and its
    arguments. Its exit status is compared with the Python mirror's."""

    path: str
    args: tuple[str, ...] = ()


# The Python side of a case: the exit statuses of the scripts it mirrors, in order (empty when the
# oracle is a library function with no exit status of its own).
PythonRun = Callable[[Connection, RunContext], tuple[int, ...]]


@dataclass(frozen=True)
class Case:
    name: str
    summary: str
    fixture_sets: tuple[str, ...]
    tables: tuple[TableSpec, ...]
    run_python: PythonRun
    now: datetime
    recordings: tuple[Recording, ...] = field(default_factory=tuple)
    ts_scripts: tuple[Script, ...] = ()
    # An earlier recording of the same inputs: when set, a second pair of databases is run on it
    # first and then on `fixture_sets`, so the later release's upserts, supersedes and
    # changed-row checks are compared against a real earlier state.
    prior_fixture_sets: tuple[str, ...] = ()
