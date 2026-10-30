"""Lane 72, the week reads' tables (revision 0012) against a migrated scratch database: the night's pool
landing each read with its stamps, call and attempt; a rewrite replacing a week and a new week a new row;
the board week served and no other (the review's H1); no fact stamped after the write; the demotion of a
sentence shape over every read of the board week, a read with no sheet tonight included; a read the
budget stopped writing nothing; and the hourly passes' spend read back for the day's cap (M3). Needs
PARITY_DATABASE_URL (a server where the harness may create `parity_*` databases); skipped without it."""

import json
import os
from collections.abc import Iterator
from dataclasses import replace
from datetime import UTC, date, datetime, timedelta
from typing import Any

import httpx
import pytest
from sqlalchemy import Engine, delete, insert
from sqlalchemy.exc import IntegrityError

from research.capsules.facts_block import FACTS_SOURCE
from research.capsules.gateway import GatewayClient
from research.capsules.narrative import ShapeMasks
from research.capsules.page_figures import FIGURE_OFF_PAGE
from research.capsules.run_budget import RunBudget
from research.capsules.week.cadence import FACT_STALE, FIRST, RULE_STALE, STATUS_CHANGED, falls_since_written
from research.capsules.week.prompt import answer_json
from research.capsules.week.store import (
    StoredWeekRead,
    WeekReadRun,
    hourly_spend_since,
    record_run,
    served_week_reads,
    stored_week_reads,
    upsert_week_read,
)
from research.capsules.week.validate import week_masks
from research.db.engine import make_engine
from research.db.schema import CAPTURE_SNAPSHOTS, PLAYER_WEEK_READ_RUNS, PLAYER_WEEK_READS, PLAYERS
from research.db.url import sqlalchemy_url
from research.nightly.designations import designations_file, read_statuses, status_word
from research.nightly.week_read_demotion import DEMOTED, demote_shared, demote_shared_keeping, player_names
from research.nightly.week_reads import WeekReadSpend, _write, record_spend
from research.parity import databases
from research.tests.test_week_read_rules import STARTER_READ
from research.tests.week_read_fixtures import WRITTEN_AT, main_sheet, questionable, starter

_DATABASE = "parity_test_week_reads"
# Lane 100 (B17, B44): the read quotes only the page's cells, at most three figures. The points the Bears allow
# a game are on no cell, and the published projection and its change are the card's alone (Lane 275).
_QUESTIONABLE_READ = (
    "Bijan Robinson is Questionable on Friday's report, so whether he plays in week 6 of 2026 against Chicago is "
    "not settled until Sunday. He leads the Atlanta backfield when he plays. The Bears rank 9th of 32 against running backs, and the Falcons are expected "
    "to score 25 points. If he is active, Bijan Robinson plays ahead of a lesser back."
)
_SHARED = "The Rams lean on him every single week."
_MASKS = ShapeMasks.of(("Puka Nacua", "Bijan Robinson"))
_THIS_WEEK, _NEXT_WEEK = 6, 7
_BOTH = 2


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
    """Each table test starts from no reads and no runs."""
    if "engine" in request.fixturenames:
        with request.getfixturevalue("engine").begin() as conn:
            conn.execute(delete(PLAYER_WEEK_READS))
            conn.execute(delete(PLAYER_WEEK_READ_RUNS))


def _completion(read: str, call: str) -> httpx.Response:
    usage = {"prompt_tokens": 2000, "completion_tokens": 120, "total_tokens": 2120, "cost": 0.0004}
    choice = {"message": {"content": answer_json(read, call)}, "finish_reason": "stop"}
    return httpx.Response(200, json={"choices": [choice], "usage": usage})


def _gateway(answer: Any) -> GatewayClient:
    return replace(GatewayClient("test-key", httpx.Client(transport=httpx.MockTransport(answer))), concurrency=1)


