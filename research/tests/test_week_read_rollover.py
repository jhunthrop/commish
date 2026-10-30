"""Lane 256, every board player's week read written in one pass when the week rolls over, on fixed clocks.

The rule (`capsules.week.rollover`) on the calendar of a normal week: the Tuesday run after Monday's final waits
(the board it reads is the one Monday's run published, and the week's projection is first read Tuesday at 06:00
ET), the Wednesday 05:30 UTC run writes, and the page says "Tuesday" until then; the board week names the next
week once the current week's games have all kicked off. Then the pass itself against a migrated scratch database
(the stub gateway, never the real one): every board player's read written from the one facts instant, none for a
club whose game of the week has kicked off, a read that falls to its facts block asked again within the pass, and
mid-week an hourly status change rewriting that player alone. The database tests need PARITY_DATABASE_URL (a
server where the harness may create `parity_*` databases); skipped without it."""

import json
import os
from collections.abc import Callable, Iterator, Sequence
from dataclasses import dataclass, replace
from datetime import UTC, date, datetime, timedelta
from typing import Any

import httpx
import pytest
from sqlalchemy import Engine, delete, insert

from research.capsules.config import CAPSULE_CONFIG
from research.capsules.facts_block import FACTS_SOURCE
from research.capsules.gateway import GatewayClient
from research.capsules.gateway_ledger import ModelPrice
from research.capsules.narrative import ShapeMasks
from research.capsules.store import WRITTEN_SOURCE
from research.capsules.week import angles as angles_module
from research.capsules.week.cadence import central_day, status_rewrite_capped
from research.capsules.week.collect import board_week
from research.capsules.week.prompt import answer_json
from research.capsules.week.render import render_week_facts_block
from research.capsules.week.rollover import NIGHTS, ReadsDue, Rollover, next_nightly, night_of, reads_due, rollover
from research.capsules.week.sheet import Status, WeekSheet
from research.capsules.week.store import StoredWeekRead, replace_week_read, stored_week_reads, upsert_week_read
from research.capsules.week.validate import validate_week_read
from research.capsules.week.write import MAX_CALLS_PER_READ, WEEK_WRITER_VERSION
from research.db.engine import make_engine
from research.db.schema import PLAYER_WEEK_READ_RUNS, PLAYER_WEEK_READS, PLAYERS
from research.db.url import sqlalchemy_url
from research.nightly import week_reads
from research.nightly.reads.schedule import ClubWeek, Game, GameState
from research.nightly.steps import StepRecord
from research.nightly.week_read_demotion import demote_shared_keeping
from research.parity import databases
from research.tests.test_week_read_angles import _ACCEPTED, _angled
from research.tests.test_week_read_rules import STARTER_READ
from research.tests.test_week_read_store import _QUESTIONABLE_READ
from research.tests.week_read_fixtures import REPORT, WRITTEN_AT, main_sheet, questionable, starter

_DATABASE = "parity_test_week_read_rollover"
_PRICE = ModelPrice("zai/glm-5.3-flash", 0.15, 0.50, "test", True)
_SEASON = 2026

# THE CALENDAR: week 7 ends on Monday 26 October's night game, week 8 opens on Thursday 29 October.
_SUNDAY_7 = datetime(2026, 10, 25, 17, 0, tzinfo=UTC)
_MONDAY_7 = datetime(2026, 10, 27, 0, 15, tzinfo=UTC)
_THURSDAY_8 = datetime(2026, 10, 30, 0, 15, tzinfo=UTC)
_SUNDAY_8 = datetime(2026, 11, 1, 18, 0, tzinfo=UTC)
# The Tuesday run (2026-10-27T05 ran at 05:50 UTC), the Wednesday run, and the Thursday run before kickoff.
_TUESDAY_RUN = datetime(2026, 10, 27, 5, 50, tzinfo=UTC)
_WEDNESDAY_RUN = datetime(2026, 10, 28, 5, 30, tzinfo=UTC)
_THURSDAY_RUN = datetime(2026, 10, 29, 5, 30, tzinfo=UTC)
_WEEK = 8


def _games() -> dict[str, list[Game]]:
    """Four clubs: Seattle and Houston play Monday of week 7 and Sunday of week 8; Los Angeles and Arizona
    play Sunday of week 7 and Thursday of week 8."""
    return {
        "SEA": [Game(7, "HOU", True, _MONDAY_7), Game(8, "WAS", False, _SUNDAY_8)],
        "HOU": [Game(7, "SEA", False, _MONDAY_7), Game(8, "DEN", True, _SUNDAY_8)],
        "LAR": [Game(7, "ARI", True, _SUNDAY_7), Game(8, "ARI", False, _THURSDAY_8)],
        "ARI": [Game(7, "LAR", False, _SUNDAY_7), Game(8, "LAR", True, _THURSDAY_8)],
    }


def _states(at: datetime, *, monday_final: bool = True) -> dict[ClubWeek, GameState]:
    states: dict[ClubWeek, GameState] = {}
    for club, slate in _games().items():
        for game in slate:
            if game.kickoff > at:
                states[(club, game.week)] = "upcoming"
            else:
                final = monday_final or game.kickoff != _MONDAY_7
                states[(club, game.week)] = "final" if final else "kicked_off"
    return states


def test_the_board_week_names_the_next_week_once_the_current_weeks_games_have_all_kicked_off() -> None:
    """The Tuesday run of 2026-10-27 read board week 7 from the board Monday's run published although every
    week 7 game had kicked off: the board week is the first week with a game to come once the board's has none."""
    assert board_week(7, [8, 9]) == _WEEK
    assert board_week(7, [7, 8]) == _WEEK - 1  # Monday's game still to come
    assert board_week(None, [8, 9]) == _WEEK
    assert board_week(8, [8, 9]) == _WEEK


def test_the_tuesday_run_after_mondays_final_waits_and_the_wednesday_run_rolls_over() -> None:
    tuesday = rollover(_WEEK, _games(), _states(_TUESDAY_RUN), 7, False, _TUESDAY_RUN)
    assert not tuesday.ready
    assert tuesday.waits_on == ("the board from week 8", "week 8's published projection")
    wednesday = rollover(_WEEK, _games(), _states(_WEDNESDAY_RUN), 8, True, _WEDNESDAY_RUN)
    assert wednesday == Rollover(_WEEK, True)
    unfinal = rollover(_WEEK, _games(), _states(_WEDNESDAY_RUN, monday_final=False), 8, True, _WEDNESDAY_RUN)
    assert not unfinal.ready and unfinal.waits_on == ("the games before week 8 to be final",)


