"""One smoke test per package boundary (the founder's rule for build phases: parity is the gate).

Each package imports cleanly and exposes the surface the next phase builds on. The behaviour of
every ingest is proven by `python -m research.parity ingest all`, not here.
"""

import importlib

from research.db.legacy import LEGACY_TABLES, NEW_IN_RESEARCH, check_complete
from research.db.schema import METADATA, RESEARCH_SCHEMA
from research.parity.cases import ALL_CASES
from research.pipeline.commands import COMMANDS


def test_every_package_imports() -> None:
    for name in ("pipeline", "model", "capsules", "nightly", "advisor", "boards", "db", "parity"):
        module = importlib.import_module(f"research.{name}")
        assert module.__doc__, f"research.{name} states what lands in it"


def test_schema_holds_the_research_tables() -> None:
    assert len(METADATA.tables) == len(LEGACY_TABLES) + len(NEW_IN_RESEARCH)
    assert all(table.schema == RESEARCH_SCHEMA for table in METADATA.tables.values())
    assert not METADATA.tables[f"{RESEARCH_SCHEMA}.register_freeze_rows"].c["implementation"].nullable


def test_every_research_table_has_one_legacy_entry() -> None:
    check_complete()
    assert set(LEGACY_TABLES) | set(NEW_IN_RESEARCH) == {table.name for table in METADATA.tables.values()}
    assert not set(LEGACY_TABLES) & set(NEW_IN_RESEARCH)


def test_a_legacy_entry_finds_lost_and_stale_columns() -> None:
    entry = LEGACY_TABLES["provider_players"]
    assert entry.unaccounted(["id", "name", "position", "nfl_team", "adp", "pos_adp", "headshot_url"]) == ()
    assert entry.unaccounted(["id", "name", "position", "nfl_team", "adp", "pos_adp", "headshot_url", "x"]) == (
        "legacy players.x neither read nor dropped",
    )
    assert entry.unaccounted(["id", "name", "position", "adp", "pos_adp", "headshot_url"]) == (
        "provider_players names legacy players.nfl_team, which does not exist",
    )


def test_every_case_names_tables_and_every_command_runs_something() -> None:
    assert all(case.tables for case in ALL_CASES)
    assert len({case.name for case in ALL_CASES}) == len(ALL_CASES)
    assert all(callable(command.run) for command in COMMANDS.values())
