"""The daily player list refreshes each listed player's club on `provider_players` (Lane 122), a free
agent's to NULL (Lane 123, B101).

Through the capture pass (`capture_return_dates`, the harvest's day read): the club write lands in the
snapshot's transaction, a free agent's club is cleared and counts as a change, a player off the list and a
code outside the 32 keep their row, a free agent who signs takes his club, a pass past the ceiling writes
no club and fails while the snapshot stands, and the next hour retries it.
The operator's backfill applies the newest stored list with no ceiling, its dry run writing nothing.

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
from sqlalchemy import Connection, Engine, func, insert, select

from research.db.engine import make_engine
from research.db.schema import CAPTURE_CHECKS, CAPTURE_SNAPSHOTS, PROVIDER_PLAYERS
from research.db.url import sqlalchemy_url
from research.parity import databases
from research.pipeline.budget import FixedBudget
from research.pipeline.http import HttpResponse
from research.pipeline.nflverse.team_codes import NFL_TEAM_ABBREVIATIONS
from research.pipeline.tank01.capture import (
    PLAYER_LIST_SOURCE,
    FeedOutcome,
    capture_return_dates,
    latest_player_list,
)
from research.pipeline.tank01.client import Paths, Tank01Client
from research.pipeline.tank01.player_clubs import (
    MAX_CLUB_CHANGES_PER_PASS,
    backfill_player_clubs,
    listed_clubs,
)

_DATABASE: Final = "parity_test_player_clubs"
_EASTERN: Final = ZoneInfo("America/New_York")
SEASON: Final = 2026

# The seed as production holds it (Lane 120's five): Dortch DET, McCarthy MIN; Allen has not moved.
SEEDED: Final = (
    ("4037235", "Greg Dortch", "WR", "DET"),
    ("4433970", "J.J. McCarthy", "QB", "MIN"),
    ("3918298", "Josh Allen", "QB", "BUF"),
    ("4872957", "Raylen Sharpe", "WR", "IND"),
    ("4362238", "Off The List", "RB", "KC"),
    ("DST-BUF", "Buffalo Bills", "DEF", "BUF"),
)


def _listed(player_id: str, team: str, *, free_agent: bool = False) -> dict[str, object]:
    return {"playerID": player_id, "team": team, "isFreeAgent": "True" if free_agent else "False", "injury": {}}


# The list as the provider answered it on 2026-10-12, in the recorded shape: Dortch BUF, McCarthy NYG.
# Sharpe is a free agent whose `team` is his last club; a code outside the 32 is not a club.
LIST: Final = [
    _listed("4037235", "BUF"),
    _listed("4433970", "NYG"),
    _listed("3918298", "BUF"),
    _listed("4872957", "MIA", free_agent=True),
    _listed("9999999", "LAC"),
]


def _eastern(day: int, hour: int) -> datetime:
    return datetime(2026, 10, day, hour, tzinfo=_EASTERN)


@dataclass
class _Fetcher:
    body: object = field(default_factory=lambda: LIST)
    asked: list[str] = field(default_factory=list)

    def get(self, url: str, headers: Mapping[str, str] | None = None) -> HttpResponse:
        path = url.partition("?")[0]
        assert path.endswith(Paths.PLAYER_LIST)
        self.asked.append(path)
        return HttpResponse(200, json.dumps({"statusCode": 200, "body": self.body}).encode(), {})

    def stream(self, url: str, headers: Mapping[str, str] | None = None) -> tuple[int, Iterator[bytes]]:
        raise AssertionError("never streams")


@pytest.fixture
def engine() -> Iterator[Engine]:
    if "PARITY_DATABASE_URL" not in os.environ:
        pytest.skip("needs a Postgres for scratch databases")
    built = make_engine(sqlalchemy_url(databases.build_with_alembic(_DATABASE)))
    try:
        with built.begin() as conn:
            rows = [{"id": i, "name": n, "position": p, "team": t} for i, n, p, t in SEEDED]
            conn.execute(insert(PROVIDER_PLAYERS), rows)
        yield built
    finally:
        built.dispose()
        databases.drop(_DATABASE)


def _read(conn: Connection, fetcher: _Fetcher, at: datetime) -> FeedOutcome | None:
    return capture_return_dates(conn, Tank01Client(fetcher, "key"), at, SEASON, FixedBudget(1))


def _clubs(conn: Connection) -> dict[str, str | None]:
    return {r.id: r.team for r in conn.execute(select(PROVIDER_PLAYERS.c.id, PROVIDER_PLAYERS.c.team))}


def _stored(conn: Connection) -> int:
    t = CAPTURE_SNAPSHOTS
    return int(conn.execute(select(func.count()).where(t.c.source == PLAYER_LIST_SOURCE)).scalar_one())


def _checked(conn: Connection) -> datetime | None:
    t = CAPTURE_CHECKS
    return conn.execute(select(t.c.checked_at).where(t.c.source == PLAYER_LIST_SOURCE)).scalar_one_or_none()


SEEDED_CLUBS: Final = {i: t for i, _n, _p, t in SEEDED}


def test_the_days_read_writes_each_listed_players_club(engine: Engine) -> None:
    with engine.begin() as conn:
        outcome = _read(conn, _Fetcher(), _eastern(20, 6))
        clubs = _clubs(conn)
    assert outcome == FeedOutcome(PLAYER_LIST_SOURCE, "captured", 1, note="3 clubs changed")
    # The movers take the list's club and the free agent has none; the rest keep their row: Allen
    # unmoved, the player off the list and the defense. The id the store does not hold is never inserted.
    assert clubs == {**SEEDED_CLUBS, "4037235": "BUF", "4433970": "NYG", "4872957": None}


def test_a_free_agent_who_signs_takes_his_club(engine: Engine) -> None:
    fetcher = _Fetcher()
    with engine.begin() as conn:
        _read(conn, fetcher, _eastern(20, 6))
        fetcher.body = [*LIST[:3], _listed("4872957", "IND"), *LIST[4:]]
        signed = _read(conn, fetcher, _eastern(21, 6))
        clubs = _clubs(conn)
    assert signed == FeedOutcome(PLAYER_LIST_SOURCE, "captured", 1, note="1 club changed")
    assert clubs["4872957"] == "IND"


def test_a_club_that_changes_between_reads_is_written_by_the_later_one(engine: Engine) -> None:
    fetcher = _Fetcher()
    with engine.begin() as conn:
        _read(conn, fetcher, _eastern(20, 6))
        fetcher.body = [*LIST[:1], _listed("4433970", "MIN"), *LIST[2:]]
        unchanged_day = _read(conn, fetcher, _eastern(20, 7))
        moved = _read(conn, fetcher, _eastern(21, 6))
        clubs = _clubs(conn)
    assert unchanged_day is None  # the day's read is taken
    assert moved == FeedOutcome(PLAYER_LIST_SOURCE, "captured", 1, note="1 club changed")
    assert clubs["4433970"] == "MIN" and clubs["4037235"] == "BUF"


def test_an_unchanged_list_still_writes_its_clubs(engine: Engine) -> None:
    """An unchanged list stores no snapshot, and still applies its clubs: a club changed by hand, or left
    by an earlier refusal, comes back to the list's on the next read."""
    with engine.begin() as conn:
        _read(conn, _Fetcher(), _eastern(20, 6))
        conn.execute(PROVIDER_PLAYERS.update().where(PROVIDER_PLAYERS.c.id == "4037235").values(team="DET"))
        again = _read(conn, _Fetcher(), _eastern(21, 6))
        clubs, stored = _clubs(conn), _stored(conn)
    assert again == FeedOutcome(PLAYER_LIST_SOURCE, "unchanged", 1, note="1 club changed")
    assert clubs["4037235"] == "BUF" and stored == 1


