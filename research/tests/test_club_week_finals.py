"""The one final-held rule (Lane 80), `club_week_finals`, on its shared fixture: a migrated database
loaded with `db/schema/club_week_finals_fixture.json` holds exactly its `finals`, each at the first
instant it was held. The API's test (api/internal/boards/finals_test.go) holds its read to the same
fixture. Needs PARITY_DATABASE_URL (a server where the harness may create `parity_*` databases)."""

import json
import os
from datetime import datetime
from typing import Any, Final

import pytest
from sqlalchemy import insert, select

from research.db.engine import make_engine
from research.db.schema import CLUB_WEEK_FINALS, PLAYER_WEEK_TEAMS, PLAYERS, TEAM_WEEK_OBSERVATIONS
from research.db.schema.views import CLUB_WEEK_FINALS_SQL
from research.db.url import sqlalchemy_url
from research.parity import databases
from research.pipeline.tank01.game_status import finals_held

FIXTURE: Final = CLUB_WEEK_FINALS_SQL.with_name("club_week_finals_fixture.json")
_DATABASE: Final = "parity_lane80_club_week_finals"


def _at(row: dict[str, Any], key: str) -> dict[str, Any]:
    return {**row, key: datetime.fromisoformat(row[key])}


@pytest.mark.skipif("PARITY_DATABASE_URL" not in os.environ, reason="needs a Postgres for scratch databases")
def test_the_view_holds_the_shared_fixtures_finals() -> None:
    fixture = json.loads(FIXTURE.read_text())
    url = databases.build_with_alembic(_DATABASE)
    engine = make_engine(sqlalchemy_url(url))
    try:
        with engine.begin() as conn:
            # Each line's player, which the edges' key holds them to.
            players = sorted({r["player_id"] for r in fixture["teams"]})
            conn.execute(insert(PLAYERS), [{"id": p, "name": p, "position": "WR"} for p in players])
            conn.execute(insert(TEAM_WEEK_OBSERVATIONS), [_at(r, "as_of") for r in fixture["observations"]])
            conn.execute(insert(PLAYER_WEEK_TEAMS), [_at(r, "as_of") for r in fixture["teams"]])
            view = CLUB_WEEK_FINALS
            got = {
                (r.season, r.week, r.team, r.held_at)
                for r in conn.execute(select(view.c.season, view.c.week, view.c.team, view.c.held_at))
            }
            want = {(r["season"], r["week"], r["team"], _at(r, "held_at")["held_at"]) for r in fixture["finals"]}
            assert got == want
            # The pass's read is the view at an instant: Sunday 20:00 UTC holds Thursday's lines alone.
            sunday = datetime.fromisoformat("2026-10-18T20:00:00Z")
            assert finals_held(conn, 2026, sunday) == {("ARI", 5), ("SEA", 5), ("SEA", 6), ("DEN", 6)}
    finally:
        engine.dispose()
        databases.drop(_DATABASE)
