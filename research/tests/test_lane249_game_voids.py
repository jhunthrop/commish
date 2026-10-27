"""An operator voids one game so it never blocks its week (Lane 249, B255): a game cancelled but kept in
the game table with no result holds its week until voided, then the week grades with the voided game
named; a later lift holds it again; a void of a game not in the week is refused, writing nothing; and
the overdue line names the game and the command that voids it. Fix round 1 (the review's H1, M1, L1-L4): a
played game is never voided, a graded week takes no void or lift, a voided game's stale kickoff moves no
clock, a database error is one line, the hint quotes ops.yml, a moved game is checked again in its new week,
and a postseason or preseason id is refused. On fixed clocks, against Postgres."""

import os
import re
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from typing import Final, cast

import pytest
from sqlalchemy import Connection, Engine, func, insert, select, update
from sqlalchemy.exc import OperationalError

from research.db.engine import make_engine
from research.db.schema import (
    GAME_VOIDS,
    NFLVERSE_GAMES,
    PLAYER_WEEK_OBSERVATIONS,
    PLAYER_WEEK_TEAMS,
    PLAYERS,
    REGISTER_FREEZE_ROWS,
    REGISTER_GRADE_ROWS,
    TEAM_WEEK_OBSERVATIONS,
)
from research.db.url import sqlalchemy_url
from research.inseason import __main__ as inseason_main
from research.inseason import season_week
from research.inseason.game_voids import VoidError, VoidRequest, record_void, void_command, void_ops_command
from research.inseason.season_week import GRADE_OVERDUE, SeasonWeekContext
from research.inseason.step_result import StepResult
from research.inseason.week_complete import week_state
from research.model.register.freeze import SERVED_SOURCE
from research.parity import databases
from research.pipeline.http import Fetcher

_DATABASE: Final = "parity_test_lane249_voids"
_WEEK: Final = 17
_FROZEN_AT: Final = datetime(2026, 12, 31, 18, 0, tzinfo=UTC)
# Sunday: PIT at CLE is played; BUF at CIN, the Monday night game, is called off and never resumed.
_SUNDAY: Final = datetime(2027, 1, 3, 18, 0, tzinfo=UTC)
_MONDAY: Final = datetime(2027, 1, 4, 1, 30, tzinfo=UTC)
_RESULT_DATED: Final = datetime(2027, 1, 5, 0, 0, tzinfo=UTC)
_WEDNESDAY_PASS: Final = datetime(2027, 1, 6, 23, 0, tzinfo=UTC)
_VOIDED_AT: Final = datetime(2027, 1, 6, 20, 0, tzinfo=UTC)
_LIFTED_AT: Final = datetime(2027, 1, 6, 21, 0, tzinfo=UTC)
_PLAYED: Final = ("PIT", "CLE")
_CANCELLED: Final = ("BUF", "CIN")


def _game_id(season: int, away: str, home: str) -> str:
    return f"{season}_{_WEEK}_{away}_{home}"


def _pid(club: str) -> str:
    return f"00-{club}"


@pytest.fixture(scope="module")
def engine() -> Iterator[Engine]:
    if "PARITY_DATABASE_URL" not in os.environ:
        pytest.skip("needs a Postgres for scratch databases")
    url = databases.build_with_alembic(_DATABASE)
    built = make_engine(sqlalchemy_url(url))
    try:
        with built.begin() as conn:
            conn.execute(
                insert(PLAYERS), [{"id": _pid(c), "name": c, "position": "WR"} for c in (*_PLAYED, *_CANCELLED)]
            )
        yield built
    finally:
        built.dispose()
        databases.drop(_DATABASE)


def _seed(conn: Connection, season: int) -> None:
    """A season's week 17: two games on the table and a freeze of one receiver per club; PIT at CLE
    played whole, BUF at CIN with no result and no lines."""
    week = {"season": season, "week": _WEEK}
    games = ((_SUNDAY, *_PLAYED), (_MONDAY, *_CANCELLED))
    conn.execute(
        insert(NFLVERSE_GAMES),
        [
            {**week, "game_id": _game_id(season, away, home), "game_type": "REG", "gameday": kickoff.date(),
             "kickoff_at": kickoff, "home_team": home, "away_team": away, "location": "Home",
             "stadium_id": home, "stadium": home, "read_at": _FROZEN_AT}
            for kickoff, away, home in games
        ],
    )  # fmt: skip
    conn.execute(
        insert(REGISTER_FREEZE_ROWS),
        [
            {**week, "frozen_at": _FROZEN_AT, "board_source": SERVED_SOURCE, "player_id": _pid(club),
             "implementation": "python", "board_as_of": _FROZEN_AT, "board_points": 10.0 + place, "board_rank": place,
             "board_value_rank": place, "model_version": "m"}
            for place, club in enumerate((*_PLAYED, *_CANCELLED), start=1)
        ],
    )  # fmt: skip
    conn.execute(
        insert(TEAM_WEEK_OBSERVATIONS),
        [{**week, "team": club, "source": "nflverse_kickoff", "metric": "game_result", "value": 1.0,
          "as_of": _RESULT_DATED} for club in _PLAYED],
    )  # fmt: skip
    conn.execute(
        insert(PLAYER_WEEK_TEAMS),
        [{**week, "player_id": _pid(club), "team": club, "as_of": _RESULT_DATED} for club in _PLAYED],
    )
    conn.execute(
        insert(PLAYER_WEEK_OBSERVATIONS),
        [{**week, "player_id": _pid(club), "source": "nflverse_player_week", "metric": metric, "value": value,
          "as_of": _RESULT_DATED}
         for club in _PLAYED for metric, value in (("receptions", 5.0), ("receiving_yards", 60.0))],
    )  # fmt: skip


