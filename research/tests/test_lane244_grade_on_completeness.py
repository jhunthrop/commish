"""A week grades once every game's stats are in (Lane 244), not on a thirty-six hour timer: the grade
step waits on the clubs the store does not hold whole, holds a floor after the last kickoff, still
fails four days on, and never grades Thursday night's freeze on its one played game."""

import os
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import UTC, datetime, timedelta
from typing import Any, Final, cast

import pytest
from sqlalchemy import Connection, Engine, insert

from research.db.engine import make_engine
from research.db.schema import PLAYER_WEEK_OBSERVATIONS, PLAYER_WEEK_TEAMS, PLAYERS, TEAM_WEEK_OBSERVATIONS
from research.db.url import sqlalchemy_url
from research.inseason import season_week
from research.inseason.season_week import (
    GRADE_FLOOR,
    GRADE_OVERDUE,
    SeasonWeekContext,
    earliest_grade,
    incomplete_clubs,
)
from research.model.register.grade import BoardGrade, WeekGrade
from research.parity import databases
from research.pipeline.http import Fetcher

_DATABASE: Final = "parity_test_lane244_completeness"
_SEASON: Final = 2026
_WEEK: Final = 7
# Week 7 of 2026: Thursday night, a Sunday afternoon and Monday night.
_THURSDAY: Final = datetime(2026, 10, 23, 0, 15, tzinfo=UTC)
_SUNDAY: Final = datetime(2026, 10, 25, 17, 0, tzinfo=UTC)
_MONDAY: Final = datetime(2026, 10, 27, 0, 15, tzinfo=UTC)
# Each game's lines and result as the store dates them: the end of its Eastern day plus a day.
_DATED: Final = {
    _THURSDAY: datetime(2026, 10, 24, 0, 0, tzinfo=UTC),
    _SUNDAY: datetime(2026, 10, 27, 0, 0, tzinfo=UTC),
    _MONDAY: datetime(2026, 10, 28, 0, 0, tzinfo=UTC),
}
_GAMES: Final = ((_THURSDAY, ("PIT", "CLE")), (_SUNDAY, ("DAL", "PHI")), (_MONDAY, ("DET", "TB")))
# The Tuesday pass twelve hours after Monday night's kickoff, past the night's lines being dated.
_TUESDAY_PASS: Final = _MONDAY + timedelta(hours=24)


class _FakeEngine:
    """Every read and write of the grade step is monkeypatched below, so no SQL runs."""

    @contextmanager
    def connect(self) -> Iterator[Connection]:
        yield cast(Connection, None)

    @contextmanager
    def begin(self) -> Iterator[Connection]:
        yield cast(Connection, None)


def _context(engine: Engine, now: datetime) -> SeasonWeekContext:
    return SeasonWeekContext(engine=engine, fetcher=cast(Fetcher, None), now=now, season=_SEASON, environ={})


def _graded(season: int, week: int, now: datetime) -> WeekGrade:
    board = BoardGrade("served", 3, [], [])
    return WeekGrade(season, week, now, now, [board], [], 3)


def _pass(monkeypatch: pytest.MonkeyPatch, now: datetime, missing: list[str]) -> tuple[Any, list[int]]:
    graded: list[int] = []

    def grade_week(conn: Connection, season: int, week: int, at: datetime) -> WeekGrade:
        graded.append(week)
        return _graded(season, week, at)

    monkeypatch.setattr(season_week, "_frozen_and_graded", lambda conn, season: ([_WEEK], set()))
    monkeypatch.setattr(season_week, "last_kickoffs_by_week", lambda conn, season: {_WEEK: _MONDAY})
    monkeypatch.setattr(season_week, "incomplete_clubs", lambda conn, season, week, at: list(missing))
    monkeypatch.setattr(season_week, "grade_week", grade_week)
    return season_week.grade(_context(cast(Engine, _FakeEngine()), now)), graded


def test_a_complete_week_grades_on_the_tuesday_pass(monkeypatch: pytest.MonkeyPatch) -> None:
    step, graded = _pass(monkeypatch, _TUESDAY_PASS, [])
    assert (step.status, graded, step.detail) == ("ok", [_WEEK], ("week 7: graded served=3",))


def test_a_week_missing_a_game_waits_and_names_it(monkeypatch: pytest.MonkeyPatch) -> None:
    step, graded = _pass(monkeypatch, _TUESDAY_PASS, ["DET no stat lines", "TB no stat lines"])
    assert (step.status, graded) == ("skipped", [])
    assert step.detail == ("week 7: waits on 2 clubs, DET no stat lines, TB no stat lines",)


