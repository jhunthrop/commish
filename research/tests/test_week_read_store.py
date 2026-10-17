"""Lane 72, the week reads' table (revision 0012) against a migrated scratch database: a row per player and
week, a rewrite replacing it, the newest week not yet behind the run served to the page, no fact stamped
after the write, and the demotion of a sentence on two written reads of one week. Needs
PARITY_DATABASE_URL (a server where the harness may create `parity_*` databases); skipped without it."""

import json
import os
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
import pytest
from sqlalchemy import Engine, delete, insert
from sqlalchemy.exc import IntegrityError

from research.capsules.facts_block import FACTS_SOURCE
from research.capsules.gateway import GatewayClient
from research.capsules.week.cadence import FIRST, STATUS_CHANGED
from research.capsules.week.store import StoredWeekRead, served_week_reads, stored_week_reads, upsert_week_read
from research.db.engine import make_engine
from research.db.schema import PLAYER_WEEK_READS, PLAYERS
from research.db.url import sqlalchemy_url
from research.nightly.week_reads import DEMOTED, _Night, _write, demote_shared
from research.parity import databases
from research.tests.test_week_read_rules import STARTER_READ
from research.tests.week_read_fixtures import WRITTEN_AT, questionable, starter

_DATABASE = "parity_test_week_reads"
_QUESTIONABLE_READ = (
    "Bijan Robinson is Questionable on the latest report, so whether he plays in week 6 of 2026 against CHI is "
    "not settled until Sunday. The published projection for him is 15.2 points, down 1.8 since our last read. "
    "The Bears allow running backs 18.7 PPR points a game, 9th of 32, and the Falcons are expected to score 25 "
    "points. If he is active, Bijan Robinson stays in your lineup over a lesser back."
)
_SHARED = "The Rams lean on him every single week."
_THIS_WEEK, _NEXT_WEEK = 6, 7


@pytest.fixture(scope="module")
def engine() -> Any:
    if "PARITY_DATABASE_URL" not in os.environ:
        pytest.skip("needs a Postgres for scratch databases")
    url = databases.build_with_alembic(_DATABASE)
    built = make_engine(sqlalchemy_url(url))
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
def _empty(request: pytest.FixtureRequest) -> None:
    """Each table test starts from no reads."""
    if "engine" in request.fixturenames:
        with request.getfixturevalue("engine").begin() as conn:
            conn.execute(delete(PLAYER_WEEK_READS))


def _completion(content: str) -> httpx.Response:
    usage = {"prompt_tokens": 2000, "completion_tokens": 120, "total_tokens": 2120, "cost": 0.0004}
    return httpx.Response(
        200, json={"choices": [{"message": {"content": content}, "finish_reason": "stop"}], "usage": usage}
    )


def test_the_nights_pool_lands_each_read_with_its_stamps_and_tells_the_next_its_sentences(engine: Engine) -> None:
    """The step's writing on the season writer's pool, against a gateway answering by the player it is asked
    about: each read lands in its own transaction with the facts' stamps and why it was written, and a read
    that starts after another landed is told that read's sentences."""
    asked: list[str] = []

    def answer(request: httpx.Request) -> httpx.Response:
        user = json.loads(request.content)["messages"][-1]["content"]
        asked.append(user)
        return _completion(STARTER_READ if "Puka Nacua" in user.split("\n", 2)[1] else _QUESTIONABLE_READ)

    first, second = starter(), questionable()
    http = httpx.Client(transport=httpx.MockTransport(answer))
    gateway = replace(GatewayClient("test-key", http), concurrency=1)
    night = _Night((first, second), {})
    spend = _write(engine, gateway, night, [(first, FIRST), (second, STATUS_CHANGED)])
    with engine.connect() as conn:
        stored = stored_week_reads(conn, 2026, [6])
    assert spend.written == 2 and spend.facts_blocks == 0  # noqa: PLR2004 - both reads
    assert stored[(first.player_id, 6)].body == STARTER_READ
    assert stored[(first.player_id, 6)].stamps == first.stamps()
    assert stored[(first.player_id, 6)].facts_at == first.facts_at
    assert stored[(second.player_id, 6)].reason == STATUS_CHANGED
    assert stored[(second.player_id, 6)].projection_points == second.projection.points  # type: ignore[union-attr]
    assert '"Start him with confidence."' in asked[1]


def _row(player_id: str, week: int, body: str, written_at: datetime = WRITTEN_AT) -> StoredWeekRead:
    return StoredWeekRead(
        player_id, 2026, week, "llm", body, "m/x", written_at, written_at - timedelta(hours=1),
        {"projection": (written_at - timedelta(hours=1)).isoformat()}, 18.4, None, "first",
    )  # fmt: skip


def test_a_rewrite_replaces_the_week_and_a_new_week_is_a_new_row(engine: Engine) -> None:
    pid = starter().player_id
    with engine.begin() as conn:
        upsert_week_read(conn, _row(pid, 6, "The first read."))
        upsert_week_read(conn, replace(_row(pid, 6, "The rewrite."), reason="status", status="questionable"))
        upsert_week_read(conn, _row(pid, 7, "Next week's read.", WRITTEN_AT + timedelta(days=5)))
    with engine.connect() as conn:
        stored = stored_week_reads(conn, 2026, [6, 7])
        served = served_week_reads(conn, 2026, 6, [pid])
        later = served_week_reads(conn, 2026, 7, [pid])
    assert stored[(pid, 6)].body == "The rewrite."
    assert stored[(pid, 6)].reason == "status" and stored[(pid, 6)].status == "questionable"
    assert stored[(pid, 6)].stamps == {"projection": (WRITTEN_AT - timedelta(hours=1)).isoformat()}
    assert served[pid].week == _THIS_WEEK
    assert later[pid].week == _NEXT_WEEK


def test_a_fact_stamped_after_the_write_is_refused_by_the_table(engine: Engine) -> None:
    late = replace(_row(starter().player_id, 8, "A read."), facts_at=WRITTEN_AT + timedelta(minutes=1))
    with pytest.raises(IntegrityError), engine.begin() as conn:
        upsert_week_read(conn, late)


def test_a_sentence_on_two_reads_demotes_the_later_carrier_in_board_order(engine: Engine) -> None:
    first, second = starter(), questionable()
    with engine.begin() as conn:
        upsert_week_read(conn, _row(first.player_id, 6, f"Puka Nacua faces ARI. {_SHARED}"))
        upsert_week_read(conn, _row(second.player_id, 6, f"Bijan Robinson faces CHI. {_SHARED}"))
    demoted = demote_shared(engine, (first, second), datetime.now(UTC))
    assert demoted == 1
    with engine.connect() as conn:
        stored = stored_week_reads(conn, 2026, [6])
    assert stored[(first.player_id, 6)].source == "llm"
    kept = stored[(second.player_id, 6)]
    assert kept.source == FACTS_SOURCE and kept.reason == DEMOTED
    assert kept.body.startswith("Week: 6 of 2026")
