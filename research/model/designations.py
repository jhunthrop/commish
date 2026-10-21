"""THE PROVIDER'S INJURY CODES IN THE CONTRACT'S WORDS, AND WHICH ARE SEASON-LONG (Lane 63).

One table for every reader: the publish hour (`nightly/designations.py`) and the capsule sheet
(`capsules/render_season.py`). The API keeps the same table (`api/internal/boards/status.go`), and
both lanes pin theirs to `api/testdata/designation-codes.json`.

A season-long designation (injured reserve, PUP, NFI, suspended, or out with a note saying out for
the season) keeps him off the field for weeks the rest-of-season figure counts, so the board ranks him
below every available player at his position. A week's out, doubtful or questionable moves nothing.
"""

from collections.abc import Mapping
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
