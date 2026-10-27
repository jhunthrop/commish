"""A week grades once every game's stats are in (Lane 244), not on a thirty-six hour timer: the grade
step reads the week's games from the game table and checks both clubs of each against the rows the
grade reads, holds a floor after the last kickoff, still fails four days on, never grades Thursday
night's freeze on its one played game, and the record names the first pass that can grade."""

import os
import re
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any, Final, cast

import pytest
from sqlalchemy import Connection, Engine, func, insert, select

from research.db.engine import make_engine
from research.db.schema import (
    NFLVERSE_GAMES,
    PLAYER_WEEK_OBSERVATIONS,
    PLAYER_WEEK_TEAMS,
    PLAYERS,
    REGISTER_FREEZE_ROWS,
    REGISTER_GRADE_ROWS,
    TEAM_WEEK_OBSERVATIONS,
)
from research.db.url import sqlalchemy_url
from research.inseason import season_week
from research.inseason.season_week import GRADE_OVERDUE, SeasonWeekContext
from research.inseason.step_result import StepResult
from research.inseason.week_complete import (
    GRADE_FLOOR,
    GRADING_PASSES,
    PassSlot,
    WeekState,
    earliest_grade,
    grades_from,
    is_complete,
)
from research.model.register.freeze import SERVED_SOURCE
from research.parity import databases
from research.pipeline.http import Fetcher

_DATABASE: Final = "parity_test_lane244_completeness"
_SCHEDULE: Final = Path(__file__).resolve().parents[2] / "infra" / "research-schedule.sh"
_WEEK: Final = 7
# Week 7 of 2026: Thursday night, a Sunday afternoon and Monday night, away club first.
_THURSDAY: Final = datetime(2026, 10, 23, 0, 15, tzinfo=UTC)
_SUNDAY: Final = datetime(2026, 10, 25, 17, 0, tzinfo=UTC)
_MONDAY: Final = datetime(2026, 10, 27, 0, 15, tzinfo=UTC)
_GAMES: Final = ((_THURSDAY, "PIT", "CLE"), (_SUNDAY, "DAL", "PHI"), (_MONDAY, "DET", "TB"))
# Each game's result is dated the end of its Eastern day plus a day (`kickoff_as_of`); the week's lines
# are dated from its last game (`ingest._week_as_of`), Monday night's: Tuesday 20:00 Eastern.
_RESULT_DATED: Final = {
    _THURSDAY: datetime(2026, 10, 24, 0, 0, tzinfo=UTC),
    _SUNDAY: datetime(2026, 10, 27, 0, 0, tzinfo=UTC),
    _MONDAY: datetime(2026, 10, 28, 0, 0, tzinfo=UTC),
}
_WEEK_LINES_DATED: Final = _RESULT_DATED[_MONDAY]
_FROZEN_AT: Final = datetime(2026, 10, 22, 18, 0, tzinfo=UTC)
# The passes: Tuesday 08:00 and 20:30 Eastern.
_TUESDAY_MORNING: Final = datetime(2026, 10, 27, 12, 0, tzinfo=UTC)
_TUESDAY_EVENING: Final = datetime(2026, 10, 28, 0, 30, tzinfo=UTC)


class _FakeEngine:
    @contextmanager
    def connect(self) -> Iterator[Connection]:
        yield cast(Connection, None)

    @contextmanager
    def begin(self) -> Iterator[Connection]:
        yield cast(Connection, None)


def _context(engine: Engine, season: int, now: datetime) -> SeasonWeekContext:
    return SeasonWeekContext(engine=engine, fetcher=cast(Fetcher, None), now=now, season=season, environ={})


# The schedule and the day the record names.


def _schedule_slots() -> set[PassSlot]:
    """Each `research-season-week-*` job's cron as a pass slot, read from the schedule file."""
    entry = re.compile(r'^\s*"research-season-week-[a-z-]+\|(\d+) (\d+) \* [0-9,-]+ (\d)\|America/New_York\|')
    lines = _SCHEDULE.read_text().splitlines()
    return {PassSlot(int(m[3]), int(m[2]), int(m[1])) for line in lines if (m := entry.match(line))}


def test_the_grading_passes_are_the_schedules_weekly_passes() -> None:
    assert _schedule_slots() == set(GRADING_PASSES)


def test_the_earliest_grade_is_when_the_last_games_lines_are_dated() -> None:
    assert [earliest_grade(kickoff) for kickoff in (_THURSDAY, _SUNDAY, _MONDAY)] == list(_RESULT_DATED.values())


