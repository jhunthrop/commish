# ruff: noqa: PLR2004 - the expected values are hand-built fixtures, each read beside its case
"""The in-season boards on a small hand-built fixture (no store): the switch week, the fallbacks and
their reasons, the rows' shape; and the one-shot fit's refusal with its reads stubbed."""

import json
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from pathlib import Path
from types import TracebackType
from typing import Any

import pytest

from research.errors import ConfigurationError
from research.model.domain import Position
from research.model.ros import ship
from research.model.ros.__main__ import JUDGMENT_RECORDS
from research.model.ros.judge import RoundFit
from research.model.ros.live import FIRST_MODEL_WEEK, SeasonPlayer
from research.model.ros.model import LAST_FANTASY_WEEK
from research.model.ros.payload import ARTIFACT_NAME, priors_from
from research.model.ros.raw_line import RawLine
from research.model.ros.ship import SHIPPED_ROUND, fit_and_publish
from research.nightly.build.player_season import SeasonContext, SeasonStore
from research.nightly.build.ros import RosSetup, ros_boards
from research.nightly.config import RUN_FORMATS
from research.nightly.reads.board import FormatBoard, StoredBoard, StoredRow, board_entries
from research.nightly.reads.schedule import ClubWeek, Game, GameState, game_states
from research.season import REGULAR_SEASON_WEEKS

_RECORD = JUDGMENT_RECORDS[SHIPPED_ROUND]
_JUDGED: dict[str, Any] = json.loads(_RECORD.read_text())["priors"]
PRIORS = priors_from(_JUDGED)
PPR, HALF, STD = RUN_FORMATS[0], RUN_FORMATS[1], RUN_FORMATS[2]
CLUBS = ("KC", "BUF")
# A pair whose games are the Monday night after (Lane 86): their week still to play on the Sunday evening.
MONDAY_CLUBS = ("MIA", "NYJ")
KICKOFF = datetime(2026, 9, 10, 17, tzinfo=UTC)


def _schedule() -> dict[str, tuple[Game, ...]]:
    """Two clubs playing each other every week, Thursday-to-Sunday style, weeks 1 to 18, and two more
    playing each other a day after each of those games."""
    return {
        club: tuple(
            Game(week, pair[1 - i], i == 0, KICKOFF + timedelta(weeks=week - 1, days=late)) for week in range(1, 19)
        )
        for late, pair in enumerate((CLUBS, MONDAY_CLUBS))
        for i, club in enumerate(pair)
    }


def _states(instant: datetime) -> dict[ClubWeek, GameState]:
    """Every game's state at the instant, no final held (the run's rule)."""
    return game_states(_schedule(), frozenset(), instant)


def _line(points: float) -> dict[str, float]:
    return {"receptions": points / 4, "receiving_yards": points * 5, "targets": points / 2}


def _context(through: int) -> SeasonContext:
    lines = {
        "p1": {w: _line(20.0) for w in range(1, through + 1)},
        "p2": {w: _line(8.0) for w in range(1, through + 1)},
        "p3": {w: _line(14.0) for w in range(1, through + 1)},
        "p9": {w: _line(16.0) for w in range(1, through + 1)},  # off the preseason boards
    }
    snaps = {
        pid: {w: {"offensive_snaps": 40.0, "team_offensive_snaps": 60.0} for w in weeks} for pid, weeks in lines.items()
    }
    teams = {pid: dict.fromkeys(weeks, "KC") for pid, weeks in lines.items()}
    store = SeasonStore(lines, snaps, teams, {}, frozenset())
    return SeasonContext(2026, 18, through, _schedule(), dict.fromkeys((*CLUBS, *MONDAY_CLUBS)), store, {})


def _row(pid: str, projected: float, position: Position = "WR") -> StoredRow:
    return StoredRow(
        universe_id=f"u-{pid}", player_id=pid, name=pid.upper(), position=position, team="KC",
        headshot_url=None, market_adp=None, projected=projected, floor=projected * 0.6,
        median=projected, ceiling=projected * 1.4, expected_games=15.0,
    )  # fmt: skip


def _board(run_format: Any, rows: list[StoredRow]) -> FormatBoard:
    stored = StoredBoard(run_format.board_source, KICKOFF, "research@test", None)
    return FormatBoard(run_format, stored, board_entries(rows, run_format))


