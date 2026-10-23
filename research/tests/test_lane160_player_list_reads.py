"""The player list read before the passes that need it (Lane 160, B138).

The daily read at 06:00 Eastern is up to a day behind a return date the provider moves. Two more reads, the
same feed and tables: the harvest's first pass from 09:00 Eastern on a game day of the current week, and
the Thursday 14:00 Eastern pass (`season-week`, the week's final pass) before its freeze. A failed read
fails its own step alone.

Runs against a migrated scratch database and needs PARITY_DATABASE_URL (skipped without it, run by CI);
the openings' rule runs without one.
"""

import json
import os
from collections.abc import Iterator, Mapping
from dataclasses import dataclass, field
from datetime import UTC, date, datetime
from typing import Final
from zoneinfo import ZoneInfo

import pytest
from sqlalchemy import Connection, Engine, func, insert, select

from research.db.engine import make_engine
from research.db.schema import CAPTURE_SNAPSHOTS, PROVIDER_GAMES, TEAM_WEEK_OBSERVATIONS
from research.db.url import sqlalchemy_url
from research.inseason.season_week import PLAYER_LIST, STEPS, SeasonWeekContext, run_season_week
from research.parity import databases
from research.pipeline.budget import FixedBudget
from research.pipeline.http import HttpResponse
from research.pipeline.nflverse.schedule import ScheduleMetric, ScheduleSource
from research.pipeline.tank01.capture import (
    PLAYER_LIST_SOURCE,
    FeedOutcome,
    capture_return_dates,
    return_dates_opening,
)
from research.pipeline.tank01.client import API_KEY_ENV, Paths, Tank01Client

_DATABASE: Final = "parity_test_lane160_player_list"
_EASTERN: Final = ZoneInfo("America/New_York")
SEASON: Final = 2026
LIST_BODY: Final = [
    {"playerID": "4241478", "longName": "Christian Kirk", "team": "SF", "pos": "WR",
     "injury": {"designation": "Injured Reserve - Designated to Return", "injDate": "20240501",
                "injReturnDate": "20261025", "description": ""}},
]  # fmt: skip
# Week 8: Thursday Oct 22 (20:15 Eastern), Sunday Oct 25, Monday Oct 26.
_WEEK8_DAYS: Final = (date(2026, 10, 22), date(2026, 10, 25), date(2026, 10, 26))
_THURSDAY_KICKOFF: Final = datetime(2026, 10, 23, 0, 15, tzinfo=UTC)
_GAME_DATES: Final = ("20261025", "20261026")


def _eastern(day: int, hour: int, minute: int = 0) -> datetime:
    return datetime(2026, 10, day, hour, minute, tzinfo=_EASTERN)


@dataclass
class _Fetcher:
    """The player list answers `body`, or `status` with an error while it is not 200."""

    body: object = field(default_factory=lambda: LIST_BODY)
    status: int = 200
    asked: list[str] = field(default_factory=list)

    def get(self, url: str, headers: Mapping[str, str] | None = None) -> HttpResponse:
        path = url.partition("?")[0]
        assert path.endswith(Paths.PLAYER_LIST)
        self.asked.append(path)
        envelope = {"statusCode": self.status, "body": self.body}
        return HttpResponse(self.status, json.dumps(envelope).encode(), {})

    def stream(self, url: str, headers: Mapping[str, str] | None = None) -> tuple[int, Iterator[bytes]]:
        raise AssertionError("never streams")


# THE OPENINGS: 06:00 every day, 09:00 too on a game day.


def test_a_game_day_opens_again_at_nine_eastern() -> None:
    assert return_dates_opening(_eastern(25, 5, 59), _GAME_DATES) is None
    assert return_dates_opening(_eastern(25, 8, 59), _GAME_DATES) == _eastern(25, 6)
    assert return_dates_opening(_eastern(25, 9), _GAME_DATES) == _eastern(25, 9)
    assert return_dates_opening(_eastern(25, 23, 59), _GAME_DATES) == _eastern(25, 9)


def test_a_day_with_no_game_opens_at_six_alone() -> None:
    assert return_dates_opening(_eastern(24, 9, 30), _GAME_DATES) == _eastern(24, 6)
    assert return_dates_opening(_eastern(24, 9, 30), ()) == _eastern(24, 6)


# THROUGH THE STORE.


@pytest.fixture
def engine() -> Iterator[Engine]:
    if "PARITY_DATABASE_URL" not in os.environ:
        pytest.skip("needs a Postgres for scratch databases")
    built = make_engine(sqlalchemy_url(databases.build_with_alembic(_DATABASE)))
    with built.begin() as conn:
        conn.execute(
            insert(PROVIDER_GAMES),
            [
                {"game_id": f"{d:%Y%m%d}_G{i}", "season": SEASON, "week": 8, "home_team": "MIN",
                 "away_team": "KC", "game_date": d, "kickoff_et": "1:00p", "status": "scheduled"}
                for i, d in enumerate(_WEEK8_DAYS)
            ],
        )  # fmt: skip
        conn.execute(
            insert(TEAM_WEEK_OBSERVATIONS),
            [
                {"season": SEASON, "week": week, "team": team, "source": ScheduleSource.KICKOFF,
                 "metric": ScheduleMetric.KICKOFF_INSTANT, "as_of": at, "value": 1.0}
                for week, team, at in (
                    (8, "LAC", _THURSDAY_KICKOFF),
                    (8, "MIN", datetime(2026, 10, 25, 17, 0, tzinfo=UTC)),
                    (9, "MIN", datetime(2026, 11, 1, 18, 0, tzinfo=UTC)),
                )
            ],
        )  # fmt: skip
    try:
        yield built
    finally:
        built.dispose()
        databases.drop(_DATABASE)


