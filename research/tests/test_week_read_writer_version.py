"""Lane 306 (the founder, 2026-10-30: "why can we not update all player reads at the same time? Why are we in this
constant state?"): a writer change rewrites the whole board in one nightly, so the board never mixes writers.

- A written read below `write.WEEK_WRITER_VERSION` is due (`cadence.WRITER`) on the nightly, never the hourly
  pass, and last in `PRIORITY`, so a budget stop carries the writer's rewrites to the next nightly.
- A writer rewrite lands at the current version; one that falls keeps the written read and its old version, so it
  stays due for the next nightly.
- Revision 0026 stamps the rows before it from their written instant: at or after 2026-10-30T05:00Z version 1,
  the rest 0.

The table tests need PARITY_DATABASE_URL (a server where the harness may create `parity_*` databases); skipped
without it.
"""

import importlib.util
import json
import os
from collections.abc import Iterator
from dataclasses import replace
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from types import ModuleType

import httpx
import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import Engine, delete, insert, text

from research.capsules.facts_block import FACTS_SOURCE
from research.capsules.gateway import GatewayClient
from research.capsules.narrative import ShapeMasks
from research.capsules.run_budget import RunBudget
from research.capsules.store import WRITTEN_SOURCE
from research.capsules.week.cadence import FACT_STALE, FIRST, PRIORITY, WRITER, due_reason, writer_stale
from research.capsules.week.prompt import answer_json
from research.capsules.week.rollover import Rollover
from research.capsules.week.sheet import WeekSheet
from research.capsules.week.store import StoredWeekRead, stored_week_reads, upsert_week_read
from research.capsules.week.write import WEEK_WRITER_VERSION
from research.db.engine import make_engine
from research.db.schema import PLAYER_WEEK_READ_RUNS, PLAYER_WEEK_READS, PLAYERS
from research.db.schema.boards import WEEK_READ_REASONS
from research.db.url import sqlalchemy_url
from research.nightly import week_reads
from research.nightly.week_reads import WeekReadSpend, _write
from research.parity import databases
from research.tests.test_week_read_rules import STARTER_READ
from research.tests.week_read_fixtures import WRITTEN_AT, main_sheet, questionable, starter

_DATABASE = "parity_test_week_read_writer_version"
_STAMP_DATABASE = "parity_test_week_read_writer_stamp"
_MASKS = ShapeMasks.of(("Puka Nacua", "Bijan Robinson"))
_WEEK = 6
_NEXT_NIGHT = WRITTEN_AT + timedelta(days=1)
_OLD = 0
_ROOT = Path(__file__).resolve().parent.parent


def _stored(sheet: WeekSheet, *, version: int = _OLD, source: str = WRITTEN_SOURCE) -> StoredWeekRead:
    return StoredWeekRead(
        sheet.player_id, sheet.season, sheet.week, source, STARTER_READ, "m/x", WRITTEN_AT,
        WRITTEN_AT - timedelta(hours=1), {}, 18.4, sheet.status.status, FIRST, "start", date(2026, 10, 16), 1,
        version,
    )  # fmt: skip


def test_a_read_an_older_writer_wrote_is_due_on_the_nightly_and_never_the_hourly() -> None:
    sheet = starter()
    assert WEEK_WRITER_VERSION == 2  # noqa: PLR2004 - Lane 302's decided call
    assert due_reason(sheet, _stored(sheet, version=_OLD), _NEXT_NIGHT) == WRITER
    assert due_reason(sheet, _stored(sheet, version=WEEK_WRITER_VERSION), _NEXT_NIGHT) is None
    assert due_reason(sheet, _stored(sheet, version=_OLD), _NEXT_NIGHT, hourly=True) is None
    # Bumping the constant is what makes the current writer's reads due.
    assert writer_stale(_stored(sheet, version=WEEK_WRITER_VERSION), WEEK_WRITER_VERSION + 1)
    # A facts block is the retries' (UNWRITTEN), never the writer's; it is due as unwritten an hour on.
    facts = _stored(sheet, version=_OLD, source=FACTS_SOURCE)
    assert not writer_stale(facts) and due_reason(sheet, facts, _NEXT_NIGHT) != WRITER
    assert WRITER in WEEK_READ_REASONS


