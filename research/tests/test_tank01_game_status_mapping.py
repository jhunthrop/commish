"""An overtime final reads Final: Tank01's gameStatusCode wins, the words match by prefix."""

from typing import Final

import pytest

from research.pipeline.tank01.mapping import GameStatus, map_games

_BASE: Final = {"gameID": "20261018_PIT@TB", "home": "TB", "away": "PIT"}


@pytest.mark.parametrize(
    ("fields", "expected"),
    [
        ({"gameStatus": "Final/OT", "gameStatusCode": "2"}, "final"),
        ({"gameStatus": "Final/OT"}, "final"),
        ({"gameStatus": "Final OT"}, "final"),
        ({"gameStatus": "Completed"}, "final"),
        ({"gameStatus": "Final", "gameStatusCode": "2"}, "final"),
        ({"gameStatus": "", "gameStatusCode": "2"}, "final"),
        ({"gameStatus": "Halftime", "gameStatusCode": "1"}, "in_progress"),
        ({"gameStatus": "Scheduled", "gameStatusCode": "0"}, "scheduled"),
        ({"gameStatus": "Scheduled"}, "scheduled"),
        ({"gameStatus": "In Progress"}, "in_progress"),
        ({"gameStatus": "Final", "gameStatusCode": "9"}, "final"),
        ({}, "in_progress"),
    ],
)
def test_game_status_reads_code_then_words(fields: dict[str, str], expected: GameStatus) -> None:
    [game] = map_games([{**_BASE, **fields}], 6)
    assert game.status == expected