def test_the_record_names_the_first_pass_that_can_grade() -> None:
    assert grades_from(_MONDAY) == _TUESDAY_EVENING  # Tuesday 20:30 Eastern
    # A Sunday-ending week (week 18, Sunday night): its lines are dated Monday 19:00 Eastern, and no pass
    # runs on a Monday, so it names Tuesday 08:00 Eastern.
    sunday_night = datetime(2027, 1, 4, 1, 20, tzinfo=UTC)
    assert earliest_grade(sunday_night) == datetime(2027, 1, 5, 0, 0, tzinfo=UTC)
    assert grades_from(sunday_night) == datetime(2027, 1, 5, 13, 0, tzinfo=UTC)


# The grade step's waits with the week's state stood in.


def _step(monkeypatch: pytest.MonkeyPatch, now: datetime, state: WeekState) -> StepResult:
    monkeypatch.setattr(season_week, "_frozen_and_graded", lambda conn, season: ([_WEEK], set()))
    monkeypatch.setattr(season_week, "week_state", lambda conn, season, week, at: state)
    return season_week.grade(_context(cast(Engine, _FakeEngine()), 2026, now))


def test_the_floor_holds_even_with_the_week_complete(monkeypatch: pytest.MonkeyPatch) -> None:
    step = _step(monkeypatch, _MONDAY + timedelta(hours=2), WeekState(_MONDAY, 3, ()))
    assert step.status == "skipped"
    assert step.detail == (f"week 7: waits, its last kickoff 2026-10-27T00:15:00.000Z is under {GRADE_FLOOR} ago",)


def test_an_incomplete_week_is_overdue_four_days_on(monkeypatch: pytest.MonkeyPatch) -> None:
    state = WeekState(_MONDAY, 3, ("DET at TB (TB no final)",))
    early = _step(monkeypatch, _MONDAY + GRADE_OVERDUE - timedelta(minutes=1), state)
    late = _step(monkeypatch, _MONDAY + GRADE_OVERDUE, state)
    assert early.status == "skipped"
    assert (late.status, late.detail) == ("failed", ("week 7: OVERDUE, waits on 1 game of 3, DET at TB (TB no final)",))


# One rule (Lane 250, review M1 and L4): `is_complete` is the grade's decision and the draft record's.

_INCOMPLETE: Final = WeekState(_MONDAY, 3, ("DET at TB (TB no final)",))
_WHOLE: Final = WeekState(_MONDAY, 3, ())
_FLOOR_MINUS: Final = _MONDAY + GRADE_FLOOR - timedelta(minutes=1)
_FLOOR: Final = _MONDAY + GRADE_FLOOR
# Each state and clock, and whether the week is complete then.
_GRID: Final = (
    (None, _FLOOR, False),
    (_INCOMPLETE, _FLOOR, False),
    (_INCOMPLETE, _MONDAY + timedelta(days=2), False),
    (_WHOLE, _MONDAY, False),
    (_WHOLE, _FLOOR_MINUS, False),
    (_WHOLE, _FLOOR, True),
    (_WHOLE, _MONDAY + timedelta(days=2), True),
    (WeekState(_MONDAY, 3, (), voided=("DET at TB (2026_07_DET_TB)",)), _FLOOR, True),
)


@pytest.mark.parametrize(("state", "now", "complete"), _GRID)
def test_is_complete_holds_the_six_hour_floor_and_every_game(
    state: WeekState | None, now: datetime, complete: bool
) -> None:
    assert is_complete(state, now) is complete


class _Graded:
    boards = ()
    skipped = ()


@pytest.mark.parametrize(("state", "now", "complete"), [g for g in _GRID if g[0] is not None])
def test_the_grade_grades_exactly_the_weeks_the_draft_record_counts(
    monkeypatch: pytest.MonkeyPatch, state: WeekState, now: datetime, complete: bool
) -> None:
    graded: list[int] = []

    def grade_week(conn: Connection, season: int, week: int, at: datetime) -> _Graded:
        graded.append(week)
        return _Graded()

    monkeypatch.setattr(season_week, "grade_week", grade_week)
    _step(monkeypatch, now, state)
    assert (graded == [_WEEK]) is complete


# End to end: the store as the ingest dates it, the check and the grade read for real.