def test_a_held_read_is_due_again_whatever_its_day_says() -> None:
    """No once-a-day gate: a read whose day an earlier fall marked is still the next nightly's."""
    sheet = starter()
    held = replace(_stored(sheet), attempt_day=date(2026, 10, 17), attempts=3)
    assert due_reason(sheet, held, _NEXT_NIGHT) == WRITER


def test_the_nightly_orders_the_writers_rewrites_after_every_other_reason() -> None:
    """The writer's are last in `PRIORITY`, so a budget stop leaves them for the next night (Ruling 3)."""
    stale_writer, new = starter(), replace(questionable(), player_id="00-0099999")
    stored = {(stale_writer.player_id, _WEEK): _stored(stale_writer)}
    night = week_reads._Night((stale_writer, new), stored, _WEEK, Rollover(_WEEK, True), ShapeMasks.of(()))
    due = week_reads._due(night, _NEXT_NIGHT, hourly=False)
    assert [(sheet.player_id, reason) for sheet, reason in due] == [
        (new.player_id, FIRST),
        (stale_writer.player_id, WRITER),
    ]
    assert PRIORITY[-1] == WRITER
    assert week_reads._due(night, _NEXT_NIGHT, hourly=True) == []


@pytest.fixture(scope="module")
def engine() -> Iterator[Engine]:
    if "PARITY_DATABASE_URL" not in os.environ:
        pytest.skip("needs a Postgres for scratch databases")
    built = make_engine(sqlalchemy_url(databases.build_with_alembic(_DATABASE)))
    with built.begin() as conn:
        conn.execute(
            insert(PLAYERS),
            [
                {"id": starter().player_id, "name": "Puka Nacua", "position": "WR"},
                {"id": questionable().player_id, "name": "Bijan Robinson", "position": "RB"},
            ],
        )
    try:
        yield built
    finally:
        built.dispose()
        databases.drop(_DATABASE)


@pytest.fixture(autouse=True)
def _main_sheet() -> Iterator[None]:
    """The writes pin main's sheet and the reads written from it, as `test_week_read_store` does."""
    with main_sheet():
        yield


@pytest.fixture(autouse=True)
def _empty(request: pytest.FixtureRequest) -> None:
    if "engine" in request.fixturenames:
        with request.getfixturevalue("engine").begin() as conn:
            conn.execute(delete(PLAYER_WEEK_READS))
            conn.execute(delete(PLAYER_WEEK_READ_RUNS))


def _completion(read: str) -> httpx.Response:
    usage = {"prompt_tokens": 2000, "completion_tokens": 120, "total_tokens": 2120, "cost": 0.0004}
    choice = {"message": {"content": answer_json(read, "start")}, "finish_reason": "stop"}
    return httpx.Response(200, json={"choices": [choice], "usage": usage})


def _gateway(read: str) -> GatewayClient:
    transport = httpx.MockTransport(lambda _request: _completion(read))
    return replace(GatewayClient("test-key", httpx.Client(transport=transport)), concurrency=1)


def _week(engine: Engine) -> dict[tuple[str, int], StoredWeekRead]:
    with engine.connect() as conn:
        return stored_week_reads(conn, 2026, [_WEEK])


def test_a_writer_rewrite_lands_at_the_current_version_with_its_reason(engine: Engine) -> None:
    sheet = starter()
    old = _stored(sheet)
    with engine.begin() as conn:
        upsert_week_read(conn, old)
    spend = WeekReadSpend()
    _write(engine, _gateway(STARTER_READ), {(sheet.player_id, _WEEK): old}, [(sheet, WRITER)],
           room=lambda: True, spend=spend, masks=_MASKS)  # fmt: skip
    landed = _week(engine)[(sheet.player_id, _WEEK)]
    assert (landed.body, landed.reason, landed.writer_version) == (STARTER_READ, WRITER, WEEK_WRITER_VERSION)
    assert due_reason(sheet, landed, _NEXT_NIGHT) is None
    assert "writer 1" in replace(spend, due={WRITER: 1}).line()


def test_a_writer_rewrite_that_falls_keeps_the_written_read_and_stays_due(engine: Engine) -> None:
    sheet = starter()
    old = _stored(sheet)
    with engine.begin() as conn:
        upsert_week_read(conn, old)
    off_page = STARTER_READ.replace("25.9 PPR points", "25.6 PPR points")
    spend = WeekReadSpend()
    _write(engine, _gateway(off_page), {(sheet.player_id, _WEEK): old}, [(sheet, WRITER)],
           room=lambda: True, spend=spend, masks=_MASKS)  # fmt: skip
    kept = _week(engine)[(sheet.player_id, _WEEK)]
    assert (kept.source, kept.body, kept.writer_version, kept.written_at) == (
        WRITTEN_SOURCE, old.body, _OLD, old.written_at,
    )  # fmt: skip
    assert spend.held == 1 and spend.facts_blocks == 1
    assert due_reason(sheet, kept, _NEXT_NIGHT + timedelta(days=1)) == WRITER


