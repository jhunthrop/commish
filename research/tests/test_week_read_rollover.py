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
from collections.abc import Callable, Sequence
from dataclasses import dataclass, replace
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
import pytest
from sqlalchemy import Engine, delete, insert

from research.capsules.config import CAPSULE_CONFIG
from research.capsules.facts_block import FACTS_SOURCE
from research.capsules.gateway import GatewayClient
from research.capsules.gateway_ledger import ModelPrice
from research.capsules.store import WRITTEN_SOURCE
from research.capsules.week.collect import board_week
from research.capsules.week.prompt import answer_json
from research.capsules.week.rollover import NIGHTS, ReadsDue, Rollover, next_nightly, night_of, reads_due, rollover
from research.capsules.week.sheet import Status, WeekSheet
from research.capsules.week.store import StoredWeekRead, stored_week_reads
from research.capsules.week.write import MAX_CALLS_PER_READ
from research.db.engine import make_engine
from research.db.schema import PLAYER_WEEK_READ_RUNS, PLAYER_WEEK_READS, PLAYERS
from research.db.url import sqlalchemy_url
from research.nightly import week_reads
from research.nightly.reads.schedule import ClubWeek, Game, GameState
from research.nightly.steps import StepRecord
from research.parity import databases
from research.tests.test_week_read_rules import STARTER_READ
from research.tests.test_week_read_store import _QUESTIONABLE_READ
from research.tests.week_read_fixtures import REPORT, WRITTEN_AT, questionable, starter

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

    def __call__(self, request: httpx.Request) -> httpx.Response:
        user = json.loads(request.content)["messages"][-1]["content"]
        who = user.split("\n", 2)[1]
        (self.asked if self.asked is not None else []).append(who)
        if "Puka Nacua" in who:
            if self.fail_first > 0:
                self.fail_first -= 1
                return _completion(STARTER_READ.replace("18.4 points", "18.6 points"), "start")
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
) -> StepRecord:
    """`run_week_read_step` on the given board-week sheets, with the gateway stubbed by `writer`."""
    monkeypatch.setenv(CAPSULE_CONFIG.gateway.api_key_variable, "test-key")
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
    return week_reads.run_week_read_step(engine, _PASS, lambda _line: None, facts, hourly=hourly)  # type: ignore[arg-type]


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
    assert puka.body == STARTER_READ and puka.attempts == 2  # noqa: PLR2004 - the fallen read and its retry
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
    sits in the tally, before the names, never on the last name's line."""
    _step(engine, monkeypatch, [starter(), questionable()], _Writer())
    monkeypatch.setattr(week_reads, "HOURLY_BUDGET_USD", week_reads.worst_read_usd(_PRICE) + 0.0001)
    moved = [
        replace(starter(), status=Status("questionable", REPORT)),
        replace(questionable(), status=Status("out", REPORT)),
    ]
    record = _step(engine, monkeypatch, moved, _Writer(), hourly=True)
    assert record.status == week_reads.PARTIAL and record.summary.startswith("1 still unwritten; hourly, ")
    tally, names = record.summary.split("; unwritten, asked again on the next pass:")
    assert "1 reads left unread, the next kickoff among them" in tally
    assert names.count("\n  ") == 1 and "reads left unread" not in names


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
