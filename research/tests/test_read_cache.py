"""The read cache against a real Postgres: served while its rows stand, read again once one moves.

Needs PARITY_DATABASE_URL (a server where the harness may create `parity_*` databases); skipped
without it, and run by CI, which sets it.
"""

import os
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import Connection, Engine, insert, text

from research.db.engine import make_engine
from research.db.read_cache import ReadCache
from research.db.schema import PLAYER_WEEK_OBSERVATIONS, PLAYERS
from research.db.url import sqlalchemy_url
from research.db.value_codec import ValueCodec
from research.parity import databases

_DATABASE = "parity_test_read_cache"
_EARLY = datetime(2025, 9, 1, tzinfo=UTC)


@pytest.fixture(scope="module")
def engine() -> Iterator[Engine]:
    if "PARITY_DATABASE_URL" not in os.environ:
        pytest.skip("needs a Postgres for scratch databases")
    url = databases.build_with_alembic(_DATABASE)
    built = make_engine(sqlalchemy_url(url))
    with built.begin() as conn:
        conn.execute(insert(PLAYERS).values(id="00-1", name="A. Player", position="WR"))
        _observe(conn, 1, 10.0, _EARLY)
    try:
        yield built
    finally:
        built.dispose()
        databases.drop(_DATABASE)


def _observe(conn: Connection, week: int, value: float, as_of: datetime) -> None:
    row = {"season": 2025, "week": week, "player_id": "00-1", "source": "s", "metric": "m", "as_of": as_of}
    conn.execute(insert(PLAYER_WEEK_OBSERVATIONS).values(**row, value=value))


class Counted:
    """A read of the season's values as of an instant, keeping the bound of every time it actually ran."""

    def __init__(self) -> None:
        self.ran_at: list[datetime] = []

    def __call__(self, conn: Connection, as_of: datetime) -> tuple[float, ...]:
        self.ran_at.append(as_of)
        rows = conn.execute(
            text(
                "select value from research.player_week_observations where season = :season and as_of <= :as_of "
                "order by week"
            ),
            {"season": 2025, "as_of": as_of},
        )
        return tuple(float(row.value) for row in rows)


def _cache(engine: Engine, code: str = "code-1") -> ReadCache:
    return ReadCache(engine, ValueCodec(()), code)


def test_served_while_unchanged_and_read_again_once_a_row_lands(engine: Engine) -> None:
    read, now = Counted(), datetime(2026, 10, 1, tzinfo=UTC)
    cache = _cache(engine)
    with engine.connect() as conn:
        assert cache.through(conn, "test/total", ["a"], now, lambda: read(conn, now)) == (10.0,)
        later = now + timedelta(days=1)
        assert cache.through(conn, "test/total", ["a"], later, lambda: read(conn, later)) == (10.0,)
    assert read.ran_at == [now], "the second night is served from the kept result"
    with engine.begin() as conn:
        _observe(conn, 2, 7.0, later - timedelta(hours=1))
    with engine.connect() as conn:
        assert cache.through(conn, "test/total", ["a"], later, lambda: read(conn, later)) == (10.0, 7.0)
    assert read.ran_at == [now, later], "a row inside tonight's bound moved the fingerprint"


def test_the_bound_is_tonights_not_the_kept_one(engine: Engine) -> None:
    read, now = Counted(), datetime(2026, 11, 1, tzinfo=UTC)
    cache = _cache(engine, "code-bound")
    with engine.connect() as conn:
        first = cache.through(conn, "test/bound", ["b"], now, lambda: read(conn, now))
    with engine.begin() as conn:
        _observe(conn, 3, 1.0, now + timedelta(hours=1))
    tomorrow = now + timedelta(days=1)
    with engine.connect() as conn:
        assert cache.through(conn, "test/bound", ["b"], now, lambda: read(conn, now)) == first
        assert read.ran_at == [now], "a row after the kept bound is invisible at that bound"
        assert cache.through(conn, "test/bound", ["b"], tomorrow, lambda: read(conn, tomorrow)) == (*first, 1.0)
    assert read.ran_at == [now, tomorrow], "tonight's bound sees the new row, so the kept result is not served"


def test_other_arguments_or_code_are_a_miss(engine: Engine) -> None:
    read, now = Counted(), datetime(2026, 12, 1, tzinfo=UTC)
    with engine.connect() as conn:
        _cache(engine, "code-x").through(conn, "test/key", ["c"], now, lambda: read(conn, now))
        _cache(engine, "code-x").through(conn, "test/key", ["d"], now, lambda: read(conn, now))
        _cache(engine, "code-y").through(conn, "test/key", ["d"], now, lambda: read(conn, now))
        kept = conn.execute(text("select count(*) from research.model_artifacts where name = 'cache/test/key'"))
        assert kept.scalar_one() == 1, "a name keeps only its newest version"
    assert read.ran_at == [now, now, now], "each new key read again"


def test_a_read_that_writes_is_never_kept(engine: Engine) -> None:
    now = datetime(2027, 1, 1, tzinfo=UTC)

    def writes(conn: Connection) -> int:
        conn.execute(text("update research.players set name = name where id = '00-1'"))
        return 1

    with engine.connect() as conn:
        assert _cache(engine).through(conn, "test/writes", [], now, lambda: writes(conn)) == 1
        kept = conn.execute(text("select count(*) from research.model_artifacts where name = 'cache/test/writes'"))
        assert kept.scalar_one() == 0
