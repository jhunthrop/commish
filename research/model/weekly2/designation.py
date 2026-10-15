"""THE WEEK'S DESIGNATION, A FILTER: Out or Doubtful gets no weekly number, Questionable keeps the
number and a flag, anything else is clear.

Preregistration section 2, item 4 (spec section 4.2 keys 1 and 2). In replay the designation is the
latest stamped nflverse filing for the week at or before the projection's moment
(`injury_report_status`, the ordinal `injury_reports` writes: 0 none or Probable, 1 Questionable,
2 Doubtful, 3 Out). Live it is Tank01's designation word (`status_of_tank01`, the API's mapping): a
listing that cannot play this week (Out, injured reserve, PUP, NFI, suspended, exempt) is withheld
as Out is. An ordinal or a word outside these is a schema change and is refused, never read as clear.
"""

import re
from collections.abc import Mapping
from datetime import datetime
from types import MappingProxyType
from typing import Final, Literal

from sqlalchemy import Connection

from research.errors import SchemaDriftError
from research.model.preseason.roster_status import reserve_kind_of
from research.model.reads.observations import ObservationQuery, observations_as_of
from research.pipeline.nflverse.injury_reports import INJURY_SOURCE, InjuryMetric

WeekStatus = Literal["withheld", "questionable", "clear"]
WITHHELD: Final[WeekStatus] = "withheld"
QUESTIONABLE: Final[WeekStatus] = "questionable"
CLEAR: Final[WeekStatus] = "clear"

_STATUS_OF_ORDINAL: Final[Mapping[int, WeekStatus]] = MappingProxyType(
    {0: CLEAR, 1: QUESTIONABLE, 2: WITHHELD, 3: WITHHELD}
)
# Tank01's own words for a game-week designation; "Day-To-Day" is its word for a player who may play.
_STATUS_OF_WORD: Final[Mapping[str, WeekStatus]] = MappingProxyType(
    {
        "": CLEAR,
        "probable": CLEAR,
        "questionable": QUESTIONABLE,
        "day-to-day": QUESTIONABLE,
        "doubtful": WITHHELD,
        "out": WITHHELD,
    }
)
_SPACES: Final = re.compile(r"\s+")


def status_of_filing(ordinal: float) -> WeekStatus:
    """The filter's state for an nflverse filing's report-status ordinal."""
    found = _STATUS_OF_ORDINAL.get(int(ordinal)) if float(ordinal).is_integer() else None
    if found is None:
        raise SchemaDriftError(f"injury_report_status {ordinal!r} is not an ordinal the filings ingest writes")
    return found


def status_of_tank01(designation: str | None) -> WeekStatus:
    """The filter's state for Tank01's designation word (the API maps its captures through this)."""
    word = _SPACES.sub(" ", (designation or "").strip()).lower()
    found = _STATUS_OF_WORD.get(word)
    if found is not None:
        return found
    if reserve_kind_of(designation) is not None:
        return WITHHELD
    raise SchemaDriftError(f"Tank01 designation {designation!r} is not one the weekly filter knows")


def filed_statuses(conn: Connection, season: int, week: int, moment: datetime) -> dict[str, WeekStatus]:
    """Each player's state from his latest filing for `week` stamped at or before `moment`."""
    rows = observations_as_of(conn, ObservationQuery(season, week, moment, INJURY_SOURCE))
    return {row.player_id: status_of_filing(row.value) for row in rows if row.metric == InjuryMetric.REPORT_STATUS}