def test_the_floor_holds_with_the_lines_present(monkeypatch: pytest.MonkeyPatch) -> None:
    step, graded = _pass(monkeypatch, _MONDAY + timedelta(hours=2), [])
    assert (step.status, graded) == ("skipped", [])
    assert step.detail == (f"week 7: waits, its last kickoff 2026-10-27T00:15:00.000Z is under {GRADE_FLOOR} ago",)


def test_an_incomplete_week_is_overdue_four_days_on(monkeypatch: pytest.MonkeyPatch) -> None:
    early, _ = _pass(monkeypatch, _MONDAY + GRADE_OVERDUE - timedelta(minutes=1), ["TB no final"])
    late, graded = _pass(monkeypatch, _MONDAY + GRADE_OVERDUE, ["TB no final"])
    assert early.status == "skipped"
    assert (late.status, graded, late.detail) == ("failed", [], ("week 7: OVERDUE, waits on 1 clubs, TB no final",))


def test_the_earliest_grade_is_when_the_last_games_lines_are_dated() -> None:
    assert earliest_grade(_MONDAY) == _DATED[_MONDAY]  # Tuesday 20:00 Eastern
    assert earliest_grade(_SUNDAY) == _DATED[_SUNDAY]
    assert earliest_grade(_THURSDAY) == _DATED[_THURSDAY]


@pytest.fixture(scope="module")
def engine() -> Iterator[Engine]:
    if "PARITY_DATABASE_URL" not in os.environ:
        pytest.skip("needs a Postgres for scratch databases")
    url = databases.build_with_alembic(_DATABASE)
    built = make_engine(sqlalchemy_url(url))
    try:
        with built.begin() as conn:
            _seed(conn)
        yield built
    finally:
        built.dispose()
        databases.drop(_DATABASE)


def _seed(conn: Connection) -> None:
    """Every club's kickoff, then each game's result and one player's line per club, dated as the
    store dates them; Monday night's DET holds its result but no line yet."""
    clubs = [(kickoff, team) for kickoff, teams in _GAMES for team in teams]
    conn.execute(insert(PLAYERS), [{"id": f"00-{team}", "name": team, "position": "WR"} for _, team in clubs])
    team_rows = [
        {
            "season": _SEASON,
            "week": _WEEK,
            "team": team,
            "source": "nflverse_kickoff",
            "metric": metric,
            "value": 1.0,
            "as_of": at,
        }
        for kickoff, team in clubs
        for metric, at in (("kickoff_instant", kickoff), ("game_result", _DATED[kickoff]))
    ]
    conn.execute(insert(TEAM_WEEK_OBSERVATIONS), team_rows)
    lined = [(kickoff, team) for kickoff, team in clubs if team != "DET"]
    conn.execute(
        insert(PLAYER_WEEK_TEAMS),
        [
            {"season": _SEASON, "week": _WEEK, "player_id": f"00-{team}", "team": team, "as_of": _DATED[kickoff]}
            for kickoff, team in clubs
        ],
    )
    conn.execute(
        insert(PLAYER_WEEK_OBSERVATIONS),
        [
            {
                "season": _SEASON,
                "week": _WEEK,
                "player_id": f"00-{team}",
                "source": "nflverse_player_week",
                "metric": "receptions",
                "value": 5.0,
                "as_of": _DATED[kickoff],
            }
            for kickoff, team in lined
        ],
    )


def test_thursday_nights_freeze_never_grades_on_its_one_played_game(engine: Engine) -> None:
    with engine.connect() as conn:
        friday = incomplete_clubs(conn, _SEASON, _WEEK, datetime(2026, 10, 24, 12, 0, tzinfo=UTC))
    assert friday == [
        "DAL no final and no stat lines",
        "DET no final and no stat lines",
        "PHI no final and no stat lines",
        "TB no final and no stat lines",
    ]


def test_a_club_with_its_result_and_no_lines_holds_the_week(engine: Engine) -> None:
    with engine.connect() as conn:
        before = incomplete_clubs(conn, _SEASON, _WEEK, _DATED[_MONDAY] - timedelta(minutes=1))
        tuesday = incomplete_clubs(conn, _SEASON, _WEEK, _TUESDAY_PASS)
    assert before == ["DET no final and no stat lines", "TB no final and no stat lines"]
    assert tuesday == ["DET no stat lines"]