@pytest.fixture(scope="module")
def engine() -> Iterator[Engine]:
    if "PARITY_DATABASE_URL" not in os.environ:
        pytest.skip("needs a Postgres for scratch databases")
    url = databases.build_with_alembic(_DATABASE)
    built = make_engine(sqlalchemy_url(url))
    try:
        with built.begin() as conn:
            conn.execute(insert(PLAYERS), [{"id": _pid(c), "name": c, "position": "WR"} for c in _clubs()])
        yield built
    finally:
        built.dispose()
        databases.drop(_DATABASE)


def _clubs() -> list[str]:
    return [club for _, away, home in _GAMES for club in (away, home)]


def _pid(club: str) -> str:
    return f"00-{club}"


def _seed(conn: Connection, season: int, played: tuple[datetime, ...], lines_dated: datetime, held: set[str]) -> None:
    """A season's week 7: the game table's three games and the freeze; for each game in `played`, both
    clubs' results (dated per game) and edges, and for each club in `held` its receiver's line dated
    `lines_dated`. A played club not in `held` keeps only zero-usage participation rows, as the
    ingest writes them from snap counts when the weekly file lacks its game."""
    week = {"season": season, "week": _WEEK}
    conn.execute(
        insert(NFLVERSE_GAMES),
        [
            {**week, "game_id": f"{season}_07_{away}_{home}", "game_type": "REG", "gameday": kickoff.date(),
             "kickoff_at": kickoff, "home_team": home, "away_team": away, "location": "Home",
             "stadium_id": home, "stadium": home, "read_at": _FROZEN_AT}
            for kickoff, away, home in _GAMES
        ],
    )  # fmt: skip
    conn.execute(
        insert(REGISTER_FREEZE_ROWS),
        [
            {**week, "frozen_at": _FROZEN_AT, "board_source": SERVED_SOURCE, "player_id": _pid(club),
             "implementation": "python", "board_as_of": _FROZEN_AT, "board_points": 10.0 + place, "board_rank": place,
             "board_value_rank": place, "model_version": "m"}
            for place, club in enumerate(_clubs(), start=1)
        ],
    )  # fmt: skip
    clubs = [(kickoff, club) for kickoff, away, home in _GAMES if kickoff in played for club in (away, home)]
    if not clubs:
        return
    conn.execute(
        insert(TEAM_WEEK_OBSERVATIONS),
        [{**week, "team": club, "source": "nflverse_kickoff", "metric": "game_result", "value": 1.0,
          "as_of": _RESULT_DATED[kickoff]} for kickoff, club in clubs],
    )  # fmt: skip
    conn.execute(
        insert(PLAYER_WEEK_TEAMS),
        [{**week, "player_id": _pid(club), "team": club, "as_of": _RESULT_DATED[kickoff]} for kickoff, club in clubs],
    )
    observations: list[dict[str, Any]] = [
        {**week, "player_id": _pid(club), "source": "nflverse_player_week", "metric": metric, "value": value,
         "as_of": lines_dated}
        for _, club in clubs
        for metric, value in (
            (("receptions", 5.0), ("receiving_yards", 60.0), ("targets", 7.0))
            if club in held
            else (("targets", 0.0), ("carries", 0.0), ("pass_attempts", 0.0))
        )
    ]  # fmt: skip
    conn.execute(insert(PLAYER_WEEK_OBSERVATIONS), observations)


def _grade(engine: Engine, season: int, now: datetime) -> tuple[StepResult, int]:
    step = season_week.grade(_context(engine, season, now))
    with engine.connect() as conn:
        rows = conn.execute(select(func.count()).where(REGISTER_GRADE_ROWS.c.season == season)).scalar_one()
    return step, rows


def test_a_complete_week_grades_on_the_tuesday_evening_pass(engine: Engine) -> None:
    with engine.begin() as conn:
        _seed(conn, 2026, tuple(_RESULT_DATED), _WEEK_LINES_DATED, set(_clubs()))
    morning, before = _grade(engine, 2026, _TUESDAY_MORNING)
    evening, after = _grade(engine, 2026, _TUESDAY_EVENING)
    # Tuesday morning: the results of Thursday and Sunday are in, but the week's lines are dated from
    # Monday night's game, Tuesday 20:00 Eastern, so every game waits.
    assert (morning.status, before) == ("skipped", 0)
    assert morning.detail == (
        "week 7: waits on 3 games of 3, PIT at CLE (PIT no stat lines, CLE no stat lines); "
        "DAL at PHI (DAL no stat lines, PHI no stat lines); "
        "DET at TB (DET result dated 2026-10-28T00:00:00.000Z, DET no stat lines, "
        "TB result dated 2026-10-28T00:00:00.000Z, TB no stat lines)",
    )
    assert (evening.status, evening.detail, after) == ("ok", (f"week 7: graded {SERVED_SOURCE}=6",), 6)