def test_the_nights_pool_lands_each_read_with_its_stamps_call_and_attempt(engine: Engine) -> None:
    """The step's writing on the season writer's pool, against a gateway answering by the player it is asked
    about: each read lands in its own transaction with the facts' stamps, why it was written, the writer's
    call and its attempt, and a read that starts after another landed is told that read's sentences."""
    asked: list[str] = []

    def answer(request: httpx.Request) -> httpx.Response:
        user = json.loads(request.content)["messages"][-1]["content"]
        asked.append(user)
        puka = "Puka Nacua" in user.split("\n", 2)[1]
        return _completion(STARTER_READ, "start") if puka else _completion(_QUESTIONABLE_READ, "hold")

    first, second = starter(), questionable()
    spend = WeekReadSpend()
    _write(
        engine,
        _gateway(answer),
        {},
        [(first, FIRST), (second, STATUS_CHANGED)],
        room=lambda: True,
        spend=spend,
        masks=_MASKS,
    )
    with engine.connect() as conn:
        stored = stored_week_reads(conn, 2026, [6])
    assert spend.written == _BOTH and spend.facts_blocks == 0
    puka = stored[(first.player_id, 6)]
    assert puka.body == STARTER_READ and puka.call == "start"
    assert puka.stamps == first.stamps() and puka.facts_at == first.facts_at
    assert (puka.attempt_day, puka.attempts) == (date(2026, 10, 16), 1)
    assert stored[(second.player_id, 6)].reason == STATUS_CHANGED
    assert '"Start him with confidence."' in asked[1]


def test_a_read_that_keeps_quoting_a_figure_off_the_page_falls_and_the_pass_says_why(engine: Engine) -> None:
    """Lane 66v: every draft says 25.6 where the card prints 25.9, so the read falls to its facts block and
    the pass's line names him and the figure guard."""
    off_page = STARTER_READ.replace("25.9 PPR points", "25.6 PPR points")
    spend = WeekReadSpend()
    gateway = _gateway(lambda _request: _completion(off_page, "start"))
    _write(engine, gateway, {}, [(starter(), FIRST)], room=lambda: True, spend=spend, masks=_MASKS)
    assert spend.facts_blocks == 1 and spend.written == 0
    assert f'Puka Nacua: failed validation: {FIGURE_OFF_PAGE}: "25.6"' in spend.line()


def test_a_read_the_budget_stopped_writes_nothing(engine: Engine) -> None:
    pid = starter().player_id
    with engine.begin() as conn:
        upsert_week_read(conn, _row(pid, 6, "A written read that stands."))
    gateway = _gateway(lambda _request: _completion(STARTER_READ, "start")).with_budget(RunBudget.of(calls=0))
    spend = WeekReadSpend()
    _write(engine, gateway, {}, [(starter(), FIRST)], room=lambda: True, spend=spend, masks=_MASKS)
    with engine.connect() as conn:
        stored = stored_week_reads(conn, 2026, [6])
    assert spend.budget_stopped == 1 and spend.written == 0
    assert stored[(pid, 6)].body == "A written read that stands."


def _row(player_id: str, week: int, body: str, written_at: datetime = WRITTEN_AT) -> StoredWeekRead:
    return StoredWeekRead(
        player_id, 2026, week, "llm", body, "m/x", written_at, written_at - timedelta(hours=1),
        {"projection": (written_at - timedelta(hours=1)).isoformat()}, 18.4, None, "first", "start",
        date(2026, 10, 16), 1,
    )  # fmt: skip


def test_a_rewrite_replaces_the_week_and_only_the_board_week_is_served(engine: Engine) -> None:
    """The review's H1: a Thursday club writes its next week, and the page still serves the board week's."""
    pid = starter().player_id
    with engine.begin() as conn:
        upsert_week_read(conn, _row(pid, 6, "The first read."))
        upsert_week_read(conn, replace(_row(pid, 6, "The rewrite."), reason="status", status="questionable"))
        upsert_week_read(conn, _row(pid, 7, "Next week's read.", WRITTEN_AT + timedelta(days=1)))
    with engine.connect() as conn:
        stored = stored_week_reads(conn, 2026, [6, 7])
        served = served_week_reads(conn, 2026, _THIS_WEEK, [pid])
        later = served_week_reads(conn, 2026, _NEXT_WEEK, [pid])
        none = served_week_reads(conn, 2026, 8, [pid])
    assert stored[(pid, 6)].body == "The rewrite."
    assert stored[(pid, 6)].reason == "status" and stored[(pid, 6)].status == "questionable"
    assert served[pid].body == "The rewrite." and later[pid].body == "Next week's read." and none == {}


def test_a_fact_stamped_after_the_write_is_refused_by_the_table(engine: Engine) -> None:
    late = replace(_row(starter().player_id, 8, "A read."), facts_at=WRITTEN_AT + timedelta(minutes=1))
    with pytest.raises(IntegrityError), engine.begin() as conn:
        upsert_week_read(conn, late)