def test_a_budget_stop_carries_the_writers_rewrite_to_the_next_night(engine: Engine) -> None:
    """One call left: the fact-stale rewrite ahead of it in `PRIORITY` lands, the writer's is stopped and its read
    stands, still due."""
    fact, stale = starter(), questionable()
    rows = {
        (fact.player_id, _WEEK): replace(_stored(fact, version=WEEK_WRITER_VERSION), body="A fact-stale read."),
        (stale.player_id, _WEEK): replace(_stored(stale), body="Bijan Robinson leads the Atlanta backfield."),
    }
    with engine.begin() as conn:
        for row in rows.values():
            upsert_week_read(conn, row)
    due = sorted([(stale, WRITER), (fact, FACT_STALE)], key=lambda item: PRIORITY.index(item[1]))
    gateway = _gateway(STARTER_READ).with_budget(RunBudget.of(calls=1))
    spend = WeekReadSpend()
    _write(engine, gateway, rows, due, room=lambda: True, spend=spend, masks=_MASKS)
    after = _week(engine)
    assert after[(fact.player_id, _WEEK)].body == STARTER_READ
    standing = after[(stale.player_id, _WEEK)]
    assert spend.budget_stopped == 1 and standing.body == rows[(stale.player_id, _WEEK)].body
    assert standing.writer_version == _OLD and writer_stale(standing)


def _revision_0026() -> ModuleType:
    path = _ROOT / "alembic" / "versions" / "0026_week_read_writer_version.py"
    spec = importlib.util.spec_from_file_location("revision_0026", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_the_revision_stamps_the_rows_before_it_from_their_written_instant() -> None:
    """At or after 2026-10-30T05:00Z version 1 (the 05:30Z nightly's facts instant and later), the rest 0; the
    table takes the `writer` reason after it."""
    if "PARITY_DATABASE_URL" not in os.environ:
        pytest.skip("needs a Postgres for scratch databases")
    stamp_from = _revision_0026().STAMP_FROM
    assert stamp_from == datetime(2026, 10, 30, 5, tzinfo=UTC)
    url = databases.build_with_alembic(_STAMP_DATABASE, "0025")
    built = make_engine(sqlalchemy_url(url))
    instants = {"before": stamp_from - timedelta(minutes=1), "at": stamp_from, "after": stamp_from + timedelta(hours=1)}
    try:
        with built.begin() as conn:
            conn.execute(insert(PLAYERS), [{"id": f"p-{k}", "name": k, "position": "WR"} for k in instants])
            for key, at in instants.items():
                conn.execute(
                    text(
                        "insert into research.player_week_reads (player_id, season, week, source, body, written_at, "
                        "stamps, reason, attempt_day, attempts) values (:p, 2026, 8, 'llm', 'A read.', :at, "
                        "cast(:stamps as jsonb), 'first', :day, 1)"
                    ),
                    {"p": f"p-{key}", "at": at, "stamps": json.dumps({}), "day": at.date()},
                )
        config = Config(str(_ROOT / "alembic.ini"))
        config.attributes["url"] = sqlalchemy_url(url)
        command.upgrade(config, "0026")
        with built.connect() as conn:
            stamped: dict[str, int] = dict(
                conn.execute(text("select player_id, writer_version from research.player_week_reads")).all()
            )
            read = stored_week_reads(conn, 2026, [8])
        assert stamped == {"p-before": 0, "p-at": 1, "p-after": 1}
        assert read[("p-before", 8)].writer_version == 0
        with built.begin() as conn:
            conn.execute(text("update research.player_week_reads set writer_version = null where player_id = 'p-at'"))
            conn.execute(text("update research.player_week_reads set reason = 'writer' where player_id = 'p-after'"))
        with built.connect() as conn:
            assert stored_week_reads(conn, 2026, [8])[("p-at", 8)].writer_version == 0  # NULL reads as 0
    finally:
        built.dispose()
        databases.drop(_STAMP_DATABASE)