def _boards(half_extra: bool = False) -> tuple[FormatBoard, ...]:
    rows = [_row("p1", 250.0), _row("p2", 200.0), _row("p3", 150.0)]
    half_rows = [*rows, _row("p7", 90.0)] if half_extra else rows
    return (_board(PPR, rows), _board(HALF, half_rows), _board(STD, rows))


def _raw(scorings: tuple[str, ...] = ("ppr", "half", "std")) -> RawLine:
    per_game = {f"u-{pid}": dict.fromkeys(scorings, value) for pid, value in (("p1", 16.0), ("p2", 13.0), ("p3", 10.0))}
    return RawLine(2026, "2026-09-09T02:20:29.697Z", "research@test", per_game)


OFF = SeasonPlayer("u-p9", "p9", "P9", "WR", "KC", None, None)
SETUP = RosSetup(PRIORS, _raw(), (OFF,))
LINES_THROUGH = FIRST_MODEL_WEEK - 1  # the last week played when the first model week is still to play
FIRST_WEEK_INSTANT = (
    KICKOFF + timedelta(weeks=LINES_THROUGH) - timedelta(hours=1)
)  # before the first model week's games
LAST_PRESEASON_INSTANT = KICKOFF + timedelta(weeks=LINES_THROUGH - 1) - timedelta(hours=1)


def test_before_the_switch_week_every_board_stays_preseason() -> None:
    boards = _boards()
    result = ros_boards(
        boards, _context(LINES_THROUGH - 1), LAST_PRESEASON_INSTANT, _states(LAST_PRESEASON_INSTANT), SETUP
    )
    assert result.boards == boards
    assert result.status == f"preseason: week {FIRST_MODEL_WEEK - 1} is before the switch week ({FIRST_MODEL_WEEK})"


def test_from_the_first_model_week_every_board_ranks_the_rest_of_the_season() -> None:
    result = ros_boards(_boards(), _context(LINES_THROUGH), FIRST_WEEK_INSTANT, _states(FIRST_WEEK_INSTANT), SETUP)
    assert result.basis is not None
    assert (result.basis.from_week, result.basis.through) == (FIRST_MODEL_WEEK, LINES_THROUGH)
    assert result.in_season == {"ppr-12", "half-ppr-12", "standard-12"}
    for board in result.boards:
        assert {e.row.player_id for e in board.entries} == {"p1", "p2", "p3", "p9"}
        assert all(e.row.floor is None and e.row.ceiling is None and e.in_season for e in board.entries)
        off = next(e for e in board.entries if e.row.player_id == "p9")
        assert off.preseason is None
        on = next(e for e in board.entries if e.row.player_id == "p3")
        assert on.preseason is not None
        assert on.preseason.row.projected == 150.0
    assert "1 players off the preseason board ranked" in result.status


@pytest.mark.parametrize(
    ("setup", "reason"),
    [
        (replace(SETUP, priors=None), "preseason: the rest-of-season artifact is not in the store"),
        (replace(SETUP, raw=None), "preseason: the raw line for the season's raw board is not in the store"),
        (replace(SETUP, priors=None, unread="OperationalError: gone"), "preseason: the model's inputs could not be read (OperationalError: gone)"),
    ],
)  # fmt: skip
def test_a_missing_or_unread_input_keeps_every_board_preseason_and_says_which(setup: RosSetup, reason: str) -> None:
    boards = _boards()
    result = ros_boards(boards, _context(LINES_THROUGH), FIRST_WEEK_INSTANT, _states(FIRST_WEEK_INSTANT), setup)
    assert (result.boards, result.basis, result.status) == (boards, None, reason)


def test_a_week_18_run_ranks_week_18_alone() -> None:
    """Lane 96 (review H1): once week 17 is over the board ranks the week left, one club game at each
    player's rate, never the preseason order, and his points for it are his one more game's."""
    boards = _boards()
    instant = KICKOFF + timedelta(weeks=17) - timedelta(hours=1)
    result = ros_boards(boards, _context(17), instant, _states(instant), SETUP)
    assert result.basis is not None and result.basis.from_week == REGULAR_SEASON_WEEKS
    for board in result.boards:
        for entry in board.entries:
            row = entry.row
            assert row.from_week == REGULAR_SEASON_WEEKS
            assert 0 < row.expected_games <= 1 and row.projected > 0
            assert row.game_points is not None and row.game_points > 0


