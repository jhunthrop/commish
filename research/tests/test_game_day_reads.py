"""Lane 222 (B186): the publish hour before each kickoff window rebuilds the pages on this hour's status read.

The hours are pinned on the 2026 week 7 Sunday (Eastern daylight time, UTC-4), a Thursday night and a
standard-time Monday, so the rule never leans on the machine's clock or zone. The window hour, the wait for
this hour's capture and the build are driven through the store against a migrated scratch database (needs
PARITY_DATABASE_URL, skipped without it, run by CI).
"""

import json
import os
import shutil
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import pytest
from sqlalchemy import Engine, delete, insert, select

from research.db.engine import make_engine
from research.db.schema import CAPTURE_CHECKS, CAPTURE_SNAPSHOTS, TEAM_WEEK_OBSERVATIONS
from research.db.url import sqlalchemy_url
from research.nightly.config import LATEST_KEY
from research.nightly.designations import (
    BUILD_FILE,
    DISPATCH_ATTEMPTS,
    DISPATCH_BACKOFF_SECONDS,
    Hour,
    Marked,
    PlayerStatus,
    StatusRead,
    build_on_change,
    finish_marks,
    mark_public_runs,
)
from research.nightly.game_day_reads import (
    BUILD_LEAD,
    CAPTURE_WAIT,
    await_capture,
    game_day_hour,
    read_hour,
    window_read_due,
    window_words,
)
from research.nightly.publish import PublishOutcome, encode
from research.nightly.run_store import JSON_TYPE, LocalRunStore
from research.parity import databases
from research.pipeline.budget import UnmeteredBudget
from research.pipeline.http import HttpResponse
from research.pipeline.tank01.capture import CAPTURE_FEEDS, CapturePass, capture_once
from research.pipeline.tank01.client import Tank01Client

_FIXTURE = Path(__file__).resolve().parents[1] / "nightly" / "contract" / "fixture"
_RUN = "2026-10-21T12-ros"
_GIBBS = "4429795"
_BY_DATE = "tank01_injuries_by_date"
_DATABASE = "parity_test_game_day_reads"


def _utc(day: int, hour: int, minute: int = 0, month: int = 10, second: int = 0) -> datetime:
    return datetime(2026, month, day, hour, minute, second, tzinfo=UTC)


# Sunday 2026-10-25, EDT: 9:30 am abroad, 1:00 pm, 4:05 pm, 4:25 pm and 8:20 pm Eastern.
_SUNDAY = (_utc(25, 13, 30), _utc(25, 17), _utc(25, 17), _utc(25, 20, 5), _utc(25, 20, 25), _utc(26, 0, 20))
# This hour's capture check at the 12:00 ET window hour, the instant the web's test reads too
# (`web/src/lib/player/read-byline.test.ts`, SAME_HOUR_READ).
_SAME_HOUR_READ = _utc(25, 16, 4, second=10)


def test_the_lead_covers_the_wait_the_publish_step_and_the_longest_measured_build() -> None:
    # 10 minutes' wait, about a minute of publish, 27 minutes of the longest web build on 2026-10-25.
    assert timedelta(minutes=10) == CAPTURE_WAIT
    assert timedelta(minutes=40) == BUILD_LEAD


@pytest.mark.parametrize(
    ("kickoff", "hour"),
    [
        (_utc(25, 13, 30), _utc(25, 12)),  # 9:30 am abroad: read at 8:00 ET
        (_utc(25, 17), _utc(25, 16)),  # 1:00 pm: read at 12:00 ET
        (_utc(25, 20, 5), _utc(25, 19)),  # 4:05 pm: read at 3:00 ET
        (_utc(25, 20, 25), _utc(25, 19)),  # 4:25 pm: the same read
        (_utc(26, 0, 20), _utc(25, 23)),  # 8:20 pm: read at 7:00 ET
        (_utc(25, 17, 40), _utc(25, 16)),  # exactly the lead past an hour: that hour leaves no room, the one before
        (_utc(25, 17, 41), _utc(25, 17)),
        (_utc(23, 0, 15), _utc(22, 23)),  # Thursday Oct 22, 8:15 pm EDT: read at 7:00 pm ET
        (_utc(17, 1, 15, month=11), _utc(17, 0, month=11)),  # Monday Nov 16, 8:15 pm EST (UTC-5): read at 7:00 pm ET
    ],
)
def test_each_kickoff_is_read_before_by_the_last_hour_with_room_for_the_build(
    kickoff: datetime, hour: datetime
) -> None:
    assert read_hour(kickoff) == hour


