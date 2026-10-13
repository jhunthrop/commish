"""READING A WHOLE PRESEASON OUT OF THE STORE, AT ONE MOMENT.

Ported from `research-ts/src/projections/preseason/source.ts` (`loadPreseason`, the two board
moments and their leakage guards). Every read is gated at the moment; a live board refuses a
single game-derived observation of the season it projects, a replay board one at or before its
moment.
"""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Final, Literal

from sqlalchemy import Connection, text

from research.model.domain import PPR_SCORING, Position
from research.model.instants import js_iso, ms_instant
from research.model.laws.discovery_facts import DiscoveryFacts, discovery_facts_for_season
from research.model.laws.tribal import LawConditionFacts
from research.model.laws.tribal_facts import facts_for_season
from research.model.preseason.adjustments import DEPTH_SOURCE, DepthRank, depth_chart_as_of
from research.model.preseason.availability import SeasonAvailability
from research.model.preseason.availability_history import availability_by_season
from research.model.preseason.roster_status import CurrentRosterStatus
from research.model.reads.observations import (
    LAST_POSSIBLE_WEEK,
    LIVE_ADMITTED_DERIVED_SEASONS,
    PlayerWeekUsage,
    SeasonStatLine,
    WeekRange,
    admit_touches_as_opportunity,
    season_span,
    stat_lines_as_of,
    stat_lines_for_measurement,
    usage_as_of,
)
from research.model.reads.preseason import PreseasonRosterRow, all_positions, preseason_rosters_as_of
from research.model.reads.teams import first_kickoff_for, player_teams_as_of, team_observations_as_of
from research.pipeline.nflverse.injury_reports import INJURY_SOURCE
from research.pipeline.nflverse.schedule import ScheduleSource
from research.pipeline.observations import PlayerWeekTeam, TeamWeekObservation

HISTORY_SEASONS: Final = 3
PRE_GAME_SOURCES: Final = (INJURY_SOURCE, DEPTH_SOURCE)
MomentKind = Literal["replay", "live"]
_ONE_MS: Final = timedelta(milliseconds=1)


class BoardMomentError(ValueError):
    """The store cannot honestly place this board in time, or it would see the season's games."""


class MissingInputError(BoardMomentError):
    """`The store holds no ...`: an input the board needs is not held at its moment."""


@dataclass(frozen=True, slots=True)
class BoardMoment:
    kind: MomentKind
    at: datetime


def _earliest_game_derived_stamp(conn: Connection, season: int) -> datetime | None:
    row = conn.execute(
        text(
            "select min(as_of) as earliest from research.player_week_observations "
            "where season = :season and source <> all(:pre_game)"
        ),
        {"season": season, "pre_game": list(PRE_GAME_SOURCES)},
    ).first()
    return None if row is None or row.earliest is None else ms_instant(row.earliest)


def replay_moment_for(conn: Connection, season: int) -> BoardMoment:
    """`replayMomentFor`: one millisecond before the earliest game-derived stamp."""
    earliest = _earliest_game_derived_stamp(conn, season)
    if earliest is None:
        raise MissingInputError(
            f"The store holds no game-derived observations for {season}, so its preseason moment cannot be derived."
        )
    return BoardMoment("replay", earliest - _ONE_MS)


class SeasonStartedError(BoardMomentError):
    """`liveMomentFor`'s refusal: the season has already started."""


def live_moment_for(conn: Connection, season: int, now: datetime) -> BoardMoment:
    """`liveMomentFor`: now, capped one millisecond short of the season's first kickoff."""
    kickoff = first_kickoff_for(conn, season)
    if kickoff is None:
        raise MissingInputError(
            f"The store holds no ingested schedule for {season}, so its live moment cannot be derived."
        )
    now = ms_instant(now)
    if now >= kickoff:
        raise SeasonStartedError(
            f"{season}'s first scheduled kickoff ({js_iso(kickoff)}) is not after {js_iso(now)}. {season} has already started"
        )
    return BoardMoment("live", min(now, kickoff - _ONE_MS))


def board_moment_for(conn: Connection, season: int, now: datetime) -> BoardMoment:
    """`boardMomentFor` (`persist.ts`): live when the first kickoff is ahead, replay otherwise."""
    try:
        return live_moment_for(conn, season, now)
    except SeasonStartedError:
        return replay_moment_for(conn, season)


def _assert_season_invisible(conn: Connection, season: int, moment: BoardMoment) -> None:
    earliest = _earliest_game_derived_stamp(conn, season)
    if earliest is None:
        return
    if moment.kind == "live":
        raise BoardMomentError(
            f"A {season} LIVE board taken at {js_iso(moment.at)} can see a {season} game-derived observation stamped {js_iso(earliest)}."
        )
    if earliest <= moment.at:
        raise BoardMomentError(
            f"A {season} preseason board taken at {js_iso(moment.at)} can see a {season} game-derived observation stamped {js_iso(earliest)}."
        )