def _harvest(conn: Connection, fetcher: _Fetcher, at: datetime) -> FeedOutcome | None:
    return capture_return_dates(conn, Tank01Client(fetcher, "key"), at, SEASON, FixedBudget(3))


def _stored(conn: Connection) -> int:
    t = CAPTURE_SNAPSHOTS
    return int(conn.execute(select(func.count()).where(t.c.source == PLAYER_LIST_SOURCE)).scalar_one())


def test_the_harvest_reads_the_list_again_on_a_game_days_morning(engine: Engine) -> None:
    fetcher = _Fetcher()
    with engine.begin() as conn:
        six = _harvest(conn, fetcher, _eastern(25, 6, 5))
        before_nine = _harvest(conn, fetcher, _eastern(25, 8, 5))
        fetcher.body = [{**LIST_BODY[0], "injury": {**LIST_BODY[0]["injury"], "injReturnDate": "20261101"}}]  # type: ignore[dict-item]
        nine = _harvest(conn, fetcher, _eastern(25, 9, 5))
        ten = _harvest(conn, fetcher, _eastern(25, 10, 5))
        stored = _stored(conn)
    assert six == FeedOutcome(PLAYER_LIST_SOURCE, "captured", 1, note="0 clubs changed")
    assert before_nine is None and ten is None
    # The provider moved his date overnight: the Sunday read stores the newer list for the API.
    assert nine == FeedOutcome(PLAYER_LIST_SOURCE, "captured", 1, note="0 clubs changed")
    assert stored == 2  # noqa: PLR2004 - the 06:00 read and the 09:00 read
    assert len(fetcher.asked) == 2  # noqa: PLR2004


def test_a_day_with_no_game_is_read_once(engine: Engine) -> None:
    fetcher = _Fetcher()
    with engine.begin() as conn:
        six = _harvest(conn, fetcher, _eastern(24, 6, 5))
        nine = _harvest(conn, fetcher, _eastern(24, 9, 5))
    assert six is not None and six.status == "captured"
    assert nine is None
    assert len(fetcher.asked) == 1


def test_a_failed_morning_read_is_asked_again_the_next_hour(engine: Engine) -> None:
    fetcher = _Fetcher()
    with engine.begin() as conn:
        _harvest(conn, fetcher, _eastern(25, 6, 5))
        fetcher.status = 500
        failed = _harvest(conn, fetcher, _eastern(25, 9, 5))
        fetcher.status = 200
        later = _harvest(conn, fetcher, _eastern(25, 10, 5))
    assert failed is not None and failed.status == "failed" and failed.requests == 1
    assert later is not None and later.status == "unchanged"


def _pass(engine: Engine, fetcher: _Fetcher, now: datetime, environ: Mapping[str, str]) -> list[tuple[str, str, str]]:
    # The player list and the scoreboard (to show the pass goes on), every other step skipped.
    skip = frozenset(STEPS) - {PLAYER_LIST, "scoreboard"}
    context = SeasonWeekContext(engine, fetcher, now, SEASON, environ, skip)
    return [(r.step, r.status, r.summary) for r in run_season_week(context) if r.step in (PLAYER_LIST, "scoreboard")]


_KEY: Final = {API_KEY_ENV: "key"}


def test_the_thursday_pass_reads_the_list_before_its_freeze(engine: Engine) -> None:
    fetcher = _Fetcher()
    results = _pass(engine, fetcher, _eastern(22, 14), _KEY)
    assert results[0] == (PLAYER_LIST, "ok", "week 8: captured, 1 requests, 0 clubs changed")
    assert results[1][:2] == ("scoreboard", "ok")
    assert len(fetcher.asked) == 1
    with engine.connect() as conn:
        assert _stored(conn) == 1


def test_any_other_pass_skips_the_read_by_name(engine: Engine) -> None:
    fetcher = _Fetcher()
    for now in (_eastern(20, 8), _eastern(21, 18)):
        (step, *_) = _pass(engine, fetcher, now, _KEY)
        assert step == (PLAYER_LIST, "skipped", "not the week's final pass; the harvest's daily read stands")
    assert fetcher.asked == []


def test_a_failed_read_fails_its_step_alone(engine: Engine) -> None:
    failing = _Fetcher(status=500)
    (step, after) = _pass(engine, failing, _eastern(22, 14), _KEY)
    assert step[:2] == (PLAYER_LIST, "failed")
    assert after[:2] == ("scoreboard", "ok")
    (unkeyed, after_unkeyed) = _pass(engine, _Fetcher(), _eastern(22, 14), {})
    assert unkeyed == (PLAYER_LIST, "failed", f"{API_KEY_ENV} is not set.")
    assert after_unkeyed[:2] == ("scoreboard", "ok")