def test_a_club_with_only_participation_rows_holds_the_week(engine: Engine) -> None:
    with engine.begin() as conn:
        _seed(conn, 2027, tuple(_RESULT_DATED), _WEEK_LINES_DATED, set(_clubs()) - {"DET"})
    step, rows = _grade(engine, 2027, _TUESDAY_EVENING)
    overdue, _ = _grade(engine, 2027, _MONDAY + GRADE_OVERDUE)
    assert (step.status, step.detail, rows) == (
        "skipped",
        ("week 7: waits on 1 game of 3, DET at TB (DET no stat lines)",),
        0,
    )
    assert (overdue.status, overdue.detail[0].startswith("week 7: OVERDUE, waits on 1 game of 3")) == ("failed", True)


def test_thursday_nights_freeze_never_grades_on_its_one_played_game(engine: Engine) -> None:
    # Saturday's store: Thursday's game ingested whole, its lines dated from it; nothing else played.
    with engine.begin() as conn:
        _seed(conn, 2028, (_THURSDAY,), _RESULT_DATED[_THURSDAY], {"PIT", "CLE"})
    step, rows = _grade(engine, 2028, datetime(2026, 10, 24, 12, 0, tzinfo=UTC))
    assert (step.status, rows) == ("skipped", 0)
    assert step.detail == (
        "week 7: waits on 2 games of 3, DAL at PHI (DAL no final, DAL no stat lines, PHI no final, PHI no stat lines); "
        "DET at TB (DET no final, DET no stat lines, TB no final, TB no stat lines)",
    )


def test_a_week_with_no_games_on_file_waits_then_is_overdue(engine: Engine) -> None:
    with engine.begin() as conn:
        conn.execute(
            insert(REGISTER_FREEZE_ROWS),
            {"season": 2029, "week": _WEEK, "frozen_at": _FROZEN_AT, "board_source": SERVED_SOURCE,
             "player_id": _pid("PIT"), "implementation": "python", "board_as_of": _FROZEN_AT, "board_points": 1.0,
             "board_rank": 1, "board_value_rank": 1, "model_version": "m"},
        )  # fmt: skip
    waits, _ = _grade(engine, 2029, _FROZEN_AT + timedelta(days=1))
    overdue, _ = _grade(engine, 2029, _FROZEN_AT + GRADE_OVERDUE)
    assert (waits.status, waits.detail) == ("skipped", ("week 7: waits, no games on file",))
    assert (overdue.status, overdue.detail) == ("failed", ("week 7: OVERDUE, waits, no games on file",))


def test_the_grade_stands_down_when_the_game_table_failed_on_the_pass(monkeypatch: pytest.MonkeyPatch) -> None:
    graded: list[datetime] = []

    def failed_read(context: SeasonWeekContext) -> StepResult:
        raise RuntimeError("games.csv answered 503")

    def grade(context: SeasonWeekContext) -> StepResult:
        graded.append(context.now)
        return StepResult(season_week.GRADE, "ok", "graded")

    monkeypatch.setattr(season_week, "game_table", failed_read)
    monkeypatch.setattr(season_week, "grade", grade)
    only = frozenset(season_week.STEPS) - {season_week.GAME_TABLE, season_week.GRADE}
    context = SeasonWeekContext(
        engine=cast(Engine, _FakeEngine()), fetcher=cast(Fetcher, None), now=_TUESDAY_EVENING, season=2026,
        environ={}, skip=only,
    )  # fmt: skip
    results = {result.step: result for result in season_week.run_season_week(context)}
    assert results[season_week.GAME_TABLE].status == "failed"
    assert (results[season_week.GRADE].status, results[season_week.GRADE].summary) == (
        "skipped",
        "not graded: the game-table step failed on this pass, so the week's games could be stale",
    )
    assert graded == []
    monkeypatch.setattr(season_week, "game_table", lambda context: StepResult(season_week.GAME_TABLE, "ok", "0 games"))
    season_week.run_season_week(context)
    assert graded == [_TUESDAY_EVENING]