def test_a_sentence_shape_on_two_reads_demotes_the_later_carrier_over_the_board_week(engine: Engine) -> None:
    """The board week's reads are all covered: here the later carrier has no sheet tonight (his club
    played Thursday and his sheet is for week 7), and is demoted to the facts its own row states."""
    first, second = starter(), questionable()
    with engine.begin() as conn:
        upsert_week_read(conn, _row(first.player_id, 6, f"Puka Nacua faces ARI at home. {_SHARED}"))
        shaped = "The Falcons lean on him every single week."
        upsert_week_read(conn, _row(second.player_id, 6, f"Bijan Robinson faces CHI at home. {shaped}"))
    tonight = (first, replace(second, week=7))
    assert demote_shared(engine, tonight, 6, datetime.now(UTC), _MASKS) == {(second.player_id, 6)}
    with engine.connect() as conn:
        stored = stored_week_reads(conn, 2026, [6])
    assert stored[(first.player_id, 6)].source == "llm"
    kept = stored[(second.player_id, 6)]
    assert kept.source == FACTS_SOURCE and kept.reason == DEMOTED
    assert kept.body == "Week: 6 of 2026\nStatus: no designation\nPublished projection: 18.4 points (PPR)"


def test_a_carrier_with_no_sheet_tonight_is_masked_by_name_from_the_store(engine: Engine) -> None:
    """The Lane 265 review's M1: only the board's names equate "Amon-Ra St. Brown" (three words) with "Puka
    Nacua" (two); his read's player has no sheet tonight, so his name comes from the players table."""
    first = starter()
    brown = replace(questionable(), player_id="00-0036963", name="Amon-Ra St. Brown")
    with engine.begin() as conn:
        conn.execute(insert(PLAYERS).values(id=brown.player_id, name=brown.name, position="WR"))
        upsert_week_read(
            conn, _row(first.player_id, 6, "Puka Nacua has drawn at least 9 targets in each of his last 3 games.")
        )
        upsert_week_read(
            conn,
            _row(brown.player_id, 6, "Amon-Ra St. Brown has drawn at least 7 targets in each of his last 4 games."),
        )
        names = player_names(conn, [first.player_id, brown.player_id])
    try:
        assert demote_shared(engine, (first,), 6, datetime.now(UTC), week_masks((first,))) == frozenset()
        masks = week_masks((first,), names)
        assert demote_shared(engine, (first,), 6, datetime.now(UTC), masks) == {(brown.player_id, 6)}
    finally:
        with engine.begin() as conn:
            conn.execute(delete(PLAYER_WEEK_READS))
            conn.execute(delete(PLAYERS).where(PLAYERS.c.id == brown.player_id))


def test_the_hourly_passes_spend_is_read_back_for_the_days_cap(engine: Engine) -> None:
    day = datetime(2026, 10, 16, 5, 0, tzinfo=UTC)
    with engine.begin() as conn:
        record_run(conn, WeekReadRun(day + timedelta(hours=1), "hourly", 12, 0.012, 10, 2, 0))
        record_run(conn, WeekReadRun(day + timedelta(hours=2), "hourly", 8, 0.008, 8, 0, 0))
        record_run(conn, WeekReadRun(day + timedelta(hours=3), "nightly", 900, 0.5, 500, 4, 1))
        record_run(conn, WeekReadRun(day - timedelta(hours=1), "hourly", 50, 0.05, 40, 0, 0))
    with engine.connect() as conn:
        assert hourly_spend_since(conn, day) == pytest.approx(0.020)


def test_a_pass_records_what_its_budget_reserved_even_when_no_read_landed(engine: Engine) -> None:
    """The re-review's F6: the pass's row comes from the budget's own tally (a read that raised included),
    written in the pass's `finally`."""
    budget = RunBudget.of(calls=10)
    budget.calls_made, budget.spent_usd = 3, 0.0019
    at = datetime(2026, 10, 16, 15, 0, tzinfo=UTC)
    record_spend(engine, at, "hourly", WeekReadSpend(), budget)
    with engine.connect() as conn:
        assert hourly_spend_since(conn, at - timedelta(hours=1)) == pytest.approx(0.0019)


def _capture(conn: Any, at: datetime, listed: dict[str, str]) -> None:
    payload = {"injList": [{"playerID": pid, "designation": word} for pid, word in listed.items()]}
    conn.execute(
        insert(CAPTURE_SNAPSHOTS).values(
            source="tank01_injuries_by_date", captured_at=at, digest=str(at), payload=payload
        )
    )


