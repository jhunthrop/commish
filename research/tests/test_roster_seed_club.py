"""The operator's roster seed leaves the club to the daily list (Lane 127, B103): `tank01-roster` writes
each listed player's name, position and headshot, a club only on a row it creates, and never rewrites a
stored club (a club the daily list moved, a free agent's NULL); its report says so. A row it creates takes
the club by the daily list's own rule (Lane 144): none for a player the list marks a free agent.

The DB case needs PARITY_DATABASE_URL (a server where the harness may create `parity_*` databases);
skipped without it, and run by CI, which sets it.
"""

import os
from typing import cast

import pytest
from sqlalchemy import insert, select

from research.db.engine import make_engine
from research.db.schema import PROVIDER_PLAYERS
from research.db.url import sqlalchemy_url
from research.parity import databases
from research.pipeline.tank01.ingest import SeedReport, ingest_roster_and_lines
from research.pipeline.tank01.mapping import Player, map_player_list
from research.pipeline.tank01.player_clubs import listed_clubs
from research.pipeline.tank01.provider import Tank01Provider

_DATABASE = "parity_test_roster_seed_club"
_MOVED, _FREE, _NEW, _NEW_FREE = "100", "200", "300", "400"


class _Roster:
    """The provider's roster alone, no weeks, each club as stale as the seed's read."""

    season = 2026
    last_week_of_season = 0

    def list_players(self) -> list[Player]:
        return [
            Player(_MOVED, "Moved Man", "WR", "MIA", "https://img/moved.png"),
            Player(_FREE, "Free Man", "RB", "DEN", None),
            Player(_NEW, "New Man", "TE", "KC", None),
            # The list names his last club and marks him a free agent.
            Player(_NEW_FREE, "New Free Man", "WR", "NYJ", None, free_agent=True),
        ]


def test_the_seed_and_the_daily_list_read_a_free_agent_alike() -> None:
    """One reading of the list's flag: the seed's player and the daily list's club agree."""
    body = [
        {"playerID": "1", "longName": "Free Man", "pos": "WR", "team": "NYJ", "isFreeAgent": "True"},
        {"playerID": "2", "longName": "Club Man", "pos": "RB", "team": "KC", "isFreeAgent": "False"},
    ]
    assert [(p.id, p.nfl_team, p.free_agent) for p in map_player_list(body)] == [
        ("1", "NYJ", True),
        ("2", "KC", False),
    ]
    assert listed_clubs(body) == {"1": None, "2": "KC"}


def test_the_report_says_what_the_seed_writes() -> None:
    assert str(SeedReport(players=3, stat_lines=0, new_players=1)) == (
        "3 players' names, positions and headshots (1 new, each with the list's club, none for a free agent; "
        "no stored club rewritten, the daily list owns it), 0 stat lines"
    )


@pytest.mark.skipif("PARITY_DATABASE_URL" not in os.environ, reason="needs a Postgres for scratch databases")
def test_the_seed_never_rewrites_a_stored_club() -> None:
    url = databases.build_with_alembic(_DATABASE)
    engine = make_engine(sqlalchemy_url(url))
    try:
        with engine.begin() as conn:
            # The daily list moved one to BUF and cleared the other (a free agent).
            conn.execute(
                insert(PROVIDER_PLAYERS),
                [
                    {"id": _MOVED, "name": "Moved Man", "position": "WR", "team": "BUF"},
                    {"id": _FREE, "name": "Free Man", "position": "RB", "team": None},
                ],
            )
            report = ingest_roster_and_lines(conn, cast(Tank01Provider, _Roster()))
            stored = {
                row.id: (row.team, row.headshot_url)
                for row in conn.execute(
                    select(PROVIDER_PLAYERS.c.id, PROVIDER_PLAYERS.c.team, PROVIDER_PLAYERS.c.headshot_url)
                )
            }
            assert stored == {
                _MOVED: ("BUF", "https://img/moved.png"),
                _FREE: (None, None),
                _NEW: ("KC", None),
                # Lane 144: a free agent's new row holds no club, as the daily list would write it.
                _NEW_FREE: (None, None),
            }
            assert (report.players, report.new_players, report.stat_lines) == (4, 2, 0)
            # Again: nothing new, nothing moved.
            again = ingest_roster_and_lines(conn, cast(Tank01Provider, _Roster()))
            assert again.new_players == 0
            assert (
                conn.execute(select(PROVIDER_PLAYERS.c.team).where(PROVIDER_PLAYERS.c.id == _MOVED)).scalar_one()
                == "BUF"
            )
    finally:
        engine.dispose()
        databases.drop(_DATABASE)