def _grade(engine: Engine, season: int, now: datetime) -> tuple[StepResult, int]:
    context = SeasonWeekContext(engine=engine, fetcher=cast(Fetcher, None), now=now, season=season, environ={})
    step = season_week.grade(context)
    with engine.connect() as conn:
        rows = conn.execute(select(func.count()).where(REGISTER_GRADE_ROWS.c.season == season)).scalar_one()
    return step, rows


def _request(season: int, *, week: int = _WEEK, game: str | None = None, lift: bool = False) -> VoidRequest:
    game_id = _game_id(season, *_CANCELLED) if game is None else game
    return VoidRequest(season, week, game_id, "called off, never resumed", "jh", lift)


def _void_rows(engine: Engine, season: int) -> int:
    with engine.connect() as conn:
        return conn.execute(select(func.count()).where(GAME_VOIDS.c.season == season)).scalar_one()


def test_a_cancelled_game_blocks_its_week_until_voided(engine: Engine) -> None:
    with engine.begin() as conn:
        _seed(conn, 2030)
    blocked, before = _grade(engine, 2030, _WEDNESDAY_PASS)
    with engine.begin() as conn:
        line = record_void(conn, _request(2030), _VOIDED_AT)
    graded, after = _grade(engine, 2030, _WEDNESDAY_PASS + timedelta(days=1))
    assert (blocked.status, before) == ("skipped", 0)
    assert blocked.detail == (
        "week 17: waits on 1 game of 2, BUF at CIN (BUF no final, BUF no stat lines, CIN no final, CIN no stat lines)",
    )
    assert line == (
        "void-game: voided 2030_17_BUF_CIN (BUF at CIN), season 2030 week 17, at 2027-01-06T20:00:00.000Z by jh: "
        "called off, never resumed"
    )
    # The grade's arithmetic is untouched: BUF's and CIN's receivers have no line and are not graded, as on a bye.
    assert (graded.status, after) == ("ok", 2)
    assert graded.detail == (f"week 17: graded {SERVED_SOURCE}=2; voided, not checked: BUF at CIN (2030_17_BUF_CIN)",)


def test_a_void_counts_only_from_its_instant(engine: Engine) -> None:
    with engine.begin() as conn:
        _seed(conn, 2031)
        record_void(conn, _request(2031), _VOIDED_AT)
    earlier, rows = _grade(engine, 2031, _VOIDED_AT - timedelta(minutes=1))
    assert (earlier.status, rows) == ("skipped", 0)


def test_a_lift_restores_the_block(engine: Engine) -> None:
    with engine.begin() as conn:
        _seed(conn, 2032)
        record_void(conn, _request(2032), _VOIDED_AT)
    with engine.begin() as conn:
        line = record_void(conn, _request(2032, lift=True), _LIFTED_AT)
    step, rows = _grade(engine, 2032, _WEDNESDAY_PASS)
    assert line.startswith("void-game: lifted the void of 2032_17_BUF_CIN (BUF at CIN), season 2032 week 17")
    assert (step.status, rows) == ("skipped", 0)
    assert step.detail[0].startswith("week 17: waits on 1 game of 2, BUF at CIN")
    # Both rows stand: the history is kept, the latest wins.
    assert _void_rows(engine, 2032) == len(("void", "lift"))


