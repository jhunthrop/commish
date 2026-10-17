"""THE FILINGS A ROW READS BEYOND ROUND 3'S: the earlier weeks' filings of a teammate's absence, and
live, Tank01's word from lane 63's status rows (round 4 preregistration, section 2.2, amendment 2
items 4 and 7).

Earlier weeks: each player's latest nflverse filing of each week before W, stamped at or before t_g
(a `box` read: rows of weeks before W). Live: the status lane 63's hourly capture writes on each
published row (`published_boards.status`, NULL when the capture does not list him), crosswalked from
the provider's id to the universe's, read as of the capture's last successful check of its feed
(`capture_checks.checked_at`), which must be at or before t_g. A season-long status (injured reserve,
PUP, NFI, suspended) is withheld as Out is; a player the capture does not list has no filing.
"""

from collections.abc import Mapping
from dataclasses import dataclass
from datetime import datetime
from types import MappingProxyType
from typing import Final

from sqlalchemy import Connection, text

from research.model.designations import SEASON_LONG
from research.model.instants import ms_instant
from research.model.reads.observations import ObservationQuery, WeekRange, observations_as_of
from research.model.weekly2.designation import QUESTIONABLE, WITHHELD, WeekStatus, status_of_filing
from research.model.weekly3.ledger import Stamp
from research.model.weekly4.features.admitted import LIVE_FILING_PAIRS, admit_observations, admit_read
from research.pipeline.nflverse.injury_reports import INJURY_SOURCE, InjuryMetric

LIVE_FORMAT: Final = "ppr"  # every format's row carries the same status; one is read
_WORDS: Final[Mapping[str, WeekStatus]] = MappingProxyType(
    {"questionable": QUESTIONABLE, "doubtful": WITHHELD, "out": WITHHELD, **dict.fromkeys(SEASON_LONG, WITHHELD)}
)
LIVE_STATUSES_QUERY: Final = (
    "select c.player_id, pb.status, pb.status_source from research.published_boards pb "
    "join research.player_crosswalk c on c.provider_player_id = pb.player_id "
    "where pb.season = :season and pb.format = :format and pb.status is not null and c.player_id is not null "
    "order by c.player_id"
)
CHECKED_QUERY: Final = "select checked_at from research.capture_checks where source = any(:sources)"


def earlier_filings(
    conn: Connection, season: int, week: int, moment: datetime
) -> tuple[dict[tuple[str, int], WeekStatus], Stamp]:
    """Each player's latest filing of each week before W at t_g, by (player, week)."""
    rows = (
        observations_as_of(
            conn,
            ObservationQuery(
                season, WeekRange(1, week - 1), moment, INJURY_SOURCE, metrics=(InjuryMetric.REPORT_STATUS,)
            ),
        )
        if week > 1
        else []
    )
    stamp = admit_observations("box", rows, season, week, moment)
    return {(r.player_id, r.week): status_of_filing(r.value) for r in rows}, stamp


@dataclass(frozen=True, slots=True)
class _Checked:
    season: int
    week: int
    as_of: datetime


def status_of_word(word: str) -> WeekStatus:
    found = _WORDS.get(word)
    if found is None:
        raise ValueError(f"a published status {word!r} the weekly filter does not know")
    return found


def live_statuses(conn: Connection, season: int, week: int, moment: datetime) -> tuple[dict[str, WeekStatus], Stamp]:
    """Live week W's filings: Tank01's word on the newest capture checked at or before t_g."""
    rows = list(conn.execute(text(LIVE_STATUSES_QUERY), {"season": season, "format": LIVE_FORMAT}))
    sources = sorted({str(r.status_source) for r in rows if r.status_source})
    checks = [ms_instant(r[0]) for r in conn.execute(text(CHECKED_QUERY), {"sources": sources})] if sources else []
    cells = [_Checked(season, week, max(checks))] if checks else []
    stamp = admit_read("filings", LIVE_FILING_PAIRS, cells, season, week, moment)
    if not cells:
        return {}, stamp
    return {str(r.player_id): status_of_word(str(r.status)) for r in rows}, stamp
