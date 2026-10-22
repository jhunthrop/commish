"""THE PROVIDER'S INJURY CODES IN THE CONTRACT'S WORDS, AND WHICH ARE SEASON-LONG (Lane 63).

One table for every reader: the publish hour (`nightly/designations.py`) and the capsule sheet
(`capsules/render_season.py`). The API keeps the same table (`api/internal/boards/status.go`), and
both lanes pin theirs to `api/testdata/designation-codes.json`.

A season-long designation (injured reserve, PUP, NFI, suspended, or out with a note saying out for
the season) keeps him off the field for weeks the rest-of-season figure counts, so the board ranks him
below every available player at his position. A week's out, doubtful or questionable moves nothing.
"""

from collections.abc import Mapping
from datetime import date
from typing import Final

CODES: Final[Mapping[str, str]] = {
    "Q": "questionable",
    "QUESTIONABLE": "questionable",
    "D": "doubtful",
    "DOUBTFUL": "doubtful",
    "O": "out",
    "OUT": "out",
    "IR": "injured_reserve",
    "IR-R": "injured_reserve",
    "INJURED RESERVE": "injured_reserve",
    # The player list's and the roster sweep's words for IR-R (Lane 110).
    "INJURED RESERVE - DESIGNATED TO RETURN": "injured_reserve",
    "SUSP": "suspended",
    "SUS": "suspended",
    "SUSPENDED": "suspended",
    "PUP": "pup",
    "NFI": "nfi",
}
SEASON_LONG: Final = frozenset({"injured_reserve", "suspended", "pup", "nfi"})
OUT_FOR_THE_SEASON: Final = "out for the season"


def status_of(code: str) -> str | None:
    """The provider's code in the contract's words, None for a code we do not know."""
    return CODES.get(code.strip().upper())


def season_long(status: str, note: str | None) -> bool:
    """A designation that keeps him out for weeks the rest-of-season figure counts."""
    if status in SEASON_LONG:
        return True
    return status == "out" and OUT_FOR_THE_SEASON in (note or "").lower()


# THE RETURN RULE (Lane 153). The daily player list's return date against the week: a season-long code
# (by itself, never a note's out for the season) due back at or before the current week's last game day
# is this week's designation, questionable and ranked as playing; one due back later stays season-long
# with the day carried so a row says when; a day before today has passed and says nothing. The API reads
# the same rule (`api/internal/boards/returning.go ReturnOf`), pinned by `designation-codes.json`.
RETURNING_STATUS: Final = "questionable"
NO_RETURN: Final = "none"
RETURNING_THIS_WEEK: Final = "this_week"
RETURNING_LATER: Final = "later"


def returning_of(status: str, returning: date | None, last_game_day: date | None, today: date) -> str:
    """What a return day makes of a designation: RETURNING_THIS_WEEK, RETURNING_LATER or NO_RETURN. Days are
    Eastern; `last_game_day` is the current week's (None with no game left)."""
    if returning is None or status not in SEASON_LONG or returning < today:
        return NO_RETURN
    if last_game_day is not None and returning <= last_game_day:
        return RETURNING_THIS_WEEK
    return RETURNING_LATER