def test_a_refused_capture_leaves_the_page_and_the_web_on_the_same_status(engine: Engine) -> None:
    """The re-review's F3: a capture cut short (under half the list before it) is refused by the one read
    both sides take, so neither clears a designation the other keeps."""
    full = {"4426515": "Questionable", "4430807": "Out", "4241478": "Injured Reserve", "4362628": "Doubtful"}
    first, short = datetime(2026, 10, 16, 12, 0, tzinfo=UTC), datetime(2026, 10, 16, 13, 0, tzinfo=UTC)
    with engine.begin() as conn:
        conn.execute(delete(CAPTURE_SNAPSHOTS))
        _capture(conn, first, full)
        _capture(conn, short, {"4430807": "Out"})
    with engine.connect() as conn:
        read = read_statuses(conn, short + timedelta(minutes=5), now=short + timedelta(minutes=5))
    assert read is not None and read.read_at == first
    web = designations_file(read, full)["players"]
    assert {pid: status_word(read, pid) for pid in full} == {pid: web[pid]["status"] for pid in full}
    assert status_word(read, "4426515") == "questionable"


def test_a_status_rewrite_that_falls_keeps_the_written_read_and_counts_the_attempt(engine: Engine) -> None:
    """Lane 275 fix round 1 (the founder: "we should always show a read"): a status change's rewrite that falls
    to its facts block keeps the written row's body, call and status, so the page keeps it under the status
    caption; the attempt is counted for the cadence's daily limit and the step line says held."""
    pid = starter().player_id
    written = replace(_row(pid, 6, "The read written before his status changed."), status="questionable", call="hold")
    with engine.begin() as conn:
        upsert_week_read(conn, written)
    off_page = STARTER_READ.replace("25.9 PPR points", "25.6 PPR points")
    spend = WeekReadSpend()
    gateway = _gateway(lambda _request: _completion(off_page, "start"))
    _write(
        engine,
        gateway,
        {(pid, 6): written},
        [(starter(), STATUS_CHANGED)],
        room=lambda: True,
        spend=spend,
        masks=_MASKS,
    )
    with engine.connect() as conn:
        kept = stored_week_reads(conn, 2026, [6])[(pid, 6)]
    assert (kept.source, kept.body, kept.call, kept.status) == ("llm", written.body, "hold", "questionable")
    assert (kept.written_at, kept.reason) == (written.written_at, written.reason)
    assert (kept.attempt_day, kept.attempts) == (date(2026, 10, 16), written.attempts + 1)
    assert (spend.held, spend.facts_blocks, spend.written) == (1, 1, 0)
    assert "1 facts blocks (1 held over the written read)" in spend.line()


def test_a_first_read_that_falls_still_stores_its_facts_block(engine: Engine) -> None:
    """With nothing written to keep, a fallen first read stores its facts block, as before."""
    off_page = STARTER_READ.replace("25.9 PPR points", "25.6 PPR points")
    spend = WeekReadSpend()
    gateway = _gateway(lambda _request: _completion(off_page, "start"))
    _write(engine, gateway, {}, [(starter(), FIRST)], room=lambda: True, spend=spend, masks=_MASKS)
    with engine.connect() as conn:
        stored = stored_week_reads(conn, 2026, [6])[(starter().player_id, 6)]
    assert stored.source == FACTS_SOURCE and spend.held == 0


def test_a_rule_stale_rewrite_lands_with_its_reason(engine: Engine) -> None:
    """Revision 0024: the table takes the cadence's `rule` reason."""
    pid = starter().player_id
    stale = _row(pid, 6, "The published projection has him at 18.4 points. Start him.")
    with engine.begin() as conn:
        upsert_week_read(conn, stale)
    spend = WeekReadSpend()
    gateway = _gateway(lambda _request: _completion(STARTER_READ, "start"))
    _write(engine, gateway, {(pid, 6): stale}, [(starter(), RULE_STALE)], room=lambda: True, spend=spend, masks=_MASKS)
    with engine.connect() as conn:
        landed = stored_week_reads(conn, 2026, [6])[(pid, 6)]
    assert (landed.body, landed.reason) == (STARTER_READ, RULE_STALE)


def test_a_fact_stale_rewrite_lands_with_its_reason(engine: Engine) -> None:
    """Revision 0025 (Lane 299): the table takes the cadence's `fact` reason."""
    pid = starter().player_id
    stale = _row(pid, 6, "Puka Nacua sits second among Rams receivers. Start him.")
    with engine.begin() as conn:
        upsert_week_read(conn, stale)
    spend = WeekReadSpend()
    gateway = _gateway(lambda _request: _completion(STARTER_READ, "start"))
    _write(engine, gateway, {(pid, 6): stale}, [(starter(), FACT_STALE)], room=lambda: True, spend=spend, masks=_MASKS)
    with engine.connect() as conn:
        landed = stored_week_reads(conn, 2026, [6])[(pid, 6)]
    assert (landed.body, landed.reason) == (STARTER_READ, FACT_STALE)


