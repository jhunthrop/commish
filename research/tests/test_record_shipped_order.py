"""The record grades the order the site ships (Lane 93, ruling B18): a freeze keeps the published run's
rest-of-season board beside the preseason board, and the record reads a week through the order its
freeze kept, naming it and when it was refreshed; a freeze before it grades the preseason board."""

import os
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from typing import Any, Final

import pytest
from sqlalchemy import Connection, Engine, insert

from research.db.engine import make_engine
from research.db.schema import (
    PLAYER_CROSSWALK,
    PLAYERS,
    PROVIDER_PLAYERS,
    PUBLISHED_BOARDS,
    REGISTER_FREEZE_ROWS,
    REGISTER_GRADE_ROWS,
    TEAM_WEEK_OBSERVATIONS,
)
from research.db.url import sqlalchemy_url
from research.inseason.season_week import GRADE_AFTER
from research.model.register.freeze import SERVED_SOURCE, SHIPPED_SOURCE, shipped_board
from research.nightly.reads import record
from research.parity import databases

_DATABASE: Final = "parity_test_lane93_record_order"
_SEASON: Final = 2026
_REFRESHED: Final = datetime(2026, 10, 22, 9, 0, tzinfo=UTC)
_PUBLISHED_AT: Final = datetime(2026, 10, 22, 10, 0, tzinfo=UTC)
_SET: Final = datetime(2026, 10, 22, 18, 0, tzinfo=UTC)
_KICKOFF: Final = datetime(2026, 10, 23, 0, 15, tzinfo=UTC)
_LAST_KICKOFF: Final = datetime(2026, 10, 27, 0, 15, tzinfo=UTC)
_GRADED: Final = datetime(2026, 10, 28, 22, 0, tzinfo=UTC)
# Three receivers: ours ranks them a, b, c; the preseason board c, b, a; they finished a, b, c.
_PLAYERS: Final = (("00-a", "pa", 1, 30.0), ("00-b", "pb", 2, 20.0), ("00-c", "pc", 3, 10.0))


@pytest.fixture(scope="module")
def engine() -> Iterator[Engine]:
    if "PARITY_DATABASE_URL" not in os.environ:
        pytest.skip("needs a Postgres for scratch databases")
    url = databases.build_with_alembic(_DATABASE)
    built = make_engine(sqlalchemy_url(url))
    try:
        with built.begin() as conn:
            _seed(conn)
        yield built
    finally:
        built.dispose()
        databases.drop(_DATABASE)


def _seed(conn: Connection) -> None:
    conn.execute(insert(PLAYERS), [{"id": pid, "name": pid, "position": "WR"} for pid, _, _, _ in _PLAYERS])
    conn.execute(
        insert(PROVIDER_PLAYERS),
        [{"id": provider, "name": provider, "position": "WR", "team": "PIT"} for _, provider, _, _ in _PLAYERS],
    )
    conn.execute(
        insert(PLAYER_CROSSWALK),
        [
            {"provider_player_id": provider, "player_id": pid, "method": "test", "resolved_at": _REFRESHED}
            for pid, provider, _, _ in _PLAYERS
        ],
    )
    conn.execute(
        insert(PUBLISHED_BOARDS),
        [
            {"season": _SEASON, "format": "ppr", "player_id": provider, "run_id": "2026-10-22T0900Z", "rank": rank,
             "position_rank": rank, "points": 100.0 - rank, "order_basis": "rest_of_season", "refreshed": _REFRESHED,
             "published_at": _PUBLISHED_AT, "from_week": 7}
            for _, provider, rank, _ in _PLAYERS
        ],
    )  # fmt: skip
    conn.execute(
        insert(TEAM_WEEK_OBSERVATIONS),
        [
            {"season": _SEASON, "week": 7, "team": team, "source": "nflverse_kickoff", "metric": "kickoff_instant",
             "value": 1.0, "as_of": at}
            for team, at in (("PIT", _KICKOFF), ("DET", _LAST_KICKOFF))
        ],
    )  # fmt: skip
    freeze_rows: list[dict[str, Any]] = []
    grade_rows: list[dict[str, Any]] = []
    for pid, _, rank, points in _PLAYERS:
        for source, place in ((SHIPPED_SOURCE, rank), (SERVED_SOURCE, 4 - rank)):
            freeze_rows.append(
                {"season": _SEASON, "week": 7, "frozen_at": _SET, "board_source": source, "player_id": pid,
                 "implementation": "python", "board_as_of": _REFRESHED, "board_points": 100.0 - place,
                 "board_rank": place, "board_value_rank": place, "adp": float(10 + rank), "model_version": "m"}
            )  # fmt: skip
            grade_rows.append(
                {"season": _SEASON, "week": 7, "frozen_at": _SET, "graded_at": _GRADED, "board_source": source,
                 "player_id": pid, "actual_points": points, "actual_rank": rank, "board_rank": place,
                 "implementation": "python", "model_version": "m"}
            )  # fmt: skip
    conn.execute(insert(REGISTER_FREEZE_ROWS), freeze_rows)
    conn.execute(insert(REGISTER_GRADE_ROWS), grade_rows)


def test_the_freeze_reads_the_published_rest_of_season_board_through_the_crosswalk(engine: Engine) -> None:
    with engine.connect() as conn:
        shipped = shipped_board(conn, _SEASON, _SET)
        before = shipped_board(conn, _SEASON, _PUBLISHED_AT - timedelta(minutes=1))
    assert [(e.player_id, e.rank, e.projected_points) for e in sorted(shipped, key=lambda e: e.rank)] == [
        ("00-a", 1, 99.0),
        ("00-b", 2, 98.0),
        ("00-c", 3, 97.0),
    ]
    assert {e.source for e in shipped} == {SHIPPED_SOURCE}
    assert {e.as_of for e in shipped} == {_REFRESHED}
    assert {e.model_version for e in shipped} == {"published run 2026-10-22T0900Z"}
    assert before == []  # a board published after the freeze is no claim the freeze could keep


def test_the_record_grades_the_order_the_freeze_kept_and_names_it(engine: Engine) -> None:
    with engine.connect() as conn:
        weeks, _ = record.read_record(conn, _SEASON, _GRADED)
    week = weeks[6]
    assert (week.week, week.status, week.order) == (7, "graded", "rest_of_season")
    assert week.board_as_of == _REFRESHED
    every = next(line for line in week.lines if line.position == record.ALL)
    assert every.ours.agreement == pytest.approx(1.0)  # our order, not the preseason board's reverse
    assert [(p.ours, p.finish) for p in week.placed] == [(1, 1), (2, 2), (3, 3)]
    assert week.grades_from is None


def test_a_frozen_week_says_when_it_grades(engine: Engine) -> None:
    with engine.connect() as conn:
        weeks, _ = record.read_record(conn, _SEASON, _SET)
        conn.execute(REGISTER_GRADE_ROWS.delete())
        waiting, _ = record.read_record(conn, _SEASON, _SET)
        conn.rollback()
    assert weeks[6].status == "graded"
    assert (waiting[6].status, waiting[6].grades_from, waiting[6].placed) == ("frozen", _LAST_KICKOFF + GRADE_AFTER, ())
