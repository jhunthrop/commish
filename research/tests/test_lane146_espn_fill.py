"""A freeze with no ESPN yardstick takes the first read before kickoff (Amendment 6, Lane 146): the
in-season pass's `espn-fill` step fills only the standing freeze's empty rows, only from a read after it
and before the week's first kickoff, never twice, and never a freeze that kept ESPN's read; the weekly
record says beside the ESPN comparison when the read came after the order was set."""

import os
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from typing import Any, Final, cast

import pytest
from sqlalchemy import Engine, insert, select

from research.capsules.site_words import list_file, site_list
from research.db.engine import make_engine
from research.db.schema import (
    ESPN_PROJECTION_ROWS,
    PLAYERS,
    REGISTER_FREEZE_ROWS,
    REGISTER_GRADE_ROWS,
    TEAM_WEEK_OBSERVATIONS,
)
from research.db.url import sqlalchemy_url
from research.inseason import season_week
from research.inseason.season_week import SeasonWeekContext
from research.inseason.step_result import StepResult
from research.model.register.freeze import SERVED_SOURCE, SHIPPED_SOURCE
from research.nightly.build.season import weekly_json
from research.nightly.reads import weekly_record
from research.nightly.register_log import FrozenBy
from research.parity import databases
from research.pipeline.http import Fetcher

_DATABASE: Final = "parity_test_lane146_espn_fill"
_SEASON: Final = 2026
_WEEK: Final = 7
# Week 7 as it happened: frozen at 18:00:31Z with ESPN's read failed, read at 19:03:50Z, first kickoff 00:15Z.
_FROZEN: Final = datetime(2026, 10, 22, 18, 0, 31, tzinfo=UTC)
_READ: Final = datetime(2026, 10, 22, 19, 3, 50, tzinfo=UTC)
_KICKOFF: Final = datetime(2026, 10, 23, 0, 15, tzinfo=UTC)
_PASS: Final = datetime(2026, 10, 22, 20, 0, tzinfo=UTC)
# Three players ESPN projects, one it does not.
_ESPN_IDS: Final = {"00-a": "11", "00-b": "12", "00-c": "13", "00-d": "14"}
_PROJECTED: Final = {"11": 18.5, "12": 12.0, "13": 7.25}


@pytest.fixture(scope="module")
def engine() -> Iterator[Engine]:
    if "PARITY_DATABASE_URL" not in os.environ:
        pytest.skip("needs a Postgres for scratch databases")
    url = databases.build_with_alembic(_DATABASE)
    built = make_engine(sqlalchemy_url(url))
    try:
        with built.begin() as conn:
            conn.execute(
                insert(PLAYERS),
                [{"id": pid, "name": pid, "position": "WR", "espn_id": espn} for pid, espn in _ESPN_IDS.items()],
            )
            conn.execute(
                insert(TEAM_WEEK_OBSERVATIONS),
                [
                    {"season": _SEASON, "week": _WEEK, "team": "PIT", "source": "nflverse_kickoff",
                     "metric": "kickoff_instant", "value": 1.0, "as_of": _KICKOFF},
                ],
            )  # fmt: skip
        yield built
    finally:
        built.dispose()
        databases.drop(_DATABASE)


@pytest.fixture
def store(engine: Engine) -> Engine:
    with engine.begin() as conn:
        conn.execute(REGISTER_GRADE_ROWS.delete())
        conn.execute(REGISTER_FREEZE_ROWS.delete())
        conn.execute(ESPN_PROJECTION_ROWS.delete())
    return engine


def _freeze(engine: Engine, espn: dict[str, float | None], read_at: datetime | None = None) -> None:
    rows: list[dict[str, Any]] = [
        {"season": _SEASON, "week": _WEEK, "frozen_at": _FROZEN, "board_source": source, "player_id": pid,
         "implementation": "python", "board_as_of": _FROZEN - timedelta(hours=1), "board_points": 100.0 - place,
         "board_rank": place, "board_value_rank": place, "model_version": "m", "published_points": 10.0,
         "espn_points": espn.get(pid), "espn_read_at": None if espn.get(pid) is None else read_at}
        for source in (SERVED_SOURCE, SHIPPED_SOURCE)
        for place, pid in enumerate(_ESPN_IDS, start=1)
    ]  # fmt: skip
    with engine.begin() as conn:
        conn.execute(insert(REGISTER_FREEZE_ROWS), rows)