def test_a_fact_stale_rewrite_that_falls_keeps_the_written_read_and_the_status_cap(engine: Engine) -> None:
    """The Lane 299 review's L6: a fallen fact rewrite keeps the written body, reason and status, marks the day
    attempted, and spends none of the day's status rewrites."""
    pid = starter().player_id
    written = _row(pid, 6, "Puka Nacua sits second among Rams receivers. Start him.")
    with engine.begin() as conn:
        upsert_week_read(conn, written)
    off_page = STARTER_READ.replace("25.9 PPR points", "25.6 PPR points")
    spend = WeekReadSpend()
    gateway = _gateway(lambda _request: _completion(off_page, "start"))
    _write(
        engine, gateway, {(pid, 6): written}, [(starter(), FACT_STALE)], room=lambda: True, spend=spend, masks=_MASKS
    )
    with engine.connect() as conn:
        kept = stored_week_reads(conn, 2026, [6])[(pid, 6)]
    assert (kept.source, kept.body, kept.reason, kept.status) == ("llm", written.body, "first", None)
    assert (kept.written_at, kept.attempt_day, kept.attempts) == (written.written_at, date(2026, 10, 16), 1)
    assert falls_since_written(kept, WRITTEN_AT) == 0 and spend.held == 1


def _same_shape_rewrites(engine: Engine) -> tuple[StoredWeekRead, StoredWeekRead]:
    """Two reads rewritten in flight together, each landing a sentence of the same shape (review H1), over the
    written reads the pass started from."""
    first, second = starter(), questionable()
    earlier = (
        _row(first.player_id, 6, "Puka Nacua is the first read a manager trusts at receiver."),
        _row(second.player_id, 6, "Bijan Robinson carries the Atlanta backfield on early downs and late."),
    )
    with engine.begin() as conn:
        upsert_week_read(conn, _row(first.player_id, 6, f"Puka Nacua faces ARI at home. {_SHARED}"))
        shaped = "The Falcons lean on him every single week."
        upsert_week_read(conn, _row(second.player_id, 6, f"Bijan Robinson faces CHI at home. {shaped}"))
    return earlier


def test_a_carrier_rewritten_in_the_pass_gets_its_written_read_back(engine: Engine) -> None:
    """Lane 275 fix round 2 (review H1): two concurrent rewrites land one shape; the later carrier in board
    order gets back the written read the pass rewrote, its fall counted, never its facts block."""
    first, second = starter(), questionable()
    earlier = _same_shape_rewrites(engine)
    kept = {(read.player_id, 6): read for read in earlier}
    demotion = demote_shared_keeping(engine, (first, second), 6, WRITTEN_AT, _MASKS, kept=kept)
    assert not demotion.demoted and demotion.restored == {(second.player_id, 6)}
    with engine.connect() as conn:
        stored = stored_week_reads(conn, 2026, [6])
    back = stored[(second.player_id, 6)]
    assert (back.source, back.body, back.reason) == ("llm", earlier[1].body, earlier[1].reason)
    assert (back.attempt_day, back.attempts) == (date(2026, 10, 16), earlier[1].attempts + 1)
    assert stored[(first.player_id, 6)].body.endswith(_SHARED)


def test_a_carrier_whose_earlier_read_shares_a_shape_too_becomes_its_facts_block(engine: Engine) -> None:
    first, second = starter(), questionable()
    _same_shape_rewrites(engine)
    sharing = _row(second.player_id, 6, f"Bijan Robinson faces CHI on the road. {_SHARED}")
    demotion = demote_shared_keeping(
        engine, (first, second), 6, WRITTEN_AT, _MASKS, kept={(second.player_id, 6): sharing}
    )
    assert demotion.demoted == {(second.player_id, 6)} and not demotion.restored
    with engine.connect() as conn:
        assert stored_week_reads(conn, 2026, [6])[(second.player_id, 6)].source == FACTS_SOURCE


@pytest.fixture(autouse=True)
def _main_sheet() -> Iterator[None]:
    """These tests pin main's sheet, its lines and the reads written from it (Lane 300 turned the angles on; the
    angles' sheet is `test_week_read_angles`'s)."""
    with main_sheet():
        yield