def test_the_last_nightly_before_the_weeks_first_kickoff_rolls_over_whatever_is_missing() -> None:
    """A projection the provider has not published by Thursday's run: the reads are written without it rather
    than not at all, since the next nightly comes after Thursday night's kickoff."""
    late = rollover(_WEEK, _games(), _states(_THURSDAY_RUN), 8, False, _THURSDAY_RUN)
    assert late.ready and late.waits_on == ("week 8's published projection",)
    assert "is due on its last pass, without week 8's published projection" in late.line()
    assert not rollover(_WEEK, _games(), _states(_WEDNESDAY_RUN), 8, False, _WEDNESDAY_RUN).ready


def test_until_the_roll_over_the_page_names_the_nightly_the_rule_keeps() -> None:
    """Tuesday's run names the Wednesday 05:30 UTC nightly, Tuesday night (its own board covers week 8 once
    published); a projection still unread at Wednesday's run names Thursday's, Wednesday night; in standard time
    the run at 05:30 UTC is still that Tuesday's night."""
    waiting = rollover(_WEEK, _games(), _states(_TUESDAY_RUN), 7, False, _TUESDAY_RUN)
    assert reads_due(waiting, _games(), False, _WEEK, _TUESDAY_RUN) == ReadsDue(_WEEK, _WEDNESDAY_RUN)
    assert ReadsDue(_WEEK, _WEDNESDAY_RUN).night == "Tuesday"
    assert next_nightly(_TUESDAY_RUN) == _WEDNESDAY_RUN
    late = rollover(_WEEK, _games(), _states(_WEDNESDAY_RUN), 8, False, _WEDNESDAY_RUN)
    assert reads_due(late, _games(), False, _WEEK, _WEDNESDAY_RUN) == ReadsDue(_WEEK, _THURSDAY_RUN)
    assert ReadsDue(_WEEK, _THURSDAY_RUN).night == "Wednesday"
    assert reads_due(Rollover(_WEEK, True), _games(), True, _WEEK, _WEDNESDAY_RUN) is None
    november = {club: [replace(g, kickoff=g.kickoff + timedelta(days=14)) for g in s] for club, s in _games().items()}
    tuesday = _TUESDAY_RUN + timedelta(days=14)
    standard = rollover(_WEEK, november, {}, 7, False, tuesday)
    due = reads_due(standard, november, False, _WEEK, tuesday)
    assert due == ReadsDue(_WEEK, _WEDNESDAY_RUN + timedelta(days=14)) and due.night == "Tuesday"
    assert ReadsDue(_WEEK, _WEDNESDAY_RUN).json() == {
        "week": _WEEK,
        "night": "Tuesday",
        "at": "2026-10-28T05:30:00.000Z",
    }


def test_a_board_the_run_does_not_cover_or_a_final_never_held_names_the_last_pass() -> None:
    """The review's M2: a preseason board (no rest-of-season week) or a week before still short of a final
    keeps the trigger waiting to its last pass, Thursday 05:30 UTC on a Thursday night week, and the page
    names that night, never the projection's."""
    waiting = rollover(_WEEK, _games(), _states(_TUESDAY_RUN), None, False, _TUESDAY_RUN)
    assert reads_due(waiting, _games(), False, None, _TUESDAY_RUN) == ReadsDue(_WEEK, _THURSDAY_RUN)
    unfinal = rollover(_WEEK, _games(), _states(_TUESDAY_RUN, monday_final=False), 7, False, _TUESDAY_RUN)
    assert reads_due(unfinal, _games(), False, _WEEK, _TUESDAY_RUN) == ReadsDue(_WEEK, _THURSDAY_RUN)


@pytest.mark.parametrize(
    ("at", "night"),
    [
        (datetime(2026, 10, 28, 5, 30, tzinfo=UTC), "Tuesday"),  # daylight time
        (datetime(2026, 11, 11, 5, 30, tzinfo=UTC), "Tuesday"),  # standard time
        (datetime(2026, 11, 2, 5, 30, tzinfo=UTC), "Sunday"),
        (datetime(2026, 10, 29, 5, 30, tzinfo=UTC), "Wednesday"),
    ],
)
def test_the_night_is_named_from_a_fixed_table_on_the_eastern_clock(at: datetime, night: str) -> None:
    """The review's L3: never the locale's weekday name."""
    assert night_of(at) == night and night in NIGHTS


# THE PASS, against the scratch database.


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
    if "engine" in request.fixturenames:
        with request.getfixturevalue("engine").begin() as conn:
            conn.execute(delete(PLAYER_WEEK_READS))
            conn.execute(delete(PLAYER_WEEK_READ_RUNS))


_BOARD_WEEK = 6
# The pass's instant: the fixtures' facts are read at it, so every sheet is written from it.
_PASS = WRITTEN_AT


def _completion(read: str, call: str) -> httpx.Response:
    usage = {"prompt_tokens": 2000, "completion_tokens": 120, "total_tokens": 2120, "cost": 0.0004}
    choice = {"message": {"content": answer_json(read, call)}, "finish_reason": "stop"}
    return httpx.Response(200, json={"choices": [choice], "usage": usage})