def _read(engine: Engine, at: datetime, points: dict[str, float]) -> None:
    with engine.begin() as conn:
        conn.execute(
            insert(ESPN_PROJECTION_ROWS),
            [{"season": _SEASON, "week": _WEEK, "read_at": at, "espn_id": espn, "ppr_points": value}
             for espn, value in points.items()],
        )  # fmt: skip


def _kept(engine: Engine) -> dict[tuple[str, str], tuple[float | None, datetime | None]]:
    table = REGISTER_FREEZE_ROWS.c
    with engine.connect() as conn:
        rows = conn.execute(select(table.board_source, table.player_id, table.espn_points, table.espn_read_at))
        return {(row.board_source, row.player_id): (row.espn_points, row.espn_read_at) for row in rows}


def _step(engine: Engine, now: datetime = _PASS) -> StepResult:
    context = SeasonWeekContext(engine, cast(Fetcher, None), now, _SEASON, {})
    return season_week.espn_fill(context)


def test_an_empty_freeze_takes_the_first_read_before_kickoff_on_its_empty_rows(store: Engine) -> None:
    _freeze(store, {})
    _read(store, _READ, _PROJECTED)
    _read(store, _READ + timedelta(hours=1), {"11": 99.0, "14": 99.0})  # a later read before kickoff
    step = _step(store)
    assert (step.step, step.status) == ("espn-fill", "ok")
    assert step.summary == "week 7: filled 6 rows from the read at 2026-10-22T19:03:50.000Z"
    kept = _kept(store)
    for source in (SERVED_SOURCE, SHIPPED_SOURCE):
        assert kept[source, "00-a"] == (18.5, _READ)  # the first read, not the later one
        assert kept[source, "00-c"] == (7.25, _READ)
        assert kept[source, "00-d"] == (None, None)  # ESPN did not project him on that read


def test_a_filled_freeze_is_never_filled_twice(store: Engine) -> None:
    _freeze(store, {})
    _read(store, _READ, {"11": 18.5})
    assert _step(store).status == "ok"
    _read(store, _READ + timedelta(hours=1), _PROJECTED)
    again = _step(store, _PASS + timedelta(hours=1))
    assert again.status == "skipped"
    assert again.summary == "week 7: the freeze at 2026-10-22T18:00:31.000Z kept ESPN's read"
    kept = _kept(store)
    assert kept[SHIPPED_SOURCE, "00-a"] == (18.5, _READ)
    assert kept[SHIPPED_SOURCE, "00-b"] == (None, None)  # the later read never fills the rest


def test_a_freeze_that_kept_espns_read_is_untouched(store: Engine) -> None:
    early = _FROZEN - timedelta(minutes=5)
    _freeze(store, {"00-a": 15.0}, early)
    _read(store, _READ, _PROJECTED)
    step = _step(store)
    assert step.status == "skipped"
    kept = _kept(store)
    assert kept[SHIPPED_SOURCE, "00-a"] == (15.0, early)
    assert kept[SHIPPED_SOURCE, "00-b"] == (None, None)


def test_a_read_at_or_after_the_first_kickoff_never_fills(store: Engine) -> None:
    _freeze(store, {})
    _read(store, _KICKOFF, _PROJECTED)
    _read(store, _FROZEN - timedelta(hours=2), _PROJECTED)  # before the freeze: the freeze saw it as none
    step = _step(store, _KICKOFF - timedelta(minutes=1))
    assert step.status == "skipped"
    assert step.summary == (
        "week 7: no ESPN read after the freeze at 2026-10-22T18:00:31.000Z and before the first kickoff "
        "2026-10-23T00:15:00.000Z"
    )
    assert all(value == (None, None) for value in _kept(store).values())