def test_every_row_carries_its_points_for_one_more_game() -> None:
    """Before week 18, each in-season row carries his points for one more club game after week 17, his
    rate a game times his play rate (Lane 96): what a league whose title week is 18 values that week at."""
    result = ros_boards(_boards(), _context(LINES_THROUGH), FIRST_WEEK_INSTANT, _states(FIRST_WEEK_INSTANT), SETUP)
    assert result.basis is not None
    games = LAST_FANTASY_WEEK - result.basis.from_week + 1
    for board in result.boards:
        for entry in board.entries:
            row = entry.row
            # No missed run: each counted game is worth what one more is, so the total is that times them.
            assert row.game_points == pytest.approx(row.projected / games)


def test_each_row_carries_the_preseason_pace_the_model_starts_him_from() -> None:
    """Lane 100 (B17, B51): the raw line's points a game in the board's scoring, the prior the model
    weighs his games against; none for a player off the preseason line."""
    result = ros_boards(_boards(), _context(LINES_THROUGH), FIRST_WEEK_INSTANT, _states(FIRST_WEEK_INSTANT), SETUP)
    for board in result.boards:
        paces = {e.row.player_id: e.row.preseason_per_game for e in board.entries}
        assert paces == {"p1": 16.0, "p2": 13.0, "p3": 10.0, "p9": None}


def test_a_raw_line_without_a_scoring_keeps_that_format_preseason_alone() -> None:
    boards = _boards()
    result = ros_boards(
        boards,
        _context(LINES_THROUGH),
        FIRST_WEEK_INSTANT,
        _states(FIRST_WEEK_INSTANT),
        replace(SETUP, raw=_raw(("ppr", "half"))),
    )
    assert result.in_season == {"ppr-12", "half-ppr-12"}
    assert result.boards[2] == boards[2]
    assert "preseason for standard-12: the raw line holds no std points" in result.status


def test_a_player_the_ppr_board_lacks_keeps_that_format_preseason_alone() -> None:
    boards = _boards(half_extra=True)
    result = ros_boards(boards, _context(LINES_THROUGH), FIRST_WEEK_INSTANT, _states(FIRST_WEEK_INSTANT), SETUP)
    assert result.in_season == {"ppr-12", "standard-12"}
    assert result.boards[1] == boards[1]
    assert "preseason for half-ppr-12: it ranks 1 players the PPR board does not" in result.status


def test_a_player_off_the_ppr_board_with_a_line_is_ranked_once_on_a_board_that_has_him() -> None:
    """The reviewer's case: p7 on the half board, not on PPR, with a line this season."""
    boards = _boards(half_extra=True)
    context = _context(LINES_THROUGH)
    lines = {**context.store.lines, "p7": {w: _line(12.0) for w in range(1, LINES_THROUGH + 1)}}
    snaps = {
        **context.store.snaps,
        "p7": {w: {"offensive_snaps": 30.0, "team_offensive_snaps": 60.0} for w in range(1, LINES_THROUGH + 1)},
    }
    teams = {**context.store.teams, "p7": dict.fromkeys(range(1, LINES_THROUGH + 1), "KC")}
    context = replace(context, store=replace(context.store, lines=lines, snaps=snaps, teams=teams))
    p7 = SeasonPlayer("u-p7", "p7", "P7", "WR", "KC", None, None)
    result = ros_boards(
        boards, context, FIRST_WEEK_INSTANT, _states(FIRST_WEEK_INSTANT), replace(SETUP, season_players=(OFF, p7))
    )
    assert result.in_season == {"ppr-12", "half-ppr-12", "standard-12"}
    for board in result.boards:
        ids = [e.row.player_id for e in board.entries]
        assert len(ids) == len(set(ids)), ids
    half = result.boards[1]
    assert sorted(e.row.player_id for e in half.entries) == ["p1", "p2", "p3", "p7", "p9"]
    seven = next(e for e in half.entries if e.row.player_id == "p7")
    assert seven.preseason is not None  # the half board ranked him preseason: his entry is kept