@dataclass
class _Writer:
    """The stub gateway's answers by the player asked about; Puka Nacua's first `fail_first` asks quote a
    figure the card does not print, so his first read falls to its facts block."""

    fail_first: int = 0
    asked: list[str] | None = None
    # The model each ask went to (Lane 276), when the test reads them.
    models: list[str] | None = None

    def __call__(self, request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        user = body["messages"][-1]["content"]
        who = user.split("\n", 2)[1]
        (self.asked if self.asked is not None else []).append(who)
        (self.models if self.models is not None else []).append(body["model"])
        if "Puka Nacua" in who:
            if self.fail_first > 0:
                self.fail_first -= 1
                return _completion(STARTER_READ.replace("25.9 PPR points", "25.6 PPR points"), "start")
            return _completion(STARTER_READ, "start")
        return _completion(_QUESTIONABLE_READ, "hold")


@dataclass
class _WeekFacts:
    board_week: int
    rollover: Rollover


def _step(  # noqa: PLR0913 - the step's stubs
    engine: Engine,
    monkeypatch: pytest.MonkeyPatch,
    sheets: Sequence[WeekSheet],
    writer: _Writer,
    *,
    ready: bool = True,
    hourly: bool = False,
    retry: str = "",
    at: datetime = WRITTEN_AT,
    lines: list[str] | None = None,
) -> StepRecord:
    """`run_week_read_step` at `at` on the given board-week sheets, with the gateway stubbed by `writer` and the
    retry writer `retry` (off when empty, as the tests before Lane 276 ran)."""
    monkeypatch.setenv(CAPSULE_CONFIG.gateway.api_key_variable, "test-key")
    monkeypatch.setenv(CAPSULE_CONFIG.gateway.retry_model_variable, retry)
    monkeypatch.setattr(week_reads, "checked_price", lambda *_args: _PRICE)
    state = Rollover(_BOARD_WEEK, ready, () if ready else ("week 6's published projection",))
    monkeypatch.setattr(week_reads, "read_week_facts", lambda *_args: _WeekFacts(_BOARD_WEEK, state))
    monkeypatch.setattr(week_reads, "collect_week_sheets", lambda *_args: list(sheets))

    class _Client:
        @staticmethod
        def for_run(*_args: object) -> GatewayClient:
            return replace(
                GatewayClient("test-key", httpx.Client(transport=httpx.MockTransport(writer))), concurrency=1
            )

    monkeypatch.setattr(week_reads, "GatewayClient", _Client)
    facts: Callable[..., tuple[()]] = lambda _conn, _now: ()  # noqa: E731 - the facts pass the stubs ignore
    log = (lines if lines is not None else []).append
    return week_reads.run_week_read_step(engine, at, log, facts, hourly=hourly)  # type: ignore[arg-type]


def _reads(engine: Engine) -> dict[tuple[str, int], StoredWeekRead]:
    with engine.connect() as conn:
        return stored_week_reads(conn, _SEASON, [_BOARD_WEEK, _BOARD_WEEK + 1])


def test_before_the_roll_over_nothing_is_written_and_the_gateway_is_never_asked(
    engine: Engine, monkeypatch: pytest.MonkeyPatch
) -> None:
    asked: list[str] = []
    record = _step(engine, monkeypatch, [starter(), questionable()], _Writer(asked=asked), ready=False)
    assert record.status == "skipped" and "nothing written before it" in record.summary
    assert asked == [] and _reads(engine) == {}


def test_the_roll_over_writes_every_board_players_read_from_one_facts_instant(
    engine: Engine, monkeypatch: pytest.MonkeyPatch
) -> None:
    """No page cap and no trickle: both board players with a week 6 game are written, at the pass's one instant
    (the player whose club's week 6 game has kicked off has no sheet, `collect.read_week_facts`, held below on
    the real tables)."""
    sheets = [starter(), questionable()]
    record = _step(engine, monkeypatch, sheets, _Writer())
    reads = _reads(engine)
    assert set(reads) == {(starter().player_id, _BOARD_WEEK), (questionable().player_id, _BOARD_WEEK)}
    assert {read.source for read in reads.values()} == {WRITTEN_SOURCE}
    assert {read.written_at for read in reads.values()} == {_PASS}
    assert record.status == "ran" and "2 reads due (first 2), 2 written" in record.summary
    assert "; every due read written; " in record.summary


def test_a_read_that_falls_to_its_facts_block_is_asked_again_and_the_pass_ends_complete(
    engine: Engine, monkeypatch: pytest.MonkeyPatch
) -> None:
    record = _step(engine, monkeypatch, [starter(), questionable()], _Writer(fail_first=MAX_CALLS_PER_READ))
    reads = _reads(engine)
    assert {read.source for read in reads.values()} == {WRITTEN_SOURCE}
    puka = reads[(starter().player_id, _BOARD_WEEK)]
    # A written read's attempts restart at its write (Lane 275 fix round 2): the fall before it is the facts row's.
    assert puka.body == STARTER_READ and puka.attempts == 1
    assert "2 rounds" in record.summary and "every due read written" in record.summary
    assert "1 fell to their facts blocks: Puka Nacua" in record.summary


def test_a_read_still_unwritten_after_the_rounds_is_named_for_the_next_pass(
    engine: Engine, monkeypatch: pytest.MonkeyPatch
) -> None:
    writer = _Writer(fail_first=MAX_CALLS_PER_READ * week_reads.ROLLOVER_ROUNDS)
    record = _step(engine, monkeypatch, [starter(), questionable()], writer)
    assert _reads(engine)[(starter().player_id, _BOARD_WEEK)].source == FACTS_SOURCE
    assert f"{week_reads.ROLLOVER_ROUNDS} rounds" in record.summary
    # The review's L1: a partial board says so in its status and at the head of its line, a name a line.
    assert record.status == week_reads.PARTIAL
    assert record.summary.startswith("1 still unwritten; nightly, board week 6")
    assert record.summary.endswith("; unwritten, asked again on the next pass:\n  Puka Nacua")
    # Lane 265 fix round 1 (L4): the count is said once, at the head.
    assert record.summary.count("still unwritten") == 1


def test_a_board_the_budget_cut_short_is_partial_and_names_who_waits(
    engine: Engine, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The budget's stop (the review's L1): room for one read's worst case alone, so the second read never
    starts, writes nothing, and is named for the next pass."""
    monkeypatch.setattr(week_reads, "NIGHTLY_BUDGET_USD", week_reads.worst_read_usd(_PRICE) + 0.0001)
    record = _step(engine, monkeypatch, [starter(), questionable()], _Writer())
    reads = _reads(engine)
    assert set(reads) == {(starter().player_id, _BOARD_WEEK)}
    assert record.status == week_reads.PARTIAL and "1 stopped by the budget" in record.summary
    assert record.summary.startswith("1 still unwritten; ")
    assert record.summary.endswith("; unwritten, asked again on the next pass:\n  Bijan Robinson")


def test_an_hourly_pass_the_budget_cut_short_says_what_it_left_before_the_names(
    engine: Engine, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Lane 263's reads-left-unread note and Lane 265's names on one line (the Lane 265 review's M3): the note
    sits in the tally, before the names, never on the last name's line. Since Lane 275 fix round 2 a status
    rewrite that falls keeps the written read (held) and one the budget stopped keeps it too: neither landed,
    so both are named for the next pass."""
    _step(engine, monkeypatch, [starter(), questionable()], _Writer())
    monkeypatch.setattr(week_reads, "HOURLY_BUDGET_USD", week_reads.worst_read_usd(_PRICE) + 0.0001)
    moved = [
        replace(starter(), status=Status("questionable", REPORT)),
        replace(questionable(), status=Status("out", REPORT)),
    ]
    record = _step(engine, monkeypatch, moved, _Writer(), hourly=True)
    assert record.status == week_reads.PARTIAL and record.summary.startswith("2 still unwritten; hourly, ")
    tally, names = record.summary.split("; unwritten, asked again on the next pass:")
    assert "1 reads left unread, the next kickoff among them" in tally and "(1 held over the written read)" in tally
    assert names.count("\n  ") == 2 and "reads left unread" not in names  # noqa: PLR2004 - the held and the stopped
    reads = _reads(engine)
    assert {read.source for read in reads.values()} == {WRITTEN_SOURCE}


def test_mid_week_a_status_change_rewrites_that_player_alone(engine: Engine, monkeypatch: pytest.MonkeyPatch) -> None:
    sheets = [starter(), questionable()]
    _step(engine, monkeypatch, sheets, _Writer())
    before = _reads(engine)
    asked: list[str] = []
    # Thursday's report lists Puka Nacua as Questionable: the hourly pass after it rewrites his read alone.
    moved = [replace(starter(), status=Status("questionable", REPORT)), questionable()]
    record = _step(engine, monkeypatch, moved, _Writer(asked=asked), hourly=True)
    after = _reads(engine)
    assert "1 reads due (status 1)" in record.summary
    assert all("Puka Nacua" in who for who in asked) and asked
    bijan = (questionable().player_id, _BOARD_WEEK)
    assert after[bijan] == before[bijan]
    assert after[(starter().player_id, _BOARD_WEEK)].status == "questionable"


# THE RETRY WRITER AND THE HOURLY RETRIES (Lane 276).

_RETRY = "r/retry"
_YESTERDAY = date(2026, 10, 15)


def test_a_read_the_writer_could_not_write_is_rescued_by_the_retry_writer_within_the_first_round(
    engine: Engine, monkeypatch: pytest.MonkeyPatch
) -> None:
    models: list[str] = []
    writer = _Writer(fail_first=MAX_CALLS_PER_READ, models=models)
    record = _step(engine, monkeypatch, [starter(), questionable()], writer, retry=_RETRY)
    puka = _reads(engine)[(starter().player_id, _BOARD_WEEK)]
    assert (puka.source, puka.body, puka.model, puka.attempts) == (WRITTEN_SOURCE, STARTER_READ, _RETRY, 1)
    assert models.count(_RETRY) == 1 and models[MAX_CALLS_PER_READ] == _RETRY  # his fifth ask, after the writer's four
    assert "1 rounds" in record.summary and "every due read written" in record.summary
    assert f"1 asked of the retry writer {_RETRY}, 1 rescued" in record.summary


def test_the_hourly_pass_asks_a_fallen_read_again_every_hour_until_it_is_written(
    engine: Engine, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The roll-over's rounds all fell; the next hour's pass asks him again (writer and retry writer), within the
    hour's gap, and writes him; the pass after that has nothing to ask."""
    sheets = [starter(), questionable()]
    writer = _Writer(fail_first=(MAX_CALLS_PER_READ + 1) * week_reads.ROLLOVER_ROUNDS)
    _step(engine, monkeypatch, sheets, writer, retry=_RETRY)
    assert _reads(engine)[(starter().player_id, _BOARD_WEEK)].source == FACTS_SOURCE
    soon = _step(engine, monkeypatch, sheets, writer, retry=_RETRY, hourly=True, at=_PASS + timedelta(minutes=30))
    assert "0 reads due" in soon.summary
    asked: list[str] = []
    writer.asked = asked
    hour = _step(engine, monkeypatch, sheets, writer, retry=_RETRY, hourly=True, at=_PASS + timedelta(hours=1))
    assert "1 reads due (unwritten 1), 1 written" in hour.summary
    assert asked and all("Puka Nacua" in who for who in asked)
    assert _reads(engine)[(starter().player_id, _BOARD_WEEK)].source == WRITTEN_SOURCE
    after = _step(engine, monkeypatch, sheets, writer, retry=_RETRY, hourly=True, at=_PASS + timedelta(hours=2))
    assert "0 reads due" in after.summary


def _hourly_spent(engine: Engine, usd: float, at: datetime = _PASS - timedelta(minutes=5)) -> None:
    """The day's hourly passes so far spent `usd` (an earlier pass's row on `player_week_read_runs`)."""
    with engine.begin() as conn:
        conn.execute(
            insert(PLAYER_WEEK_READ_RUNS).values(
                ran_at=at, mode="hourly", calls=1, cost_usd=usd, written=0,
                facts_blocks=0, demoted=0,
            )
        )  # fmt: skip


def test_an_hourly_pass_at_the_days_cap_stops_asking_and_says_so(
    engine: Engine, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A fallen read due on an hourly pass whose day has less left than a read's worst case: nothing is asked,
    the read stands as it was, and the line says the retries' share of the day stopped it. The cap is never
    raised."""
    sheets = [starter(), questionable()]
    writer = _Writer(fail_first=(MAX_CALLS_PER_READ + 1) * week_reads.ROLLOVER_ROUNDS)
    _step(engine, monkeypatch, sheets, writer, retry=_RETRY)
    with engine.begin() as conn:
        conn.execute(delete(PLAYER_WEEK_READ_RUNS))
    _hourly_spent(engine, week_reads.HOURLY_DAY_USD - 0.001)
    asked: list[str] = []
    writer.asked = asked
    hour = _step(engine, monkeypatch, sheets, writer, retry=_RETRY, hourly=True, at=_PASS + timedelta(hours=1))
    assert asked == [] and "1 stopped by the budget" in hour.summary
    assert "1 unwritten reads not asked, the retries' share of the day's hourly $1.50 spent" in hour.summary
    assert "reads left unread" not in hour.summary  # the game-day alert's count is the status rewrites' alone
    assert _reads(engine)[(starter().player_id, _BOARD_WEEK)].source == FACTS_SOURCE
    _hourly_spent(engine, 0.001, _PASS + timedelta(minutes=65))
    spent = _step(engine, monkeypatch, sheets, writer, retry=_RETRY, hourly=True, at=_PASS + timedelta(hours=2))
    assert spent.status == "skipped" and f"${week_reads.HOURLY_DAY_USD:.2f} for the day is spent" in spent.summary
    assert asked == []


def test_an_hourly_pass_writes_a_status_that_moved_before_a_read_still_unwritten() -> None:
    """Lane 276: the hourly retries never take the dollars a status rewrite needs."""
    sheets = (starter(), questionable())
    stored = {
        (starter().player_id, _BOARD_WEEK): StoredWeekRead(
            starter().player_id, _SEASON, _BOARD_WEEK, FACTS_SOURCE, "Week: 6 of 2026", None,
            _PASS - timedelta(hours=2), None, {}, 18.4, starter().status.status, "first", None, _YESTERDAY, 1,
            WEEK_WRITER_VERSION,
        ),
        (questionable().player_id, _BOARD_WEEK): StoredWeekRead(
            questionable().player_id, _SEASON, _BOARD_WEEK, WRITTEN_SOURCE, "A read.", "m/x",
            _PASS - timedelta(hours=2), None, {}, 15.2, "out", "first", "hold", _YESTERDAY, 1,
            WEEK_WRITER_VERSION,
        ),
    }  # fmt: skip
    night = week_reads._Night(sheets, stored, _BOARD_WEEK, Rollover(_BOARD_WEEK, True), ShapeMasks.of(()))
    due = week_reads._due(night, _PASS, hourly=True)
    assert [(sheet.name, reason) for sheet, reason in due] == [
        ("Bijan Robinson", "status"),
        ("Puka Nacua", "unwritten"),
    ]


def test_a_status_rewrite_the_budget_left_unasked_is_counted_unwritten_and_asked_the_next_hour(
    engine: Engine, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The Lane 265 re-review's M1: a rewrite the day's dollars stopped keeps its old written row, so the rows
    alone would call it written; the line names it as unwritten, and the next hour with dollars asks it."""
    _step(engine, monkeypatch, [starter(), questionable()], _Writer())
    with engine.begin() as conn:
        conn.execute(delete(PLAYER_WEEK_READ_RUNS))
    _hourly_spent(engine, week_reads.HOURLY_DAY_USD - 0.001)
    moved = [replace(starter(), status=Status("questionable", REPORT)), questionable()]
    asked: list[str] = []
    hour = _step(engine, monkeypatch, moved, _Writer(asked=asked), hourly=True, at=_PASS + timedelta(hours=1))
    assert asked == [] and "1 reads due (status 1)" in hour.summary and "1 stopped by the budget" in hour.summary
    assert hour.status == week_reads.PARTIAL and hour.summary.startswith("1 still unwritten; ")
    assert hour.summary.endswith("; unwritten, asked again on the next pass:\n  Puka Nacua")
    assert _reads(engine)[(starter().player_id, _BOARD_WEEK)].status != "questionable"
    with engine.begin() as conn:
        conn.execute(delete(PLAYER_WEEK_READ_RUNS))
    after = _step(engine, monkeypatch, moved, _Writer(asked=asked), hourly=True, at=_PASS + timedelta(hours=2))
    assert asked and "every due read written" in after.summary
    assert _reads(engine)[(starter().player_id, _BOARD_WEEK)].status == "questionable"


def test_retries_that_spent_their_share_leave_a_late_status_rewrite_funded(
    engine: Engine, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The Lane 276 review's H1: the day's hourly passes have spent the retries' whole share, and a late pass has a
    status that moved and a read still unwritten. The status rewrite is asked and written on the status share;
    the retry is asked nothing and the line says why."""
    _step(engine, monkeypatch, [starter(), questionable()], _Writer())
    bijan = _reads(engine)[(questionable().player_id, _BOARD_WEEK)]
    with engine.begin() as conn:
        upsert_week_read(conn, replace(bijan, source=FACTS_SOURCE, body="Week: 6 of 2026", model=None, call=None))
        conn.execute(delete(PLAYER_WEEK_READ_RUNS))
    _hourly_spent(engine, week_reads.HOURLY_DAY_USD - week_reads.HOURLY_STATUS_RESERVE_USD)
    moved = [replace(starter(), status=Status("questionable", REPORT)), questionable()]
    asked: list[str] = []
    late = _step(
        engine, monkeypatch, moved, _Writer(asked=asked), retry=_RETRY, hourly=True, at=_PASS + timedelta(hours=1)
    )
    assert asked and all("Puka Nacua" in who for who in asked)
    reads = _reads(engine)
    assert (reads[(starter().player_id, _BOARD_WEEK)].source, reads[(starter().player_id, _BOARD_WEEK)].status) == (
        WRITTEN_SOURCE,
        "questionable",
    )
    assert reads[(questionable().player_id, _BOARD_WEEK)].source == FACTS_SOURCE
    assert "1 unwritten reads not asked, the retries' share" in late.summary


def test_the_status_share_covers_a_game_days_status_rewrites_at_their_worst_case() -> None:
    worst = week_reads.worst_read_usd(_PRICE)
    assert week_reads.GAME_DAY_STATUS_READS * worst <= week_reads.HOURLY_STATUS_RESERVE_USD
    assert week_reads.HOURLY_STATUS_RESERVE_USD < week_reads.HOURLY_DAY_USD
    assert week_reads.retry_share_usd(0.0) == pytest.approx(0.50)
    assert week_reads.retry_share_usd(0.49) == pytest.approx(0.01)
    assert week_reads.retry_share_usd(1.20) == 0.0


def test_a_retry_model_the_gateways_list_does_not_carry_turns_the_retry_writer_off_with_one_warning(
    engine: Engine, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The Lane 276 review's H2: the pass runs, its reads written by the writer alone, and one line names the
    setting; it never fails the pass."""
    unlisted = ModelPrice(_RETRY, None, None, "the list does not carry it", False)
    monkeypatch.setattr(week_reads, "fetch_price", lambda *_args: unlisted)
    models: list[str] = []
    lines: list[str] = []
    record = _step(engine, monkeypatch, [starter(), questionable()], _Writer(models=models), retry=_RETRY, lines=lines)
    assert record.status == "ran" and "the retry writer off" in record.summary and _RETRY not in models
    warnings = [line for line in lines if "RETRY_WRITER_MODEL" in line]
    assert len(warnings) == 1 and f"names {_RETRY}" in warnings[0] and "off for this pass" in warnings[0]
    assert not warnings[0].startswith(week_reads.WARNING_MARKER)


def test_a_retry_writer_rescue_replaces_a_held_read_and_a_retry_fall_keeps_it(
    engine: Engine, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The Lane 276 merge with Lane 275's hold: a status rewrite GLM cannot write and the retry writer can is
    written over the held read, the retry model named; one both writers fail keeps the written read (held)."""
    _step(engine, monkeypatch, [starter(), questionable()], _Writer())
    first = _reads(engine)[(starter().player_id, _BOARD_WEEK)]
    moved = [replace(starter(), status=Status("questionable", REPORT)), questionable()]
    fell_all = _Writer(fail_first=MAX_CALLS_PER_READ + 1)
    kept = _step(engine, monkeypatch, moved, fell_all, retry=_RETRY, hourly=True, at=_PASS + timedelta(hours=1))
    held = _reads(engine)[(starter().player_id, _BOARD_WEEK)]
    assert (held.source, held.body, held.status) == (WRITTEN_SOURCE, first.body, first.status)
    assert "(1 held over the written read)" in kept.summary and "1 asked of the retry writer" in kept.summary
    rescue = _Writer(fail_first=MAX_CALLS_PER_READ)
    done = _step(engine, monkeypatch, moved, rescue, retry=_RETRY, hourly=True, at=_PASS + timedelta(hours=2))
    written = _reads(engine)[(starter().player_id, _BOARD_WEEK)]
    assert (written.source, written.model, written.status) == (WRITTEN_SOURCE, _RETRY, "questionable")
    assert written.attempts == 1 and "1 rescued" in done.summary and "every due read written" in done.summary


def test_an_hourly_fall_never_lands_over_a_read_another_pass_wrote_meanwhile(
    engine: Engine, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The re-review's N1: an hourly pass reads Puka's facts row and asks him again; before its fall lands, the
    nightly (another pass) writes his read. The hourly's facts block is never written over it: the written read
    stands, the hourly counts him held, and his name stays among the unwritten for the cadence."""
    writer = _Writer(fail_first=(MAX_CALLS_PER_READ + 1) * week_reads.ROLLOVER_ROUNDS)
    _step(engine, monkeypatch, [starter(), questionable()], writer, retry=_RETRY)
    fallen = _reads(engine)[(starter().player_id, _BOARD_WEEK)]
    assert fallen.source == FACTS_SOURCE
    nightly = replace(fallen, source=WRITTEN_SOURCE, body=STARTER_READ, model="m/x", call="start",
                      written_at=_PASS + timedelta(minutes=61), attempts=1)  # fmt: skip
    racing = _Writer(fail_first=MAX_CALLS_PER_READ + 1)

    def answer(request: httpx.Request) -> httpx.Response:
        with engine.begin() as conn:
            upsert_week_read(conn, nightly)
        return racing(request)

    hour = _step(engine, monkeypatch, [starter(), questionable()], answer, retry=_RETRY, hourly=True,  # type: ignore[arg-type]
                 at=_PASS + timedelta(hours=1))  # fmt: skip
    stood = _reads(engine)[(starter().player_id, _BOARD_WEEK)]
    assert (stood.source, stood.body, stood.written_at) == (WRITTEN_SOURCE, STARTER_READ, nightly.written_at)
    assert "(1 held over the written read)" in hour.summary
    assert hour.summary.endswith("; unwritten, asked again on the next pass:\n  Puka Nacua")


def test_the_store_replaces_only_the_row_the_pass_read(engine: Engine) -> None:
    pid = starter().player_id
    first = StoredWeekRead(
        pid, _SEASON, _BOARD_WEEK, FACTS_SOURCE, "Week: 6 of 2026", None, _PASS, None, {}, 18.4, None, "first",
        None, _YESTERDAY, 1, WEEK_WRITER_VERSION,
    )  # fmt: skip
    written = replace(first, source=WRITTEN_SOURCE, body=STARTER_READ, written_at=_PASS + timedelta(hours=1))
    with engine.begin() as conn:
        assert replace_week_read(conn, first, None)
        assert not replace_week_read(conn, written, None)  # a row appeared since the pass read none
        assert replace_week_read(conn, written, first)
        assert not replace_week_read(conn, first, first)  # the row the pass read is gone
    assert _reads(engine)[(pid, _BOARD_WEEK)].body == STARTER_READ


def test_a_retry_model_listed_with_no_price_turns_the_retry_writer_off_with_one_warning(
    engine: Engine, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The re-review's N4: never the budget in calls a missing price would make of the pass."""
    unpriced = ModelPrice(_RETRY, None, None, "listed without pricing", True)
    monkeypatch.setattr(week_reads, "fetch_price", lambda *_args: unpriced)
    models: list[str] = []
    lines: list[str] = []
    record = _step(engine, monkeypatch, [starter(), questionable()], _Writer(models=models), retry=_RETRY, lines=lines)
    assert record.status == "ran" and "the retry writer off" in record.summary and _RETRY not in models
    assert "budget $2.50" in record.summary  # dollars, never calls
    warnings = [line for line in lines if "RETRY_WRITER_MODEL" in line]
    assert len(warnings) == 1 and "carries with no price" in warnings[0]


# THE HELD REWRITES' ROUNDS AND THE DRY PASS (Lane 293).

# A read written while the rules asked for the published projection, addressing the member: rule-stale since Lane 286.
_STALE_READ = "The published projection of 11.2 points keeps him on your bench. Hold him until Sunday."


def _stale_puka(engine: Engine) -> StoredWeekRead:
    """The roll-over's reads, then Puka Nacua's body replaced by a rule-stale one, as on 2026-10-29."""
    key = (starter().player_id, _BOARD_WEEK)
    with engine.begin() as conn:
        upsert_week_read(conn, replace(_reads(engine)[key], body=_STALE_READ))
    return _reads(engine)[key]


def test_a_rule_stale_rewrite_that_falls_is_asked_again_within_the_nightly_and_written(
    engine: Engine, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The 2026-10-29 nightly: 404 rule-stale rewrites in one round, the 153 that fell held over the old reads and
    never asked again within the pass. The next round asks a held rewrite under its own reason."""
    _step(engine, monkeypatch, [starter(), questionable()], _Writer())
    _stale_puka(engine)
    asked: list[str] = []
    night = _PASS + timedelta(days=1)
    record = _step(engine, monkeypatch, [starter(), questionable()], _Writer(fail_first=MAX_CALLS_PER_READ, asked=asked),
                   at=night)  # fmt: skip
    puka = _reads(engine)[(starter().player_id, _BOARD_WEEK)]
    assert (puka.source, puka.body, puka.reason) == (WRITTEN_SOURCE, STARTER_READ, "rule")
    assert "1 reads due (rule 1)" in record.summary and "2 rounds" in record.summary
    # The review's M2: held is counted a read at the pass's end, its asks apart.
    assert "(0 held over the written read)" in record.summary and "2 rounds (1 asks held over a" in record.summary
    assert record.status == "ran" and all("Puka Nacua" in who for who in asked)
    assert "every due read written" in record.summary


def _on(sheets: Sequence[WeekSheet], at: datetime) -> list[WeekSheet]:
    """The sheets as a pass at `at` reads them, stamped at its instant (the review's M3: a fall is counted on the
    sheet's Central day, so a test of the day's cap puts the sheets on the pass's day)."""
    return [replace(sheet, written_at=at) for sheet in sheets]


# A nightly at 00:30 CDT on Sunday 18 October, and that day's 10:30 CDT hourly pass.
_NIGHT = datetime(2026, 10, 18, 5, 30, tzinfo=UTC)
_MORNING = datetime(2026, 10, 18, 15, 30, tzinfo=UTC)


def test_a_rule_stale_rewrite_that_falls_every_round_keeps_the_old_read_and_is_named(
    engine: Engine, monkeypatch: pytest.MonkeyPatch
) -> None:
    _step(engine, monkeypatch, [starter(), questionable()], _Writer())
    stale = _stale_puka(engine)
    writer = _Writer(fail_first=MAX_CALLS_PER_READ * week_reads.ROLLOVER_ROUNDS)
    record = _step(engine, monkeypatch, _on([starter(), questionable()], _NIGHT), writer, at=_NIGHT)
    kept = _reads(engine)[(starter().player_id, _BOARD_WEEK)]
    assert (kept.source, kept.body, kept.written_at) == (WRITTEN_SOURCE, _STALE_READ, stale.written_at)
    # The review's H1: the day marked attempted, no status fall counted.
    assert (kept.attempt_day, kept.attempts) == (central_day(_NIGHT), 1)
    assert f"{week_reads.ROLLOVER_ROUNDS} rounds ({week_reads.ROLLOVER_ROUNDS} asks held" in record.summary
    assert "(1 held over the written read)" in record.summary
    assert record.status == week_reads.PARTIAL and record.summary.endswith("next pass:\n  Puka Nacua")


def test_a_rule_stale_night_never_takes_a_status_rewrite_later_that_day(
    engine: Engine, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The review's H1: three rule-stale falls at 00:30 CT, then his status moves; the 10:30 CT pass rewrites it."""
    _step(engine, monkeypatch, [starter(), questionable()], _Writer())
    _stale_puka(engine)
    lost = _Writer(fail_first=MAX_CALLS_PER_READ * week_reads.ROLLOVER_ROUNDS)
    _step(engine, monkeypatch, _on([starter(), questionable()], _NIGHT), lost, at=_NIGHT)
    moved = _on([replace(starter(), status=Status("questionable", REPORT)), questionable()], _MORNING)
    hour = _step(engine, monkeypatch, moved, _Writer(), hourly=True, at=_MORNING)
    puka = _reads(engine)[(starter().player_id, _BOARD_WEEK)]
    assert "1 reads due (status 1)" in hour.summary and "every due read written" in hour.summary
    assert (puka.status, puka.body, puka.reason) == ("questionable", STARTER_READ, "status")


def test_a_later_round_never_asks_a_read_another_pass_wrote_between_rounds(
    engine: Engine, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The review's M1: Puka's rule-stale rewrite falls in round 1; before round 2 an hourly pass writes his read
    from newer facts. Round 2 leaves it standing and asks him no more."""
    _step(engine, monkeypatch, [starter(), questionable()], _Writer())
    stale = _stale_puka(engine)
    hourly = replace(stale, body=STARTER_READ, written_at=_NIGHT + timedelta(minutes=30), reason="status")
    real = demote_shared_keeping

    def demote_then_hourly(*args: Any, **kwargs: Any) -> Any:
        demotion = real(*args, **kwargs)
        with engine.begin() as conn:
            upsert_week_read(conn, hourly)
        return demotion

    monkeypatch.setattr(week_reads, "demote_shared_keeping", demote_then_hourly)
    asked: list[str] = []
    writer = _Writer(fail_first=MAX_CALLS_PER_READ * week_reads.ROLLOVER_ROUNDS, asked=asked)
    record = _step(engine, monkeypatch, _on([starter(), questionable()], _NIGHT), writer, at=_NIGHT)
    stood = _reads(engine)[(starter().player_id, _BOARD_WEEK)]
    assert len(asked) == MAX_CALLS_PER_READ and "1 rounds" in record.summary
    assert (stood.body, stood.written_at) == (STARTER_READ, hourly.written_at)


def _row(source: str, *, attempts: int = 1, day: date = date(2026, 10, 16)) -> StoredWeekRead:
    sheet = starter()
    return StoredWeekRead(
        sheet.player_id, _SEASON, sheet.week, source, STARTER_READ, "m/x", _PASS, None, {}, 18.4, None, "first",
        "start", day, attempts, WEEK_WRITER_VERSION,
    )  # fmt: skip


def test_the_next_round_asks_every_due_read_that_did_not_land_and_stand() -> None:
    sheet, key, today = starter(), (starter().player_id, starter().week), central_day(_PASS)
    due = [(sheet, "rule")]
    spend = week_reads.WeekReadSpend()

    def again(reads: dict[tuple[str, int], StoredWeekRead], asked: Sequence[tuple[WeekSheet, str]] = due) -> object:
        return week_reads.asked_again(asked, reads, spend, reads)  # the rows as the pass started from them

    facts = _row(FACTS_SOURCE)
    assert again({key: facts}) == [(sheet, "unwritten")] and again({}) == [(sheet, "unwritten")]
    held = _row(WRITTEN_SOURCE, attempts=2, day=today)
    assert again({key: held}) == due
    # A status rewrite the pass has lost twice is left for the day's last hourly retry (Lane 293 fix round 1).
    twice = _row(WRITTEN_SOURCE, attempts=1 + 2, day=today)
    assert again({key: twice}, [(sheet, "status")]) == [] and not status_rewrite_capped(twice, _PASS)
    assert again({key: held}, [(sheet, "status")]) == [(sheet, "status")]
    spend.written_reads.add(key)
    assert again({key: held}) == []
    spend.written_reads.clear()
    # The review's M1: a row another pass wrote since this one left it (or started from it) is the cadence's.
    hourly = replace(held, written_at=_PASS + timedelta(hours=1))
    assert week_reads.asked_again(due, {key: hourly}, spend, {key: held}) == []
    assert week_reads.asked_again(due, {key: hourly}, spend, {}) == []  # a first read an hourly pass wrote
    spend.stood[key] = week_reads.row_stamp(hourly)  # this pass's own row: asked again
    assert week_reads.asked_again(due, {key: hourly}, spend, {key: held}) == due


def test_the_dry_pass_says_what_it_would_ask_and_asks_and_writes_nothing(
    engine: Engine, monkeypatch: pytest.MonkeyPatch
) -> None:
    _step(engine, monkeypatch, [starter(), questionable()], _Writer())
    _stale_puka(engine)
    before = _reads(engine)
    monkeypatch.setattr(week_reads, "NIGHTLY_BUDGET_USD", week_reads.worst_read_usd(_PRICE) + 0.0001)
    lines: list[str] = []
    facts: Callable[..., tuple[()]] = lambda _conn, _now: ()  # noqa: E731 - the facts pass the stubs ignore
    night = _PASS + timedelta(days=1)
    record = week_reads.dry_week_read_step(engine, night, lines.append, facts, _PRICE)  # type: ignore[arg-type]
    assert record.status == week_reads.DRY and _reads(engine) == before
    assert "nothing asked or written; 1 reads due (rule 1), at least 1 admitted under $0.00" in record.summary
    assert record.summary.endswith("in the order asked:\n  Puka Nacua (rule)") and lines == [
        f"week-reads dry: {record.summary}"
    ]


def test_a_pass_admits_reads_at_their_worst_case_until_the_budget_cannot_take_another() -> None:
    assert week_reads.admitted_at_worst(268, 2.50, 0.0033) == 268  # noqa: PLR2004 - the 2026-10-29 scratch night
    assert week_reads.admitted_at_worst(10, 0.01, 0.0033) == 3  # noqa: PLR2004
    assert week_reads.admitted_at_worst(5, 0.0, 0.0) == 5  # noqa: PLR2004 - no list price: nothing to hold them


def test_a_nightly_status_rewrite_is_asked_twice_and_leaves_the_day_one_hourly_retry(
    engine: Engine, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Lane 293 fix round 1: the nightly's rounds ask a status rewrite at most twice, so a rewrite both rounds lose
    keeps the written read with one of the day's three status falls left; the next hourly pass asks it, and once
    that one falls too the day's cap holds every later pass (the review's M3: the sheets on the pass's day)."""
    _step(engine, monkeypatch, [starter(), questionable()], _Writer())
    moved = [replace(starter(), status=Status("questionable", REPORT)), questionable()]
    asked: list[str] = []
    failing = _Writer(fail_first=MAX_CALLS_PER_READ * 9, asked=asked)
    record = _step(engine, monkeypatch, _on(moved, _NIGHT), failing, at=_NIGHT)
    held = _reads(engine)[(starter().player_id, _BOARD_WEEK)]
    assert len(asked) == 2 * MAX_CALLS_PER_READ and "2 rounds" in record.summary
    assert held.status != "questionable" and held.attempts == 1 + 2 and not status_rewrite_capped(held, _NIGHT)
    _step(engine, monkeypatch, _on(moved, _MORNING), failing, hourly=True, at=_MORNING)
    assert len(asked) == 3 * MAX_CALLS_PER_READ
    assert status_rewrite_capped(_reads(engine)[(starter().player_id, _BOARD_WEEK)], _MORNING)
    later = _MORNING + timedelta(hours=1)
    capped = _step(engine, monkeypatch, _on(moved, later), _Writer(asked=asked), hourly=True, at=later)
    assert len(asked) == 3 * MAX_CALLS_PER_READ and "0 reads due" in capped.summary


def test_the_roll_over_writes_an_angle_led_read_with_the_angles_on(
    engine: Engine, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The review's H3: with the angles on, the pass's ask carries his angles, the read the stub writes in their
    words passes the validator and is stored as written, and the facts block is the same as with them off."""
    sheet = _angled()
    asked: list[str] = []

    def writer(request: httpx.Request) -> httpx.Response:
        asked.append(json.loads(request.content)["messages"][-1]["content"])
        return _completion(_ACCEPTED, "start")

    monkeypatch.setattr(angles_module, "ANGLES_ON", True)
    off_block = render_week_facts_block(sheet)
    record = _step(engine, monkeypatch, [sheet], writer)  # type: ignore[arg-type]
    stored = _reads(engine)[(sheet.player_id, _BOARD_WEEK)]
    assert record.status == "ran" and stored.source == WRITTEN_SOURCE and stored.body == _ACCEPTED
    assert sheet.angles[0].text in asked[0] and sheet.angles[1].text in asked[0]
    assert validate_week_read(stored.body, sheet, call=stored.call).ok
    assert render_week_facts_block(sheet) == off_block


@pytest.fixture(autouse=True)
def _main_sheet() -> Iterator[None]:
    """These tests pin main's sheet, its lines and the reads written from it (Lane 300 turned the angles on; the
    angles' sheet is `test_week_read_angles`'s)."""
    with main_sheet():
        yield
