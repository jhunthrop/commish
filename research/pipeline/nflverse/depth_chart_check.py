"""THE DEPTH CHART STAMP CHECK, preregistered (round 4 §5, the coordinator's ruling on H4).

nflverse's weekly charts to 2024 carry no publication time, so the Wednesday stamp
(`depth_chart_weeks`) needs evidence that a week-W chart was compiled before week W's games. On 2021
to 2023, weeks 6 to 17, reading only depth charts and filings, never an outcome value:

- the **injured group**: players at depth 1 on the week W-1 chart who have no week-W filing and whose
  week W+1 filing is Out (hurt in, or after, week W's game),
- the **comparison group**: players at depth 1 on the week W-1 chart with no filing in week W or W+1,
- each group's **retention**: the share still at depth 1 on the week-W chart.

The check **passes** when the injured group's retention is no more than 0.05 below the comparison
group's; on a fail the replay reads week W-1's chart. Its recorded run is the coordinator's
(preregistration §6.3); this module is the code that run executes.
"""

from collections import defaultdict
from collections.abc import Mapping, Set
from dataclasses import dataclass
from typing import Final

from sqlalchemy import Connection, text

from research.db.schema import NFLVERSE_DEPTH_CHART_WEEKS, PLAYER_WEEK_OBSERVATIONS
from research.pipeline.kickoffs import stored_kickoffs
from research.pipeline.nflverse.injury_reports import INJURY_SOURCE, InjuryMetric
from research.pipeline.nflverse.universe_reads import all_positions

CHECK_SEASONS: Final = (2021, 2022, 2023)
CHECK_WEEKS: Final = range(6, 18)
RETENTION_MARGIN: Final = 0.05
OUT: Final = 3.0

WeekKey = tuple[int, int]


@dataclass(frozen=True, slots=True)
class Group:
    players: int
    retained: int
    # Of `players`, those whose club had no game in week W: no report is filed on a bye, so the literal
    # rule puts a bye club's starters in "no week-W filing". Printed beside the verdict, never removed.
    byes: int = 0

    @property
    def retention(self) -> float | None:
        return None if self.players == 0 else self.retained / self.players


@dataclass(frozen=True, slots=True)
class StampCheck:
    injured: Group
    comparison: Group
    # Depth-1 player-weeks outside the players the filing ingest covers (a fullback, a player the
    # universe does not project): they can never be filed, so they are in neither group.
    excluded: int = 0

    @property
    def passed(self) -> bool:
        """A group with no players cannot answer, and a check that cannot answer fails."""
        injured, comparison = self.injured.retention, self.comparison.retention
        return injured is not None and comparison is not None and injured >= comparison - RETENTION_MARGIN

    def lines(self) -> list[str]:
        def shown(group: Group) -> str:
            rate = "none" if group.retention is None else f"{group.retention:.4f}"
            return f"{group.retained} of {group.players} retained at depth 1 ({rate}), {group.byes} on a bye week"

        verdict = (
            "PASS: the replay reads the week-W chart" if self.passed else "FAIL: the replay reads week W-1's chart"
        )
        return [
            f"injured group: {shown(self.injured)}",
            f"comparison group: {shown(self.comparison)}",
            f"excluded: {self.excluded} depth-1 player-weeks the filing ingest does not cover",
            f"margin {RETENTION_MARGIN}: {verdict}",
        ]


ClubWeek = tuple[int, int, str]


@dataclass(frozen=True, slots=True)
class CheckInputs:
    """`starters`: each week's depth-1 players with their club; `filings`: each week's latest status per
    filed player; `covered`: the players the filing ingest writes; `games`: every club-week with a game."""

    starters: Mapping[WeekKey, Mapping[str, str]]
    filings: Mapping[WeekKey, Mapping[str, float]]
    covered: Set[str]
    games: Set[ClubWeek]


def stamp_check(inputs: CheckInputs, weeks: Set[WeekKey]) -> StampCheck:
    injured = [0, 0, 0]
    comparison = [0, 0, 0]
    excluded = 0
    for season, week in sorted(weeks):
        before = inputs.starters.get((season, week - 1), {})
        now = inputs.starters.get((season, week), {})
        this_week = inputs.filings.get((season, week), {})
        next_week = inputs.filings.get((season, week + 1), {})
        for player, club in before.items():
            if player not in inputs.covered:
                excluded += 1
                continue
            if player in this_week:
                continue
            group = injured if next_week.get(player) == OUT else comparison if player not in next_week else None
            if group is not None:
                group[0] += 1
                group[1] += 1 if player in now else 0
                group[2] += 0 if (season, week, club) in inputs.games else 1
    return StampCheck(Group(*injured), Group(*comparison), excluded)


_STARTERS: Final = text(
    f"select season, week, player_id, team from {NFLVERSE_DEPTH_CHART_WEEKS.fullname} "
    "where season = any(:seasons) and depth_order = 1"
)
_FILINGS: Final = text(
    f"select distinct on (season, week, player_id) season, week, player_id, value from {PLAYER_WEEK_OBSERVATIONS.fullname} "
    "where season = any(:seasons) and source = :source and metric = :metric "
    "order by season, week, player_id, as_of desc"
)


def run_stamp_check(conn: Connection) -> StampCheck:
    """The check over its preregistered seasons and weeks, read from the store."""
    seasons = list(CHECK_SEASONS)
    starters: dict[WeekKey, dict[str, str]] = defaultdict(dict)
    for row in conn.execute(_STARTERS, {"seasons": seasons}):
        starters[(int(row.season), int(row.week))][str(row.player_id)] = str(row.team)
    filings: dict[WeekKey, dict[str, float]] = defaultdict(dict)
    params = {"seasons": seasons, "source": INJURY_SOURCE, "metric": InjuryMetric.REPORT_STATUS}
    for row in conn.execute(_FILINGS, params):
        filings[(int(row.season), int(row.week))][str(row.player_id)] = float(row.value)
    games = {(k.season, k.week, k.team) for season in seasons for k in stored_kickoffs(conn, season)}
    inputs = CheckInputs(starters, filings, frozenset(all_positions(conn)), games)
    weeks = {(season, week) for season in CHECK_SEASONS for week in CHECK_WEEKS}
    return stamp_check(inputs, weeks)