def test_a_club_whose_week_kicked_off_counts_from_its_next_week_while_the_board_starts_at_the_first_left() -> None:
    """Lane 86 (the sweep's Z3): on the Sunday evening KC's week 6 game is played and MIA's is Monday
    night's. The board still starts at week 6 (a game of it is to play), but a KC player's rest of
    season starts at week 7 and counts the 11 games from there, not the 12 from week 6."""
    sunday_evening = KICKOFF + timedelta(weeks=LINES_THROUGH, hours=3)
    before = ros_boards(_boards(), _context(LINES_THROUGH), FIRST_WEEK_INSTANT, _states(FIRST_WEEK_INSTANT), SETUP)
    after = ros_boards(_boards(), _context(LINES_THROUGH), sunday_evening, _states(sunday_evening), SETUP)
    assert before.basis is not None and after.basis is not None
    assert (before.basis.from_week, after.basis.from_week) == (FIRST_MODEL_WEEK, FIRST_MODEL_WEEK)
    # A game of week 6 is played: the board's words say it counts that week's games left.
    assert (before.basis.partial, after.basis.partial) == (False, True)
    for board_before, board_after in zip(before.boards, after.boards, strict=True):
        was = {e.row.player_id: e.row for e in board_before.entries}
        for entry in board_after.entries:
            row, prior = entry.row, was[entry.row.player_id]
            assert (prior.from_week, row.from_week) == (FIRST_MODEL_WEEK, FIRST_MODEL_WEEK + 1)
            assert row.expected_games == pytest.approx(prior.expected_games * 11 / 12)
            assert row.projected < prior.projected


def test_a_club_with_no_game_left_writes_no_start_week() -> None:
    """Review M2: on the Sunday evening of week 17, the last week the model ranks, KC's game is played
    and MIA's is Monday night's. The board is in season from week 17's games left; a KC row has no game
    left, so it starts from no week and expects no game."""
    sunday_evening = KICKOFF + timedelta(weeks=16, hours=3)
    result = ros_boards(_boards(), _context(16), sunday_evening, _states(sunday_evening), SETUP)
    assert result.basis is not None
    assert (result.basis.from_week, result.basis.partial) == (17, True)
    for board in result.boards:
        for entry in board.entries:
            assert entry.row.team == "KC"
            assert entry.row.from_week is None
            assert entry.row.expected_games == 0


def test_a_preseason_row_says_no_start_week() -> None:
    boards = _boards()
    result = ros_boards(
        boards, _context(LINES_THROUGH - 1), LAST_PRESEASON_INSTANT, _states(LAST_PRESEASON_INSTANT), SETUP
    )
    assert all(e.row.from_week is None for b in result.boards for e in b.entries)


# --- the one-shot fit, its reads stubbed ---------------------------------------------------------


class _Conn:
    def execute(self, *_: object) -> None:
        return None


class _Context:
    def __enter__(self) -> _Conn:
        return _Conn()

    def __exit__(self, *_: type[BaseException] | BaseException | TracebackType | None) -> None:
        return None


class _Engine:
    def connect(self) -> _Context:
        return _Context()

    def begin(self) -> _Context:
        return _Context()

    def dispose(self) -> None:
        return None


def _stub(monkeypatch: pytest.MonkeyPatch, priors: Any) -> list[tuple[Any, ...]]:
    published: list[tuple[Any, ...]] = []
    monkeypatch.setattr(ship, "target_engine", lambda url: _Engine())
    monkeypatch.setattr(ship, "load_model_artifacts", lambda conn: None)
    monkeypatch.setattr(ship, "fit_round", lambda *args: RoundFit(priors, 10394, (2021, 2022, 2023), {}))

    def publish(*args: Any) -> str:
        published.append(args)
        return "inserted"

    monkeypatch.setattr(ship, "publish_artifact", publish)
    return published


def test_the_fit_publishes_nothing_when_a_number_differs(monkeypatch: pytest.MonkeyPatch) -> None:
    moved = replace(PRIORS, availability_k={**PRIORS.availability_k, "WR": PRIORS.availability_k["WR"] + 1e-9})
    published = _stub(monkeypatch, moved)
    with pytest.raises(ConfigurationError, match="nothing published"):
        fit_and_publish("postgres://u:p@prod.example:5432/commish", _RECORD, KICKOFF)
    assert published == []


def test_the_fit_publishes_the_judged_numbers_once(monkeypatch: pytest.MonkeyPatch) -> None:
    published = _stub(monkeypatch, PRIORS)
    lines = fit_and_publish("postgres://u:p@prod.example:5432/commish", _RECORD, KICKOFF)
    assert len(published) == 1
    assert (published[0][1], published[0][2]) == (ARTIFACT_NAME, 1)
    assert lines[-1].endswith("inserted")
    assert Path(_RECORD).name in published[0][5]
