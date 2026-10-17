"""THE REALISED MARGINS, AN OUTCOME (preregistration section 2.6): the simulation's margin standard
deviation and its script effect are fitted on the fit rows' realised margins, the club's points less
the opponent's, read from the stored points allowed at the far future (a correction counts).

`points_allowed` is an outcome of week W and is never an input (section 5, item 5); it is read only
here, through a reader that serves the dispersion fit's seasons and keeps them on its ledger, and
refuses every other season before any read.
"""

from dataclasses import dataclass

import pandas as pd
from sqlalchemy import Connection

from research.errors import ResearchError
from research.model.instants import FAR_FUTURE
from research.model.reads.observations import WeekRange
from research.model.reads.teams import team_observations_as_of
from research.model.weekly2.guard import LAST_JUDGED_WEEK
from research.pipeline.nflverse.schedule import ScheduleMetric, ScheduleSource


class MarginSeasonError(ResearchError):
    """A margin read of a season the dispersion fit may not read."""


@dataclass(frozen=True, slots=True)
class MarginReader:
    allowed: frozenset[int]
    served: tuple[int, ...] = ()

    def season(self, conn: Connection, season: int) -> tuple[pd.DataFrame, "MarginReader"]:
        """Each club-game's realised margin (`margin`), the season added to the ledger."""
        if season not in self.allowed:
            raise MarginSeasonError(f"the margin reader serves {sorted(self.allowed)}; {season} is refused")
        rows = team_observations_as_of(conn, season, WeekRange(1, LAST_JUDGED_WEEK), FAR_FUTURE, ScheduleSource.KICKOFF)
        allowed = pd.DataFrame(
            [(r.week, r.team, r.value) for r in rows if r.metric == ScheduleMetric.POINTS_ALLOWED],
            columns=["week", "club", "points_allowed"],
        )
        return allowed.assign(season=season), MarginReader(self.allowed, (*self.served, season))


def margins(allowed: pd.DataFrame, pairing: pd.DataFrame) -> pd.DataFrame:
    """The club's points less its opponent's: the opponent's points allowed less the club's own."""
    own = pairing.merge(allowed, on=["season", "week", "club"], how="inner")
    theirs = allowed.rename(columns={"club": "opponent", "points_allowed": "scored"})
    joined = own.merge(theirs, on=["season", "week", "opponent"], how="inner")
    return joined.assign(margin=joined["scored"] - joined["points_allowed"])[["season", "week", "club", "margin"]]