def test_a_void_of_a_game_not_in_the_week_is_refused(engine: Engine) -> None:
    with engine.begin() as conn:
        _seed(conn, 2033)
    refusals = (
        (_request(2033, week=_WEEK + 1), "2033_17_BUF_CIN is not a regular season game of season 2033 week 18"),
        (_request(2033, game="2033_17_NE_NYJ"), "2033_17_NE_NYJ is not a regular season game of season 2033 week 17"),
        (_request(2033, lift=True), "2033_17_BUF_CIN (BUF at CIN) has no void standing in season 2033 week 17"),
    )
    for request, words in refusals:
        with pytest.raises(VoidError, match=re.escape(words)), engine.begin() as conn:
            record_void(conn, request, _VOIDED_AT)
    assert _void_rows(engine, 2033) == 0
    with engine.begin() as conn:
        record_void(conn, _request(2033), _VOIDED_AT)
    with (
        pytest.raises(VoidError, match=re.escape("already voided, at 2027-01-06T20:00:00.000Z by jh")),
        engine.begin() as conn,
    ):
        record_void(conn, _request(2033), _LIFTED_AT)
    assert _void_rows(engine, 2033) == 1


def test_the_overdue_line_names_the_game_and_the_void_command(engine: Engine) -> None:
    with engine.begin() as conn:
        _seed(conn, 2034)
    step, _ = _grade(engine, 2034, _MONDAY + GRADE_OVERDUE)
    command = void_command(2034, _WEEK, "2034_17_BUF_CIN")
    assert command == (
        "python -m research.inseason void-game --season 2034 --week 17 --game 2034_17_BUF_CIN --reason <why> --by <who>"
    )
    assert step.status == "failed"
    assert step.detail == (
        "week 17: OVERDUE, waits on 1 game of 2, BUF at CIN (BUF no final, BUF no stat lines, CIN no final, "
        f"CIN no stat lines); if 2034_17_BUF_CIN was cancelled or dropped from games.csv, void it: {command} "
        f"(with gcloud lapsed: {void_ops_command(2034, _WEEK, '2034_17_BUF_CIN')})",
    )
    assert void_ops_command(2034, _WEEK, "2034_17_BUF_CIN") == (
        "gh workflow run ops.yml -f job=inseason -f args=research.inseason,void-game,--season,2034,--week,17,"
        "--game,2034_17_BUF_CIN,--reason,<why>,--by,<who>"
    )


