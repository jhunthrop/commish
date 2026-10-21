"""A free agent has no club (Lane 123, B101): the store's NULL reads as the site's one club word for a free
agent in every file the web reads, and as its words in a sentence, both from the site's one words table
(api/internal/figurewords/words.json). A small hand-built board, no store."""

import json
from datetime import UTC, datetime

import pytest

from research.free_agent import (
    FREE_AGENT_CLUB,
    FREE_AGENT_WORDS,
    club_words,
    read_free_agent_words,
    run_club,
)
from research.nightly.build.pages import board_json, identities
from research.nightly.config import RUN_FORMATS
from research.nightly.reads.board import FormatBoard, StoredBoard, StoredRow, board_entries
from research.web_contract import figure_words_path

PPR = RUN_FORMATS[0]
AS_OF = datetime(2026, 10, 20, 10, tzinfo=UTC)


def _row(pid: str, name: str, team: str | None, projected: float) -> StoredRow:
    return StoredRow(
        universe_id=f"u-{pid}", player_id=pid, name=name, position="WR", team=team, headshot_url=None,
        market_adp=None, projected=projected, floor=projected * 0.7, median=projected, ceiling=projected * 1.3,
        expected_games=10.0,
    )  # fmt: skip


def test_the_words_come_from_the_sites_one_table() -> None:
    table = json.loads(figure_words_path({}).read_text())
    assert (FREE_AGENT_CLUB, FREE_AGENT_WORDS) == (table["freeAgentClub"], table["freeAgent"]) == ("FA", "a free agent")
    assert run_club(None) == "FA" and run_club("BUF") == "BUF"
    assert club_words(None) == "a free agent" and club_words("BUF") == "BUF"


def test_a_table_without_the_words_fails_at_its_read() -> None:
    with pytest.raises(ValueError, match="freeAgentClub"):
        read_free_agent_words(json.dumps({"freeAgentClub": "FA"}))
    with pytest.raises(ValueError, match="freeAgentClub"):
        read_free_agent_words(json.dumps({"freeAgentClub": "", "freeAgent": "a free agent"}))


def test_a_free_agents_board_row_and_identity_read_fa() -> None:
    """His row on the run's board and his page identity carry "FA"; a shared name's slug takes it as his
    place, and every other row keeps its club."""
    rows = [
        _row("p1", "Raylen Sharpe", None, 120.0),
        _row("p2", "Raylen Sharpe", "IND", 90.0),
        _row("p3", "A B", "BUF", 60.0),
    ]
    board = FormatBoard(PPR, StoredBoard(PPR.board_source, AS_OF, "research@test", None), board_entries(rows, PPR))
    people = {p.id: p for p in identities([board])}
    assert (people["p1"].team, people["p1"].slug) == ("FA", "raylen-sharpe-wr-fa")
    assert (people["p2"].team, people["p2"].slug) == ("IND", "raylen-sharpe-wr-ind")
    assert people["p3"].team == "BUF"
    written = {row["id"]: row for row in board_json(board, people, {})["rows"]}
    assert written["p1"]["team"] == "FA" and written["p2"]["team"] == "IND"