def test_no_freeze_and_no_week_ahead_fill_nothing(store: Engine) -> None:
    assert _step(store).summary == "week 7: no freeze holds week 7 yet"
    assert _step(store, _KICKOFF).summary == "no week of 2026 kicks off after 2026-10-23T00:15:00.000Z"


def test_a_filled_week_reads_on_the_record_with_its_read_named(store: Engine) -> None:
    _freeze(store, {})
    _read(store, _READ, _PROJECTED)
    assert _step(store).status == "ok"
    graded_at = _KICKOFF + timedelta(days=5)
    with store.begin() as conn:
        conn.execute(
            insert(REGISTER_GRADE_ROWS),
            [{"season": _SEASON, "week": _WEEK, "frozen_at": _FROZEN, "graded_at": graded_at,
              "board_source": SHIPPED_SOURCE, "player_id": pid, "actual_points": 40.0 - place * 10,
              "actual_rank": place, "board_rank": place, "implementation": "python", "model_version": "m"}
             for place, pid in enumerate(_ESPN_IDS, start=1)],
        )  # fmt: skip
    with store.connect() as conn:
        weekly, _ = weekly_record.read_weekly(conn, _SEASON, graded_at)
    assert weekly is not None
    seven = weekly.weeks[0]
    assert (seven.week, seven.status, seven.espn_note) == (_WEEK, "graded", weekly_record.ESPN_READ_AFTER_NOTE)
    every = next(line for line in seven.lines if line.position == "All")
    assert every.yardsticks["espn"] is not None


def test_the_fill_runs_after_the_freeze_in_the_pass() -> None:
    steps = season_week.STEPS
    assert steps.index("freeze") < steps.index(season_week.ESPN_FILL) < steps.index("scoreboard")
    assert steps.index(season_week.ESPN_PROJECTIONS) < steps.index(season_week.ESPN_FILL)


def _rows(espn: float | None, read_at: datetime | None, published: float | None = 10.0) -> list[dict[str, Any]]:
    return [{"espn_points": espn, "espn_read_at": read_at, "published_points": published}]


def test_the_weekly_record_says_when_espns_read_came_after_the_order_was_set() -> None:
    assert weekly_record.espn_note(_rows(18.5, _READ), _FROZEN) == weekly_record.ESPN_READ_AFTER_NOTE
    assert weekly_record.espn_note(_rows(18.5, _FROZEN), _FROZEN) is None  # the freeze's own read
    assert weekly_record.espn_note(_rows(18.5, None), _FROZEN) is None  # a fill whose read is not named
    assert weekly_record.espn_note(_rows(None, None), _FROZEN) == weekly_record.ESPN_UNREAD_NOTE
    assert weekly_record.espn_note(_rows(None, None, None), _FROZEN) is None  # nothing to grade against
    assert weekly_record.espn_note([], _FROZEN) is None
    banned, _ = site_list(list_file())
    for note in (weekly_record.ESPN_READ_AFTER_NOTE, weekly_record.ESPN_UNREAD_NOTE):
        assert banned.search(note) is None


def test_a_graded_week_carries_its_espn_note_on_the_run() -> None:
    graded = weekly_record.WeeklyWeek(
        _WEEK, "graded", _FROZEN, _FROZEN, _PASS, 0, (), espn_note=weekly_record.ESPN_READ_AFTER_NOTE
    )
    plain = weekly_record.WeeklyWeek(_WEEK, "graded", _FROZEN, _FROZEN, _PASS, 0, ())
    record = weekly_record.WeeklyRecord(_WEEK, (graded, plain), ())
    weeks = weekly_json(record, FrozenBy({}), _SEASON)["weeks"]
    assert weeks[0]["espnNote"] == weekly_record.ESPN_READ_AFTER_NOTE
    assert "espnNote" not in weeks[1]  # additive: a week with nothing to say carries no key