def _crowd(conn: Connection, count: int) -> list[dict[str, object]]:
    """`count` stored players on DET, and a list moving each of them to BUF."""
    rows = [{"id": f"crowd-{n:03d}", "name": f"Crowd {n}", "position": "WR", "team": "DET"} for n in range(count)]
    conn.execute(insert(PROVIDER_PLAYERS), rows)
    return [*LIST, *(_listed(str(r["id"]), "BUF") for r in rows)]


def test_a_read_past_the_ceiling_writes_no_club_fails_and_keeps_its_snapshot(engine: Engine) -> None:
    with engine.begin() as conn:
        body = _crowd(conn, MAX_CLUB_CHANGES_PER_PASS - 2)  # with Dortch, McCarthy and Sharpe, 61 changes
        refused = _read(conn, _Fetcher(body=body), _eastern(20, 6))
        clubs, stored, checked = _clubs(conn), _stored(conn), _checked(conn)
    assert refused is not None and refused.status == "failed" and refused.requests == 1
    assert refused.reason is not None and refused.reason.startswith("refused 61 club changes, more than 60")
    assert clubs["4037235"] == "DET" and clubs["crowd-000"] == "DET" and clubs["4872957"] == "IND"
    # The return dates stand: the snapshot is stored, but the day's read is not taken, so the next hour
    # asks again and fails again while the provider's list stays so.
    assert (stored, checked) == (1, None)


