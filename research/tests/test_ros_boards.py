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
from research.model.ros.live import SeasonPlayer
from research.model.ros.payload import ARTIFACT_NAME, priors_from
from research.model.ros.raw_line import RawLine
from research.model.ros.ship import SHIPPED_ROUND, fit_and_publish
from research.nightly.build.player_season import SeasonContext, SeasonStore
from research.nightly.build.ros import RosSetup, ros_boards
from research.nightly.config import RUN_FORMATS
from research.nightly.reads.board import FormatBoard, StoredBoard, StoredRow, board_entries
from research.nightly.reads.schedule import Game

_RECORD = JUDGMENT_RECORDS[SHIPPED_ROUND]
_JUDGED: dict[str, Any] = json.loads(_RECORD.read_text())["priors"]
PRIORS = priors_from(_JUDGED)
PPR, HALF, STD = RUN_FORMATS[0], RUN_FORMATS[1], RUN_FORMATS[2]
CLUBS = ("KC", "BUF")
KICKOFF = datetime(2026, 9, 10, 17, tzinfo=UTC)


def _schedule() -> dict[str, tuple[Game, ...]]:
    """Two clubs playing each other every week, Thursday-to-Sunday style, weeks 1 to 18."""
    return {
        club: tuple(Game(week, CLUBS[1 - i], i == 0, KICKOFF + timedelta(weeks=week - 1)) for week in range(1, 19))
        for i, club in enumerate(CLUBS)
    }


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
    return SeasonContext(2026, 18, through, _schedule(), dict.fromkeys(CLUBS), store)


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
WEEK_7 = KICKOFF + timedelta(weeks=6) - timedelta(hours=1)  # before week 7's games, week 6 played


def test_before_the_switch_week_every_board_stays_preseason() -> None:
    boards = _boards()
    result = ros_boards(boards, _context(5), KICKOFF + timedelta(weeks=5) - timedelta(hours=1), SETUP)
    assert result.boards == boards
    assert result.status == "preseason: week 6 is before the switch week (7)"


def test_from_week_7_every_board_ranks_the_rest_of_the_season() -> None:
    result = ros_boards(_boards(), _context(6), WEEK_7, SETUP)
    assert result.basis is not None
    assert (result.basis.from_week, result.basis.through) == (7, 6)
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
    result = ros_boards(boards, _context(6), WEEK_7, setup)
    assert (result.boards, result.basis, result.status) == (boards, None, reason)


def test_after_the_last_ranked_week_the_board_reverts_to_preseason() -> None:
    boards = _boards()
    result = ros_boards(boards, _context(17), KICKOFF + timedelta(weeks=17) - timedelta(hours=1), SETUP)
    assert result.boards == boards
    assert result.status == "preseason: week 18 is past week 17, the last the model ranks"


def test_a_raw_line_without_a_scoring_keeps_that_format_preseason_alone() -> None:
    boards = _boards()
    result = ros_boards(boards, _context(6), WEEK_7, replace(SETUP, raw=_raw(("ppr", "half"))))
    assert result.in_season == {"ppr-12", "half-ppr-12"}
    assert result.boards[2] == boards[2]
    assert "preseason for standard-12: the raw line holds no std points" in result.status


def test_a_player_the_ppr_board_lacks_keeps_that_format_preseason_alone() -> None:
    boards = _boards(half_extra=True)
    result = ros_boards(boards, _context(6), WEEK_7, SETUP)
    assert result.in_season == {"ppr-12", "standard-12"}
    assert result.boards[1] == boards[1]
    assert "preseason for half-ppr-12: it ranks 1 players the PPR board does not" in result.status


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