def test_a_sunday_has_four_game_day_reads_and_a_thursday_one() -> None:
    due = {h: window_read_due(_SUNDAY, _utc(25, h, 2)) for h in range(24)}
    assert {h: k for h, k in due.items() if k is not None} == {
        12: _utc(25, 13, 30),
        16: _utc(25, 17),
        19: _utc(25, 20, 5),
        23: _utc(26, 0, 20),
    }
    assert window_words(_utc(25, 20, 5)) == "the 16:05 ET kickoffs"
    thursday = (_utc(23, 0, 15), _utc(23, 0, 15))
    assert [h for h in range(24) if window_read_due(thursday, _utc(22, h, 2))] == [23]


class _Clock:
    """A fixed clock that the test's sleep moves forward."""

    def __init__(self, at: datetime) -> None:
        self.at = at
        self.slept: list[float] = []

    def now(self) -> datetime:
        return self.at

    def sleep(self, seconds: float) -> None:
        self.slept.append(seconds)
        self.at += timedelta(seconds=seconds)


def test_the_wait_ends_on_this_hours_check_or_after_ten_minutes() -> None:
    hour = _utc(25, 16)
    clock = _Clock(_utc(25, 16, 0, second=5))
    checks = iter([_utc(25, 15), _utc(25, 15), _SAME_HOUR_READ])
    assert await_capture(lambda: next(checks), hour, clock.sleep, clock.now)
    assert clock.slept == [30.0, 30.0]
    stale = _Clock(_utc(25, 16, 0, second=5))
    assert not await_capture(lambda: _utc(25, 15), hour, stale.sleep, stale.now)
    assert stale.at - _utc(25, 16, 0, second=5) == CAPTURE_WAIT


@pytest.fixture
def store(tmp_path: Path) -> LocalRunStore:
    shutil.copytree(_FIXTURE / "runs", tmp_path / "runs")
    made = LocalRunStore(tmp_path)
    made.put(LATEST_KEY, encode({"runId": _RUN}), JSON_TYPE)
    return made


class _Dispatcher:
    def __init__(self, *failures: str | None) -> None:
        self.failures = list(failures)
        self.calls: list[str] = []

    def dispatch(self, run_id: str) -> str | None:
        self.calls.append(run_id)
        return self.failures.pop(0) if self.failures else None


def _marked(checked: datetime) -> Marked:
    read = StatusRead(_utc(25, 5), checked, _BY_DATE, {_GIBBS: PlayerStatus("injured_reserve", True, None)})
    return Marked(read, {_RUN: frozenset({_GIBBS})}, {_RUN: 2026}, "marked")


def _hour(dispatcher: object, now: datetime, *, dispatched: bool = False, clock: _Clock | None = None) -> Hour:
    window = window_read_due(_SUNDAY, now)
    sleep = (clock or _Clock(now)).sleep
    return Hour(dispatcher, PublishOutcome(_RUN, "publish", True, dispatched=dispatched), now, window, sleep)  # type: ignore[arg-type]


def _record(store: LocalRunStore) -> dict[str, Any]:
    found: dict[str, Any] = json.loads(store.get(f"runs/{_RUN}/{BUILD_FILE}") or b"{}")
    return found


def test_the_hour_before_a_window_builds_on_this_hours_read_and_only_then(store: LocalRunStore) -> None:
    dispatcher = _Dispatcher()
    # The run's own build in the morning takes the 7:00 ET read.
    own = build_on_change(store, _marked(_utc(25, 11, 2)), _hour(dispatcher, _utc(25, 11, 5), dispatched=True))
    assert own.ok and dispatcher.calls == []
    assert _record(store)["statusReadAt"] == "2026-10-25T11:02:00.000Z"
    # 11:00 ET is no window's hour: the newer read waits.
    quiet = build_on_change(store, _marked(_utc(25, 15, 3)), _hour(dispatcher, _utc(25, 15, 5)))
    assert "unchanged since its last build" in quiet.line and dispatcher.calls == []
    # 12:00 ET, before the 1:00 pm games: this hour's read, so the build is dispatched and its read recorded.
    before = build_on_change(store, _marked(_SAME_HOUR_READ), _hour(dispatcher, _utc(25, 16, 5)))
    assert before.line == (
        f"designations: run {_RUN}, 1 season-long, read again before the 13:00 ET kickoffs; "
        "the web build of it was dispatched"
    )
    assert dispatcher.calls == [_RUN]
    assert _record(store)["statusReadAt"] == "2026-10-25T16:04:10.000Z"
    # 3:00 pm ET with the same read (the capture did not check since): nothing new to show.
    same = build_on_change(store, _marked(_SAME_HOUR_READ), _hour(dispatcher, _utc(25, 19, 5)))
    assert "unchanged since its last build" in same.line and dispatcher.calls == [_RUN]
    # An older read than the build's (a check row gone, the stamp read instead) never builds (review L3).
    older = build_on_change(store, _marked(_utc(25, 15)), _hour(dispatcher, _utc(25, 19, 5)))
    assert "unchanged since its last build" in older.line and dispatcher.calls == [_RUN]
    # A read that found no change still moves the check, and so the stamp the page names.
    again = build_on_change(store, _marked(_utc(25, 19, 3)), _hour(dispatcher, _utc(25, 19, 5)))
    assert "before the 16:05 ET kickoffs" in again.line and dispatcher.calls == [_RUN, _RUN]


