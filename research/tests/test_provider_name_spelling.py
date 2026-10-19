"""A name prints as he spells it (Lane 78): the provider roster wrote "Audric Estime" into
`provider_players.name`, where the board, the player page, the API's name field and the sheet's own
subject read his name, while nflverse spells him "Audric Estimé". Where the crosswalk joins a provider
player to the universe on his ESPN id and the two names differ only by the diacritics the provider
dropped, the provider row takes the universe's spelling: when the crosswalk is built, when the roster
is upserted again, and once, as a backfill, for the rows already stored.

The DB cases need PARITY_DATABASE_URL (a server where the harness may create `parity_*` databases);
skipped without it, and run by CI, which sets it.
"""

import argparse
import os
from dataclasses import replace
from datetime import UTC, datetime
from typing import cast

import pytest
from sqlalchemy import Connection, insert, select

from research.capsules.week.render import render_week_sheet
from research.capsules.week.validate import validate_week_read
from research.db.engine import make_engine
from research.db.schema import PLAYERS, PROVIDER_PLAYERS
from research.db.url import sqlalchemy_url
from research.parity import databases
from research.pipeline import commands
from research.pipeline.crosswalk import build_crosswalk, respell_provider_names, universe_spelling
from research.pipeline.http import Fetcher
from research.pipeline.tank01.ingest import ingest_roster_and_lines
from research.pipeline.tank01.mapping import Player
from research.pipeline.tank01.provider import Tank01Provider
from research.tests.week_read_fixtures import starter

_DATABASE = "parity_test_provider_names"
_NOW = datetime(2026, 10, 19, 12, 0, tzinfo=UTC)
_ESTIME = "Audric Estimé"
_ESTIME_AS_PROVIDED = "Audric Estime"
_ESPN = "4569682"
_GSIS = "00-0039373"


@pytest.mark.parametrize(
    ("provided", "universe", "spelled"),
    [
        (_ESTIME_AS_PROVIDED, _ESTIME, _ESTIME),
        # Already as he spells it, or the same name: nothing to change.
        (_ESTIME, _ESTIME, None),
        ("Bijan Robinson", "Bijan Robinson", None),
        # The provider keeps an accent of its own: never taken away.
        (_ESTIME, _ESTIME_AS_PROVIDED, None),
        # A suffix, punctuation or case is not a diacritic: the provider's form stands.
        ("Marvin Harrison", "Marvin Harrison Jr.", None),
        ("DJ Moore", "D.J. Moore", None),
        ("Amon-Ra St. Brown", "Amon-Ra St Brown", None),
        ("AJ Brown", "Aj Brown", None),
    ],
)
def test_the_universe_spelling_is_taken_only_for_the_diacritics_dropped(
    provided: str, universe: str, spelled: str | None
) -> None:
    assert universe_spelling(provided, universe) == spelled


def test_the_sheet_prints_his_name_with_its_accent_and_a_draft_naming_him_traces() -> None:
    sheet = replace(starter(), name=_ESTIME, position="RB", team="DEN")
    assert _ESTIME in render_week_sheet(sheet)
    draft = f"{_ESTIME} draws the early downs this week."
    assert not [v for v in validate_week_read(draft, sheet).violations if "does not trace" in v]


class _Roster:
    """The provider's roster alone, no weeks: `ingest_roster_and_lines` reads nothing else."""

    season = 2026
    last_week_of_season = 0

    def list_players(self) -> list[Player]:
        return [Player(_ESPN, _ESTIME_AS_PROVIDED, "RB", "DEN", None)]


def _seed(conn: Connection) -> None:
    conn.execute(
        insert(PLAYERS).values(
            id=_GSIS, name=_ESTIME, position="RB", latest_team="DEN", rookie_season=2024, espn_id=_ESPN
        )
    )
    conn.execute(insert(PROVIDER_PLAYERS).values(id=_ESPN, name=_ESTIME_AS_PROVIDED, position="RB", team="DEN"))


def _stored_name(conn: Connection) -> str:
    return str(conn.execute(select(PROVIDER_PLAYERS.c.name).where(PROVIDER_PLAYERS.c.id == _ESPN)).scalar_one())


def _backfill(conn: Connection) -> object:
    invocation = commands.Invocation(cast(Fetcher, None), argparse.Namespace(), lambda: None, _NOW, {})
    return commands.COMMANDS["provider-names"].run(conn, invocation)


@pytest.mark.skipif("PARITY_DATABASE_URL" not in os.environ, reason="needs a Postgres for scratch databases")
def test_every_writer_of_the_provider_name_keeps_his_spelling() -> None:
    url = databases.build_with_alembic(_DATABASE)
    engine = make_engine(sqlalchemy_url(url))
    try:
        with engine.begin() as conn:
            _seed(conn)
            # The backfill on a store whose crosswalk is already built: one row respelled, then none.
            build_crosswalk(conn, _NOW)
            conn.execute(PROVIDER_PLAYERS.update().values(name=_ESTIME_AS_PROVIDED))
            first = respell_provider_names(conn)
            assert (first.crossed, first.respelled) == (1, ((_ESTIME_AS_PROVIDED, _ESTIME),))
            assert _stored_name(conn) == _ESTIME
            assert respell_provider_names(conn).respelled == ()
            assert _backfill(conn) == "0 of 1 crossed provider names respelled"
            # The roster upsert writes the provider's spelling and keeps his.
            ingest_roster_and_lines(conn, cast(Tank01Provider, _Roster()))
            assert _stored_name(conn) == _ESTIME
            # A crosswalk build respells a row the roster wrote before the crosswalk knew him.
            conn.execute(PROVIDER_PLAYERS.update().values(name=_ESTIME_AS_PROVIDED))
            build_crosswalk(conn, _NOW)
            assert _stored_name(conn) == _ESTIME
            conn.execute(PROVIDER_PLAYERS.update().values(name=_ESTIME_AS_PROVIDED))
            assert _backfill(conn) == ("1 of 1 crossed provider names respelled (Audric Estime as Audric Estimé)")
    finally:
        engine.dispose()
        databases.drop(_DATABASE)