def test_the_command_writes_the_void_and_refuses_with_its_own_line(
    engine: Engine, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    with engine.begin() as conn:
        _seed(conn, 2035)
    monkeypatch.setenv("RESEARCH_DATABASE_URL", engine.url.render_as_string(hide_password=False))
    monkeypatch.setattr(inseason_main, "now_ms", lambda: _VOIDED_AT)
    args = ["void-game", "--season", "2035", "--week", "17", "--game", "2035_17_BUF_CIN", "--reason", "called off"]
    assert inseason_main.main([*args, "--by", "jh"]) == 0
    assert inseason_main.main([*args, "--by", "jh"]) == 1
    printed = capsys.readouterr().out.splitlines()
    assert printed[0].endswith("void-game: voided 2035_17_BUF_CIN (BUF at CIN), season 2035 week 17, at "
                               "2027-01-06T20:00:00.000Z by jh: called off")  # fmt: skip
    assert "void-game: REFUSED, 2035_17_BUF_CIN (BUF at CIN) is already voided" in printed[1]
    assert _void_rows(engine, 2035) == 1


# Fix round 1.


def _add_game(conn: Connection, season: int, game_id: str, *, week: int = _WEEK, game_type: str = "REG") -> None:
    kickoff = _MONDAY + timedelta(hours=3)
    conn.execute(
        insert(NFLVERSE_GAMES),
        {"season": season, "week": week, "game_id": game_id, "game_type": game_type, "gameday": kickoff.date(),
         "kickoff_at": kickoff, "home_team": "NYJ", "away_team": "NE", "location": "Home", "stadium_id": "NYJ",
         "stadium": "NYJ", "read_at": _FROZEN_AT},
    )  # fmt: skip


def _move(conn: Connection, game_id: str, **values: object) -> None:
    """The game table's row as the next ingest's upsert leaves it."""
    conn.execute(update(NFLVERSE_GAMES).where(NFLVERSE_GAMES.c.game_id == game_id).values(**values))


def _refused(engine: Engine, request: VoidRequest, words: str, at: datetime = _VOIDED_AT) -> None:
    with pytest.raises(VoidError, match=re.escape(words)), engine.begin() as conn:
        record_void(conn, request, at)


def test_a_played_game_is_never_voided(engine: Engine) -> None:
    with engine.begin() as conn:
        _seed(conn, 2040)
    played = (
        "2040_17_PIT_CLE (PIT at CLE) was played (a score in nflverse_games or a club's final in the store): its "
        "late stat lines are an outage to wait out, not a cancellation; nothing written."
    )
    # PIT at CLE: both clubs hold their finals (no score on the table row).
    _refused(engine, _request(2040, game=_game_id(2040, *_PLAYED)), played)
    # BUF at CIN with a score on the table and no final in the store yet.
    with engine.begin() as conn:
        _move(conn, _game_id(2040, *_CANCELLED), home_score=20, away_score=17)
    _refused(engine, _request(2040), "2040_17_BUF_CIN (BUF at CIN) was played")
    assert _void_rows(engine, 2040) == 0


def test_a_final_stamped_after_the_void_still_means_played(engine: Engine) -> None:
    # Re-review N1: the operator voids Monday morning a game whose final is dated Monday night.
    with engine.begin() as conn:
        _seed(conn, 2046)
        conn.execute(
            insert(TEAM_WEEK_OBSERVATIONS),
            [{"season": 2046, "week": _WEEK, "team": club, "source": "nflverse_kickoff", "metric": "game_result",
              "value": 1.0, "as_of": _VOIDED_AT + timedelta(days=1)} for club in _CANCELLED],
        )  # fmt: skip
    _refused(engine, _request(2046), "2046_17_BUF_CIN (BUF at CIN) was played")
    assert _void_rows(engine, 2046) == 0


def test_a_graded_week_takes_no_void_and_no_lift(engine: Engine) -> None:
    with engine.begin() as conn:
        _seed(conn, 2041)
        record_void(conn, _request(2041), _VOIDED_AT)
    graded, _ = _grade(engine, 2041, _WEDNESDAY_PASS)
    with engine.begin() as conn:
        _add_game(conn, 2041, "2041_17_NE_NYJ")
    final = "season 2041 week 17 is graded and a grade is final, so the {} would change nothing; nothing written."
    _refused(engine, _request(2041, lift=True), final.format("lift"), _LIFTED_AT)
    _refused(engine, _request(2041, game="2041_17_NE_NYJ"), final.format("void"), _LIFTED_AT)
    assert graded.status == "ok"
    assert _void_rows(engine, 2041) == 1


def test_a_voided_games_stale_kickoff_moves_no_clock(engine: Engine) -> None:
    with engine.begin() as conn:
        _seed(conn, 2042)
        # The cancelled game's row keeps a placeholder kickoff weeks on.
        _move(conn, _game_id(2042, *_CANCELLED), kickoff_at=_MONDAY + timedelta(days=30))
        record_void(conn, _request(2042), _VOIDED_AT)
    with engine.connect() as conn:
        state = week_state(conn, 2042, _WEEK, _WEDNESDAY_PASS)
    step, rows = _grade(engine, 2042, _WEDNESDAY_PASS)
    assert state is not None
    assert state.last_kickoff == _SUNDAY
    assert (step.status, rows) == ("ok", 2)


def test_a_game_moved_to_another_week_is_checked_again_there(engine: Engine) -> None:
    game_id = _game_id(2043, *_CANCELLED)
    with engine.begin() as conn:
        _seed(conn, 2043)
        record_void(conn, _request(2043), _VOIDED_AT)
        _move(conn, game_id, week=_WEEK + 1)
    with engine.connect() as conn:
        moved = week_state(conn, 2043, _WEEK + 1, _WEDNESDAY_PASS)
    assert moved is not None
    assert (moved.incomplete[0].startswith("BUF at CIN ("), moved.voided, moved.unresulted) == (True, (), (game_id,))
    _refused(engine, _request(2043, week=_WEEK + 1, lift=True), f"{game_id} (BUF at CIN) has no void standing in "
             "season 2043 week 18; nothing written.", _LIFTED_AT)  # fmt: skip
    assert _void_rows(engine, 2043) == 1


def test_a_postseason_or_preseason_id_is_refused(engine: Engine) -> None:
    with engine.begin() as conn:
        _add_game(conn, 2044, "2044_19_NE_NYJ", week=19, game_type="POST")
        _add_game(conn, 2044, "2044_02_NE_NYJ", week=2, game_type="PRE")
    for game_id, week in (("2044_19_NE_NYJ", 19), ("2044_02_NE_NYJ", 2)):
        words = f"{game_id} is not a regular season game of season 2044 week {week} in nflverse_games; nothing written."
        _refused(engine, _request(2044, week=week, game=game_id), words)
    assert _void_rows(engine, 2044) == 0


def test_a_database_error_is_one_refused_line(
    engine: Engine, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    def lost(conn: Connection, request: VoidRequest, now: datetime) -> str:
        raise OperationalError("insert into research.game_voids", {}, Exception("server closed the connection"))

    monkeypatch.setenv("RESEARCH_DATABASE_URL", engine.url.render_as_string(hide_password=False))
    monkeypatch.setattr(inseason_main, "now_ms", lambda: _VOIDED_AT)
    monkeypatch.setattr(inseason_main, "record_void", lost)
    args = ["void-game", "--season", "2045", "--week", "17", "--game", "x", "--reason", "r", "--by", "jh"]
    assert inseason_main.main(args) == 1
    out, err = capsys.readouterr()
    assert out.splitlines()[-1].endswith("void-game: REFUSED, the database answered OperationalError; nothing written.")
    assert "Traceback" not in out + err