@dataclass(frozen=True, slots=True)
class PreseasonInputs:
    season: int
    moment: datetime
    moment_kind: MomentKind
    roster: tuple[PreseasonRosterRow, ...]
    positions: Mapping[str, Position]
    history: tuple[SeasonStatLine, ...]
    usage: tuple[PlayerWeekUsage, ...]
    prior_player_teams: tuple[PlayerWeekTeam, ...]
    team_observations: tuple[TeamWeekObservation, ...]
    availability: Mapping[int, Mapping[str, SeasonAvailability]]
    depth_chart: Mapping[str, DepthRank]
    law_facts: Mapping[str, LawConditionFacts]
    discovery_facts: Mapping[str, DiscoveryFacts]
    current_status: Mapping[str, CurrentRosterStatus] | None = field(default=None)


def admits_derived_prior_season(kind: MomentKind, prior_season: int) -> bool:
    """`admitsDerivedPriorSeason`: only a live board, only an allowlisted gap season."""
    return kind == "live" and prior_season in LIVE_ADMITTED_DERIVED_SEASONS


def _prior_seasons(
    conn: Connection, season: int, moment: BoardMoment, positions: Mapping[str, Position]
) -> tuple[list[SeasonStatLine], list[PlayerWeekUsage], list[PlayerWeekTeam], list[TeamWeekObservation], list[int]]:
    history: list[SeasonStatLine] = []
    usage: list[PlayerWeekUsage] = []
    teams: list[PlayerWeekTeam] = []
    observations: list[TeamWeekObservation] = []
    priors: list[int] = []
    for prior in range(season - HISTORY_SEASONS, season):
        priors.append(prior)
        span = season_span(prior, moment.at)
        admit = admits_derived_prior_season(moment.kind, prior)
        history.extend(stat_lines_for_measurement(conn, span) if admit else stat_lines_as_of(conn, span))
        prior_usage = usage_as_of(conn, span)
        usage.extend(admit_touches_as_opportunity(prior_usage, dict(positions)) if admit else prior_usage)
        teams.extend(player_teams_as_of(conn, prior, span.week, moment.at))
        observations.extend(team_observations_as_of(conn, prior, span.week, moment.at))
    return history, usage, teams, observations, priors


def load_preseason(conn: Connection, season: int, moment: BoardMoment) -> PreseasonInputs:
    """`loadPreseason`."""
    _assert_season_invisible(conn, season, moment)
    roster = preseason_rosters_as_of(conn, season, moment.at)
    if not roster:
        raise MissingInputError(f"The store holds no {season} week-one roster knowable at {js_iso(moment.at)}.")
    positions = all_positions(conn)
    history, usage, teams, observations, priors = _prior_seasons(conn, season, moment, positions)
    observations.extend(
        row
        for row in team_observations_as_of(conn, season, WeekRange(1, LAST_POSSIBLE_WEEK), moment.at)
        if row.source != ScheduleSource.KICKOFF
    )
    admit = admits_derived_prior_season(moment.kind, season - 1)
    law_facts = {
        player_id: entry.facts
        for player_id, entry in facts_for_season(conn, season - 1, positions, PPR_SCORING, admit).items()
    }
    discovery = discovery_facts_for_season(conn, season - 1, positions, PPR_SCORING, admit, moment.at)
    return PreseasonInputs(
        season=season,
        moment=moment.at,
        moment_kind=moment.kind,
        roster=tuple(roster),
        positions=positions,
        history=tuple(history),
        usage=tuple(usage),
        prior_player_teams=tuple(teams),
        team_observations=tuple(observations),
        availability=availability_by_season(conn, priors, moment.at).by_season,
        depth_chart=depth_chart_as_of(conn, season, moment.at),
        law_facts=law_facts,
        discovery_facts=discovery,
    )


def week_one_roster_stamp_of(inputs: PreseasonInputs) -> datetime:
    """`weekOneRosterStampOf`: the latest stamp among the roster rows."""
    latest = inputs.roster[0].as_of if inputs.roster else inputs.moment
    for row in inputs.roster:
        latest = max(latest, row.as_of)
    return latest


def sweep_phase_for(kind: MomentKind) -> str:
    """`sweepPhaseFor`."""
    return "cutdown" if kind == "live" else "in_season"


def roster_ids(roster: Sequence[PreseasonRosterRow]) -> list[str]:
    return [row.player_id for row in roster]
