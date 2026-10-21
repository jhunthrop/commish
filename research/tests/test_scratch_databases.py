"""Scratch databases in one family per admin database (B85).

The names are pure and always run. The sweep runs against PARITY_DATABASE_URL (skipped without it):
it drops its own family's leftovers and leaves another family's on the same server.
"""

import os

import psycopg
import pytest

from research.errors import ConfigurationError
from research.parity import databases
from research.parity.databases import MAX_NAME_BYTES, family_prefix, scratch_name

_LANE_A = "postgres://commish:commish@localhost:5433/lane110_research_test"
_LANE_B = "postgres://commish:commish@localhost:5433/lane111_research_test"


def test_a_scratch_name_carries_the_admin_databases_family() -> None:
    assert family_prefix(_LANE_A) == "parity_lane110_research_test__"
    assert scratch_name("parity_test_designations", _LANE_A) == "parity_lane110_research_test__test_designations"
    assert scratch_name("parity_test_designations", _LANE_B) == "parity_lane111_research_test__test_designations"


def test_one_familys_names_never_start_anothers_prefix() -> None:
    # Runs of anything outside [a-z0-9] are one underscore, so `__` only ever ends the prefix.
    assert family_prefix("postgres://h/Lane-110__x") == "parity_lane_110_x__"
    short, longer = family_prefix("postgres://h/lane"), family_prefix("postgres://h/lane__110")
    assert not scratch_name("parity_x", "postgres://h/lane__110").startswith(short)
    assert longer == "parity_lane_110__"


def test_a_long_name_is_shortened_with_a_digest_of_the_whole() -> None:
    role_a, role_b = f"parity_{'a' * 70}_one", f"parity_{'a' * 70}_two"
    name_a, name_b = scratch_name(role_a, _LANE_A), scratch_name(role_b, _LANE_A)
    assert len(name_a) == MAX_NAME_BYTES
    assert name_a != name_b
    assert name_a.startswith(family_prefix(_LANE_A))
    long_family = f"postgres://h/{'x' * 80}"
    assert len(family_prefix(long_family)) <= len("parity_") + databases.MAX_FAMILY_CHARS + 2
    assert family_prefix(long_family) != family_prefix(f"postgres://h/{'x' * 81}")


@pytest.mark.parametrize("role", ["commish", "parity-x", "Parity_x", "parity_"])
def test_a_name_not_shaped_parity_is_refused(role: str) -> None:
    with pytest.raises(ConfigurationError):
        scratch_name(role, _LANE_A)


def test_an_admin_url_naming_no_database_is_refused() -> None:
    with pytest.raises(ConfigurationError):
        family_prefix("postgres://commish:commish@localhost:5433/")


@pytest.mark.skipif(not os.environ.get("PARITY_DATABASE_URL"), reason="needs PARITY_DATABASE_URL")
def test_the_sweep_drops_its_own_family_and_never_anothers(monkeypatch: pytest.MonkeyPatch) -> None:
    """Two families on the run's own server, each admin database a child of the run's own name, so the
    sweep under test never reaches the run's family (its other modules' scratch databases)."""
    real = databases.admin_url()
    family = family_prefix(real).removeprefix("parity_").removesuffix("__")
    mine, theirs = f"{family}_b85_mine", f"{family}_b85_theirs"
    neighbour = scratch_name("parity_b85_neighbour", databases.url_for(theirs))
    with psycopg.connect(real, autocommit=True) as conn:
        for name in (mine, neighbour):
            conn.execute(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)')
            conn.execute(f'CREATE DATABASE "{name}"')
    try:
        monkeypatch.setenv("PARITY_DATABASE_URL", databases.url_for(mine))
        databases.recreate("parity_b85_own")
        dropped = databases.drop_scratch_databases()
        assert dropped == [scratch_name("parity_b85_own", databases.admin_url())]
        with psycopg.connect(real, autocommit=True) as conn:
            names = {str(r[0]) for r in conn.execute("select datname from pg_database")}
        assert neighbour in names
    finally:
        monkeypatch.undo()
        with psycopg.connect(real, autocommit=True) as conn:
            for name in (neighbour, mine, scratch_name("parity_b85_own", databases.url_for(mine))):
                conn.execute(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)')
