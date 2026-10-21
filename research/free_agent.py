"""A FREE AGENT HAS NO CLUB (Lane 123, B101): how the research lane names one.

The store holds a free agent's club as NULL (`provider_players.team`, revision 0018; the daily list's read
in `pipeline/tank01/player_clubs.py` clears it). A file the web reads names him by the site's one club
word for a free agent, and a sentence by its words for one, both from the site's one words table
(api/internal/figurewords/words.json, which the API embeds and the web imports), so the run, the API and
the web never disagree on the cell.
"""

import json
import os
from typing import Final

from research.web_contract import figure_words_path


def read_free_agent_words(text: str) -> tuple[str, str]:
    """The words table's club cell and sentence words for a free agent, each a non-empty string."""
    table = json.loads(text)
    club, words = table.get("freeAgentClub"), table.get("freeAgent")
    if not isinstance(club, str) or not club or not isinstance(words, str) or not words:
        raise ValueError(f"the words table needs freeAgentClub and freeAgent: {club!r}, {words!r}")
    return club, words


# Read once, when the module loads: a broken table fails the run at its start.
_WORDS: Final = read_free_agent_words(figure_words_path(os.environ).read_text())
FREE_AGENT_CLUB: Final = _WORDS[0]
FREE_AGENT_WORDS: Final = _WORDS[1]


def run_club(team: str | None) -> str:
    """A club as a file the web reads carries it: his code, or the free agent's cell."""
    return FREE_AGENT_CLUB if team is None else team


def club_words(team: str | None) -> str:
    """A club in a sentence: his code, or "a free agent"."""
    return FREE_AGENT_WORDS if team is None else team
