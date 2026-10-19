"""The hourly game status (Lane 80): asked once a pass, only while a game that kicked off has no final,
never past two calls an hour, each answer kept and read into one status a club stamped at the pass.

The DB case needs PARITY_DATABASE_URL (a server where the harness may create `parity_*` databases)."""

import os
from datetime import UTC, datetime, timedelta
from typing import Final, cast

import pytest
from sqlalchemy import Connection, insert, select

from research.db.engine import make_engine
from research.db.schema import CAPTURE_SNAPSHOTS, TEAM_WEEK_OBSERVATIONS
from research.db.url import sqlalchemy_url
from research.parity import databases
from research.pipeline.kickoffs import TeamKickoff
from research.pipeline.nflverse.schedule import ScheduleMetric, ScheduleSource
from research.pipeline.tank01 import game_status
from research.pipeline.tank01.client import Paths, Tank01Client
from research.pipeline.tank01.game_status import (
    FINAL_VALUE,
    HOURLY_CAP,
    LOOKBACK,
    STATUS_SOURCE,
    capture_game_status,
    pending_week,
    status_observations,
)

SUNDAY: Final = datetime(2026, 10, 18, 17, tzinfo=UTC)
THURSDAY: Final = datetime(2026, 10, 16, 0, 15, tzinfo=UTC)
NEXT_SUNDAY: Final = SUNDAY + timedelta(days=7)
_DATABASE: Final = "parity_lane80_game_status"
WEEK: Final = 6


def _k(week: int, team: str, at: datetime) -> TeamKickoff:
    return TeamKickoff(2026, week, team, at)


KICKOFFS: Final = [
    _k(6, "SEA", THURSDAY),
    _k(6, "DEN", THURSDAY),
    _k(6, "BUF", SUNDAY),
    _k(6, "MIA", SUNDAY),
    _k(7, "BUF", NEXT_SUNDAY),
]


def test_it_asks_only_while_a_kicked_off_game_waits_on_its_final() -> None:
    held = frozenset({("SEA", 6), ("DEN", 6)})
    # Saturday: nothing kicked off within the lookback (Thursday's is final anyway).
    assert pending_week(KICKOFFS, held, SUNDAY - timedelta(hours=20)) is None
    # Before Sunday's kickoff: nothing waits.
    assert pending_week(KICKOFFS, held, SUNDAY - timedelta(minutes=1)) is None
    # Sunday under way and the night after: week 6.
    assert pending_week(KICKOFFS, held, SUNDAY + timedelta(hours=3)) == WEEK
    # Its final in (the status and the result write both sides): nothing more to ask.
    assert pending_week(KICKOFFS, held | {("MIA", WEEK), ("BUF", WEEK)}, SUNDAY + timedelta(hours=5)) is None
    # Past the lookback the weekly stats bring it: a quiet Tuesday asks nothing.
    assert pending_week(KICKOFFS, held, SUNDAY + LOOKBACK + timedelta(minutes=1)) is None


BODY: Final = [
    {"gameID": "20261018_BUF@MIA", "home": "MIA", "away": "BUF", "gameStatus": "Final", "gameDate": "20261018"},
    {"gameID": "20261018_LAR@SEA", "home": "SEA", "away": "LAR", "gameStatus": "Live - In Progress"},
    {"gameID": "20261019_WSH@DAL", "home": "DAL", "away": "WSH", "gameStatus": "Scheduled"},
]


def test_each_club_gets_its_games_status_in_the_stores_codes() -> None:
    at = SUNDAY + timedelta(hours=4)
    rows = {(r.team, r.value) for r in status_observations(BODY, 2026, 6, at)}
    assert rows == {("MIA", 2.0), ("BUF", 2.0), ("SEA", 1.0), ("LA", 1.0), ("DAL", 0.0), ("WAS", 0.0)}
    assert all(r.as_of == at and r.source == STATUS_SOURCE for r in status_observations(BODY, 2026, 6, at))


class _Client:
    """A Tank01 client that counts its calls and answers the week's games."""

    def __init__(self) -> None:
        self.calls: list[dict[str, str]] = []

    def get(self, path: str, query: dict[str, str] | None = None) -> object:
        assert path == Paths.GAMES_FOR_WEEK
        self.calls.append(dict(query or {}))
        return BODY


def _seed(conn: Connection) -> None:
    rows = [
        {"season": 2026, "week": k.week, "team": k.team, "source": ScheduleSource.KICKOFF,
         "metric": ScheduleMetric.KICKOFF_INSTANT, "as_of": k.at, "value": 1.0}
        for k in KICKOFFS
    ]  # fmt: skip
    conn.execute(insert(TEAM_WEEK_OBSERVATIONS), rows)


@pytest.mark.skipif("PARITY_DATABASE_URL" not in os.environ, reason="needs a Postgres for scratch databases")
def test_one_call_a_pass_kept_and_read_under_the_hourly_cap() -> None:
    url = databases.build_with_alembic(_DATABASE)
    engine = make_engine(sqlalchemy_url(url))
    client = _Client()
    tank01 = cast(Tank01Client, client)
    try:
        with engine.begin() as conn:
            _seed(conn)
            # Quiet Saturday: no call.
            assert capture_game_status(conn, tank01, 2026, SUNDAY - timedelta(hours=20)).requests == 0
            at = SUNDAY + timedelta(hours=4)
            first = capture_game_status(conn, tank01, 2026, at)
            assert (first.requests, first.written) == (1, 6)
            assert client.calls == [{"week": "6", "season": "2026", "seasonType": "reg"}]
            # MIA's final is held now, so the next hour asks nothing.
            assert capture_game_status(conn, tank01, 2026, at + timedelta(hours=1)).requests == 0
            finals = conn.execute(
                select(TEAM_WEEK_OBSERVATIONS.c.team).where(
                    TEAM_WEEK_OBSERVATIONS.c.source == STATUS_SOURCE, TEAM_WEEK_OBSERVATIONS.c.value == FINAL_VALUE
                )
            ).scalars()
            assert sorted(finals) == ["BUF", "MIA"]
            # The cap: two calls already stored in the hour refuse a third.
            again = at + timedelta(minutes=10)
            conn.execute(
                insert(CAPTURE_SNAPSHOTS),
                [{"source": game_status.SNAPSHOT_SOURCE, "captured_at": again, "digest": "d", "payload": []}],
            )
            conn.execute(TEAM_WEEK_OBSERVATIONS.delete().where(TEAM_WEEK_OBSERVATIONS.c.source == STATUS_SOURCE))
            refused = capture_game_status(conn, tank01, 2026, again + timedelta(minutes=1))
            assert refused.requests == 0 and "REFUSED" in refused.line
            assert len(client.calls) == HOURLY_CAP - 1
    finally:
        engine.dispose()
        databases.drop(_DATABASE)