def test_a_refused_window_dispatch_is_tried_three_times_then_recorded_as_not_sent(store: LocalRunStore) -> None:
    """Review H1: the next hour is no window hour, so a refusal is retried in the hour and then said."""
    clock = _Clock(_utc(25, 16, 5))
    flaky = _Dispatcher("HTTP 502", None)
    sent = build_on_change(store, _marked(_SAME_HOUR_READ), _hour(flaky, _utc(25, 16, 5), clock=clock))
    assert sent.ok and flaky.calls == [_RUN, _RUN] and clock.slept == [DISPATCH_BACKOFF_SECONDS[0]]

    down = _Dispatcher(*["HTTP 503"] * DISPATCH_ATTEMPTS)
    clock = _Clock(_utc(25, 19, 5))
    failed = build_on_change(store, _marked(_utc(25, 19, 3)), _hour(down, _utc(25, 19, 5), clock=clock))
    assert not failed.ok
    assert failed.line == (
        f"designations: run {_RUN}, 1 season-long, read again before the 16:05 ET kickoffs; the dispatch FAILED "
        "3 attempts (HTTP 503); build not sent, the pages keep the earlier read"
    )
    assert len(down.calls) == DISPATCH_ATTEMPTS and clock.slept == list(DISPATCH_BACKOFF_SECONDS)
    record = _record(store)
    # The read the pages hold stays the last sent build's, and the miss is kept for the next hour's line.
    assert record["statusReadAt"] == "2026-10-25T16:04:10.000Z"
    assert record["notSent"]["before"] == "the 16:05 ET kickoffs"
    later = build_on_change(store, _marked(_utc(25, 20, 3)), _hour(_Dispatcher(), _utc(25, 20, 5)))
    assert later.ok and later.line == (
        f"designations: run {_RUN}, 1 season-long, unchanged since its last build; the build before the 16:05 ET "
        "kickoffs was not sent (HTTP 503), the pages keep the read of the build before it"
    )


def test_a_build_record_from_before_the_lane_builds_in_a_window_hour(store: LocalRunStore) -> None:
    store.put(
        f"runs/{_RUN}/{BUILD_FILE}",
        encode({"seasonLong": [_GIBBS], "at": "2026-10-25T11:00:00.000Z", "build": "dispatched"}),
        JSON_TYPE,
    )
    dispatcher = _Dispatcher()
    built = build_on_change(store, _marked(_SAME_HOUR_READ), _hour(dispatcher, _utc(25, 16, 5)))
    assert built.ok and dispatcher.calls == [_RUN], built.line


def test_a_window_hour_without_a_token_says_so_and_records_no_read_as_built(store: LocalRunStore) -> None:
    build_on_change(store, _marked(_utc(25, 11, 2)), _hour(_Dispatcher(), _utc(25, 11, 5), dispatched=True))
    skipped = build_on_change(store, _marked(_SAME_HOUR_READ), _hour("WEB_DISPATCH_TOKEN is not set", _utc(25, 16, 5)))
    assert skipped.ok and skipped.line == (
        f"designations: run {_RUN}, 1 season-long, read again before the 13:00 ET kickoffs; "
        "the web dispatch skipped (WEB_DISPATCH_TOKEN is not set)"
    )
    # Review L2: no build took the read, so the record keeps the morning's.
    assert _record(store)["statusReadAt"] == "2026-10-25T11:02:00.000Z"


# THROUGH THE STORE, against a migrated scratch database.


@pytest.fixture(scope="module")
def engine() -> Iterator[Engine]:
    if "PARITY_DATABASE_URL" not in os.environ:
        pytest.skip("needs a Postgres for scratch databases")
    url = databases.build_with_alembic(_DATABASE)
    built = make_engine(sqlalchemy_url(url))
    try:
        yield built
    finally:
        built.dispose()
        databases.drop(_DATABASE)


