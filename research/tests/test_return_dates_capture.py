"""The day's player list, for the injured players' return dates (Lane 110, B79).

The player list (`getNFLPlayerList`) is the one provider feed carrying each listed player's expected return
(`injury.injReturnDate`); the hourly injury list carries none. The harvest reads it once an Eastern day from
06:00, last in the pass, on what the capture and the game status left of the pass's ten requests.

Runs against a migrated scratch database and needs PARITY_DATABASE_URL (skipped without it, run by CI).
"""

import json
import os
from collections.abc import Iterator, Mapping
from dataclasses import dataclass, field
from datetime import datetime
from typing import Final
from zoneinfo import ZoneInfo

import pytest
from sqlalchemy import Connection, Engine, func, select

from research.db.engine import make_engine
from research.db.schema import CAPTURE_CHECKS, CAPTURE_SNAPSHOTS
from research.db.url import sqlalchemy_url
from research.parity import databases
from research.pipeline.budget import FixedBudget
from research.pipeline.http import HttpResponse
from research.pipeline.tank01.capture import (
    CAPTURE_FEEDS,
    PLAYER_LIST_FEED,
    PLAYER_LIST_SOURCE,
    FeedOutcome,
    capture_return_dates,
)
from research.pipeline.tank01.client import Paths, Tank01Client

_DATABASE: Final = "parity_test_return_dates_capture"
_EASTERN: Final = ZoneInfo("America/New_York")
SEASON: Final = 2026
# Two listed players in the recorded shape (tank01-capture-all-2026-10-12/tank01_player_list.json.gz).
PLAYER_LIST: Final = [
    {"playerID": "4241478", "longName": "Christian Kirk", "team": "SF", "pos": "WR",
     "injury": {"designation": "Injured Reserve - Designated to Return", "injDate": "20240501",
                "injReturnDate": "20261025", "description": "Oct 12: Kirk (calf) is unlikely to play."}},
    {"playerID": "4872957", "longName": "Raylen Sharpe", "team": "IND", "pos": "WR",
     "injury": {"designation": "", "injDate": "", "injReturnDate": "", "description": ""}},
]  # fmt: skip


def _eastern(day: int, hour: int, minute: int = 0) -> datetime:
    return datetime(2026, 10, day, hour, minute, tzinfo=_EASTERN)


@dataclass
class _Fetcher:
    """The player list answers `body`, or `status` with an error while it is not 200."""

    body: object = field(default_factory=lambda: PLAYER_LIST)
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


@pytest.fixture
def engine() -> Iterator[Engine]:
    if "PARITY_DATABASE_URL" not in os.environ:
        pytest.skip("needs a Postgres for scratch databases")
    built = make_engine(sqlalchemy_url(databases.build_with_alembic(_DATABASE)))
    try:
        yield built
    finally:
        built.dispose()
        databases.drop(_DATABASE)


def _read(conn: Connection, fetcher: _Fetcher, at: datetime, budget: int = 3) -> FeedOutcome | None:
    return capture_return_dates(conn, Tank01Client(fetcher, "key"), at, SEASON, FixedBudget(budget))


def _stored(conn: Connection) -> int:
    t = CAPTURE_SNAPSHOTS
    return int(conn.execute(select(func.count()).where(t.c.source == PLAYER_LIST_SOURCE)).scalar_one())


def _checked(conn: Connection) -> datetime | None:
    t = CAPTURE_CHECKS
    return conn.execute(select(t.c.checked_at).where(t.c.source == PLAYER_LIST_SOURCE)).scalar_one_or_none()


def test_the_list_is_read_once_an_eastern_day_from_six(engine: Engine) -> None:
    fetcher = _Fetcher()
    with engine.begin() as conn:
        early = _read(conn, fetcher, _eastern(20, 5, 59))
        tuesday = _read(conn, fetcher, _eastern(20, 6))
        again = _read(conn, fetcher, _eastern(20, 7))
        late = _read(conn, fetcher, _eastern(20, 23, 59))
        wednesday = _read(conn, fetcher, _eastern(21, 6))
        stored = _stored(conn)
    assert early is None and again is None and late is None
    # The store holds no players, so the read changes no club (Lane 122, `test_player_clubs.py`).
    assert tuesday == FeedOutcome(PLAYER_LIST_SOURCE, "captured", 1, note="0 clubs changed")
    # The same list the next day is that day's read, and the earlier snapshot stands.
    assert wednesday == FeedOutcome(PLAYER_LIST_SOURCE, "unchanged", 1, note="0 clubs changed")
    assert stored == 1
    assert len(fetcher.asked) == 2  # noqa: PLR2004 - Tuesday's and Wednesday's


def test_a_pass_with_no_request_left_names_it_and_the_next_one_reads_it(engine: Engine) -> None:
    fetcher = _Fetcher()
    with engine.begin() as conn:
        spent = _read(conn, fetcher, _eastern(20, 6), budget=0)
        later = _read(conn, fetcher, _eastern(20, 7), budget=1)
    assert spent == FeedOutcome(
        PLAYER_LIST_SOURCE, "budget-refused", 0, "left for a later pass, this pass's requests spent"
    )
    assert later is not None and later.status == "captured"
    assert len(fetcher.asked) == 1


@pytest.mark.parametrize("body", [[], {}, "", None], ids=["empty-list", "empty-object", "empty-string", "null"])
def test_a_list_with_no_players_fails_stores_nothing_and_is_asked_again(engine: Engine, body: object) -> None:
    fetcher = _Fetcher(body=body)
    with engine.begin() as conn:
        refused = _read(conn, fetcher, _eastern(20, 6))
        stored, checked = _stored(conn), _checked(conn)
        fetcher.body = PLAYER_LIST
        later = _read(conn, fetcher, _eastern(20, 7))
    assert refused is not None and refused.status == "failed"
    assert (stored, checked) == (0, None)
    assert later is not None and later.status == "captured"


def test_a_provider_failure_fails_and_is_asked_again(engine: Engine) -> None:
    fetcher = _Fetcher(status=500)
    with engine.begin() as conn:
        failed = _read(conn, fetcher, _eastern(20, 6))
        fetcher.status = 200
        later = _read(conn, fetcher, _eastern(20, 7))
    assert failed is not None and failed.status == "failed" and failed.requests == 1
    assert later is not None and later.status == "captured"


def test_the_full_capture_list_screens_the_player_list_as_the_harvest_does() -> None:
    (feed,) = [f for f in CAPTURE_FEEDS if f.source == PLAYER_LIST_SOURCE]
    assert feed is PLAYER_LIST_FEED
