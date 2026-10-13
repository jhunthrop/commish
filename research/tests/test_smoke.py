"""One smoke test per package boundary (the founder's rule for build phases: parity is the gate).

Each package imports cleanly and exposes the surface the next phase builds on. The behaviour of
every ingest is proven by `python -m research.parity ingest all`, not here.
"""

import importlib

from research.db.schema import METADATA
from research.parity.cases import ALL_CASES
from research.pipeline.commands import COMMANDS


def test_every_package_imports() -> None:
    for name in ("pipeline", "model", "capsules", "nightly", "advisor", "db", "parity"):
        module = importlib.import_module(f"research.{name}")
        assert module.__doc__, f"research.{name} states what lands in it"


def test_schema_holds_the_research_tables() -> None:
    assert len(METADATA.tables) == 29
    assert "implementation" in METADATA.tables["register_freeze_rows"].c


def test_every_case_names_tables_and_every_command_runs_something() -> None:
    assert all(case.tables for case in ALL_CASES)
    assert len({case.name for case in ALL_CASES}) == len(ALL_CASES)
    assert all(callable(command.run) for command in COMMANDS.values())
