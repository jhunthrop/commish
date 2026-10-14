"""WHAT A WEEKLY PROJECTION MAY SEE: one week's input, read from the store at one instant.

Ported from the per-week reads of `research-ts/src/projections/backtest.ts` (`replayWeeks`), with
no per-player kickoff gate (`asOfForPlayerGame` unset, as the oracle's own reports ran): the two
seasons a projection reads (the prior and this one), every outcome and usage row up to the week
before, each club's edges over the same span, the team facts of the prior season and of this season
through the target week, all gated at the moment.

Two readers of the player facts. `ORACLE_READER` is the oracle's (`statLinesAsOf`, `usageAsOf`):
published lines only, for the parity cases. `ROUND_READER` is the weekly round's: a gap season
(nflverse published no weekly file) admits the lines derived from play-by-play and the
play-by-play's touch counts, exactly where the live preseason board admits them
(`LIVE_ADMITTED_DERIVED_SEASONS`); every other season reads exactly as the oracle does.
"""

from collections.abc import Callable, Mapping
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Final

from sqlalchemy import Connection

from research.errors import ResearchError
from research.model.domain import Position
from research.model.instants import js_iso
from research.model.reads.observations import (
    LAST_POSSIBLE_WEEK,
    ObservationQuery,
    PlayerWeekUsage,
    SeasonStatLine,
    WeekRange,
    admit_touches_as_opportunity,
    admits_derived_for_live_surface,
    stat_lines_as_of,
    stat_lines_for_live_surface,
    usage_as_of,
)
from research.model.reads.preseason import all_positions, first_roster_seasons_through
from research.model.reads.teams import (
    TeamContext,
    kickoff_instants_by_week,
    player_teams_as_of,
    team_observations_as_of,
)
from research.pipeline.observations import PlayerWeekTeam, TeamWeekObservation

HISTORY_SEASONS: Final = 2
_ONE_MS: Final = timedelta(milliseconds=1)


class WeekMomentError(ResearchError):
    """The store holds no kickoff for the week, so no honest projection moment exists."""


@dataclass(frozen=True, slots=True)
class WeeklyInput:
    """`ProjectionInput` without the news wire (the news group is off in the shipped model)."""

    season: int
    week: int
    as_of: datetime
    history: tuple[SeasonStatLine, ...]
    usage: tuple[PlayerWeekUsage, ...]
    positions: Mapping[str, Position]
    team_context: TeamContext
    first_roster_season: Mapping[str, int]


@dataclass(frozen=True, slots=True)
class FactReader:
    """How the player facts of one season are read at an instant."""

    name: str
    lines: Callable[[Connection, ObservationQuery], list[SeasonStatLine]]
    usage: Callable[[Connection, ObservationQuery, Mapping[str, Position]], list[PlayerWeekUsage]]


def _oracle_usage(conn: Connection, query: ObservationQuery, _: Mapping[str, Position]) -> list[PlayerWeekUsage]:
    return usage_as_of(conn, query)


def _round_usage(conn: Connection, query: ObservationQuery, positions: Mapping[str, Position]) -> list[PlayerWeekUsage]:
    rows = usage_as_of(conn, query)
    if not admits_derived_for_live_surface(query.season):
        return rows
    return admit_touches_as_opportunity(rows, dict(positions))


ORACLE_READER: Final = FactReader("oracle", stat_lines_as_of, _oracle_usage)
ROUND_READER: Final = FactReader("round", stat_lines_for_live_surface, _round_usage)


def week_moment(conn: Connection, season: int, week: int) -> datetime:
    """One millisecond before the week's first kickoff: every completed week is visible, no game of
    this week is."""
    kickoff = kickoff_instants_by_week(conn, season).get(week)
    if kickoff is None:
        raise WeekMomentError(f"The store holds no ingested kickoff for {season} week {week}.")
    return kickoff - _ONE_MS


def _team_facts(
    conn: Connection, season: int, week: int, history_season: int, as_of: datetime
) -> list[TeamWeekObservation]:
    if history_season != season:
        return team_observations_as_of(conn, history_season, WeekRange(1, LAST_POSSIBLE_WEEK), as_of)
    rows: list[TeamWeekObservation] = []
    if week > 1:
        rows.extend(team_observations_as_of(conn, season, WeekRange(1, week - 1), as_of))
    rows.extend(team_observations_as_of(conn, season, week, as_of))
    return rows


def load_week(conn: Connection, season: int, week: int, as_of: datetime, reader: FactReader) -> WeeklyInput:
    """`replayWeeks`'s reads for one week, in its order."""
    if not 1 <= week <= LAST_POSSIBLE_WEEK:
        raise ValueError(f"week must be 1..{LAST_POSSIBLE_WEEK}; got {week}")
    positions = all_positions(conn)
    first_roster_season = first_roster_seasons_through(conn, season)
    history: list[SeasonStatLine] = []
    usage: list[PlayerWeekUsage] = []
    player_teams: list[PlayerWeekTeam] = []
    team_rows: list[TeamWeekObservation] = []
    for history_season in range(season - HISTORY_SEASONS + 1, season + 1):
        up_to = week - 1 if history_season == season else LAST_POSSIBLE_WEEK
        if up_to >= 1:
            span = ObservationQuery(history_season, WeekRange(1, up_to), as_of)
            history.extend(reader.lines(conn, span))
            usage.extend(reader.usage(conn, span, positions))
            player_teams.extend(player_teams_as_of(conn, history_season, WeekRange(1, up_to), as_of))
        team_rows.extend(_team_facts(conn, season, week, history_season, as_of))
    late = [row for row in team_rows if row.as_of > as_of]
    if late:
        raise WeekMomentError(f"a {season} week {week} read saw a team fact stamped after {js_iso(as_of)}")
    return WeeklyInput(
        season=season,
        week=week,
        as_of=as_of,
        history=tuple(history),
        usage=tuple(usage),
        positions=positions,
        team_context=TeamContext(tuple(player_teams), tuple(team_rows)),
        first_roster_season=first_roster_season,
    )