def test_a_read_at_the_ceiling_writes_every_club(engine: Engine) -> None:
    with engine.begin() as conn:
        body = _crowd(conn, MAX_CLUB_CHANGES_PER_PASS - 3)  # 60 changes, the free agent's among them
        outcome = _read(conn, _Fetcher(body=body), _eastern(20, 6))
        clubs = _clubs(conn)
    assert outcome == FeedOutcome(PLAYER_LIST_SOURCE, "captured", 1, note="60 clubs changed")
    assert clubs["crowd-056"] == "BUF" and clubs["4872957"] is None


def test_the_refused_list_is_written_once_the_provider_answers_right(engine: Engine) -> None:
    fetcher = _Fetcher()
    with engine.begin() as conn:
        fetcher.body = _crowd(conn, MAX_CLUB_CHANGES_PER_PASS)
        _read(conn, fetcher, _eastern(20, 6))
        fetcher.body = LIST
        later = _read(conn, fetcher, _eastern(20, 7))
        clubs = _clubs(conn)
    assert later == FeedOutcome(PLAYER_LIST_SOURCE, "captured", 1, note="3 clubs changed")
    assert clubs["4037235"] == "BUF" and clubs["crowd-000"] == "DET"


def test_the_backfill_applies_the_newest_stored_list_with_no_ceiling(engine: Engine) -> None:
    with engine.begin() as conn:
        assert backfill_player_clubs(conn, latest_player_list(conn), write=True).startswith("no player list read")
        body = _crowd(conn, MAX_CLUB_CHANGES_PER_PASS)
        _read(conn, _Fetcher(body=body), _eastern(20, 6))  # refused by the pass
        read = latest_player_list(conn)
        dry = backfill_player_clubs(conn, read, write=False)
        before = _clubs(conn)
        done = backfill_player_clubs(conn, read, write=True)
        after = _clubs(conn)
        again = backfill_player_clubs(conn, read, write=True)
    assert (
        dry.splitlines()[0]
        == "63 clubs would change, dry run, nothing written, from the list read at 2026-10-20T10:00:00+00:00"
    )
    assert "  4037235 Greg Dortch DET to BUF" in dry.splitlines()
    assert "  4872957 Raylen Sharpe IND to free agent" in dry.splitlines()
    assert before["4037235"] == "DET" and before["4872957"] == "IND"
    assert done.splitlines()[0].startswith("63 clubs changed")
    assert after["4037235"] == "BUF" and after["crowd-059"] == "BUF" and after["DST-BUF"] == "BUF"
    assert after["4872957"] is None
    assert again.splitlines() == ["0 clubs changed, from the list read at 2026-10-20T10:00:00+00:00"]


def test_the_list_names_a_club_for_a_listed_player_on_one_of_the_32_and_none_for_a_free_agent() -> None:
    body = [
        _listed("1", "BUF"),
        _listed("2", "MIA", free_agent=True),
        _listed("3", "FA"),
        _listed(" 4 ", "WSH"),
        {"playerID": "", "team": "KC"},
        {"playerID": 5, "team": "KC"},
        {"playerID": "6", "team": None},
        "not a player",
    ]
    assert listed_clubs(body) == {"1": "BUF", "2": None, "4": "WSH"}
    assert listed_clubs({"body": body}) == {}
    assert len(NFL_TEAM_ABBREVIATIONS) == 32  # noqa: PLR2004 - the 32 clubs