def _store_sunday(engine: Engine, checked: datetime | None) -> None:
    with engine.begin() as conn:
        conn.execute(delete(TEAM_WEEK_OBSERVATIONS))
        conn.execute(delete(CAPTURE_SNAPSHOTS))
        conn.execute(delete(CAPTURE_CHECKS))
        conn.execute(
            insert(TEAM_WEEK_OBSERVATIONS),
            [
                {"season": 2026, "week": 7, "team": team, "source": "nflverse_kickoff", "metric": "kickoff_instant",
                 "value": 1.0, "as_of": at}
                for team, at in (("ATL", _utc(25, 17)), ("SF", _utc(25, 17)), ("KC", _utc(26, 0, 20)))
            ],
        )  # fmt: skip
        listed = {"injList": [{"playerID": _GIBBS, "designation": "IR"}]}
        conn.execute(
            insert(CAPTURE_SNAPSHOTS),
            [{"source": _BY_DATE, "payload": listed, "captured_at": _utc(25, 5), "digest": "d"}],
        )
        if checked is not None:
            conn.execute(insert(CAPTURE_CHECKS), [{"source": _BY_DATE, "checked_at": checked}])


def test_a_stored_kickoff_makes_the_window_hour_and_finish_marks_builds_on_its_read(
    engine: Engine, store: LocalRunStore
) -> None:
    _store_sunday(engine, _SAME_HOUR_READ)
    clock = _Clock(_utc(25, 16, 5))
    day = game_day_hour(engine, clock.now(), clock.sleep, clock.now)
    assert day.window == _utc(25, 17) and clock.slept == []
    assert day.line == "game day: before the 13:00 ET kickoffs, this hour's status read is in"
    marked = mark_public_runs(engine, store, clock.now())
    assert marked.ok, marked.line
    dispatcher = _Dispatcher()
    hour = Hour(dispatcher, PublishOutcome(_RUN, "publish", True), clock.now(), day.window, clock.sleep)  # type: ignore[arg-type]
    steps = finish_marks(None, store, marked, hour)
    assert dispatcher.calls == [_RUN], [s.line for s in steps]
    assert _record(store)["statusReadAt"] == "2026-10-25T16:04:10.000Z"
    # 13:00 ET is no window's hour, and 7:00 pm ET is the night game's.
    assert game_day_hour(engine, _utc(25, 17, 5), clock.sleep, clock.now).window is None
    assert game_day_hour(engine, _utc(25, 23, 5), clock.sleep, clock.now).window == _utc(26, 0, 20)


def test_a_capture_that_has_not_checked_this_hour_is_waited_for_then_said(engine: Engine) -> None:
    _store_sunday(engine, _utc(25, 15))
    clock = _Clock(_utc(25, 16, 0, second=5))
    day = game_day_hour(engine, clock.now(), clock.sleep, clock.now)
    assert day.window == _utc(25, 17)
    assert day.line == (
        "game day: before the 13:00 ET kickoffs, this hour's status read did not land in 10 minutes; "
        "the build takes the newest read there is"
    )
    assert clock.at - _utc(25, 16, 0, second=5) == CAPTURE_WAIT


class _SameList:
    """The status feed answers the same list on every pass."""

    def get(self, url: str, headers: Any = None) -> HttpResponse:
        body = {"statusCode": 200, "body": {"injList": [{"playerID": _GIBBS, "designation": "IR"}]}}
        return HttpResponse(200, json.dumps(body).encode(), {})

    def stream(self, url: str, headers: Any = None) -> Any:
        raise AssertionError("never streams")


def test_an_unchanged_status_pass_still_moves_the_check(engine: Engine) -> None:
    """Review L6: the stamp the page names moves on a read that found no change."""
    _store_sunday(engine, None)
    feeds = [feed for feed in CAPTURE_FEEDS if feed.source == _BY_DATE]
    client = Tank01Client(_SameList(), "key")
    with engine.begin() as conn:
        first = capture_once(conn, client, CapturePass(_utc(25, 15), 2026, 7, feeds=feeds), UnmeteredBudget())
        second = capture_once(conn, client, CapturePass(_utc(25, 16, 2), 2026, 7, feeds=feeds), UnmeteredBudget())
        checked = conn.execute(select(CAPTURE_CHECKS.c.checked_at).where(CAPTURE_CHECKS.c.source == _BY_DATE))
        at = checked.scalar_one()
    assert [o.status for o in first.feeds] == ["captured"]
    assert [o.status for o in second.feeds] == ["unchanged"]
    assert at == _utc(25, 16, 2)
