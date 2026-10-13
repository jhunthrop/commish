"""ONE SEASON, FROM RELEASE TO STORE (`src/projections/nflverse/ingest.ts`, the universe and season halves).

The universe is fetched once and passed in. A season reads the snap-count and weekly-stats files;
two upstream holes take two different branches: a season whose weekly stats were never published
(`STAT_LINE_GAPS`) and a season below the snap-count asset floor. Both are named in the report
rather than folded into one "thin" flag.
"""

import logging
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import Connection

from research.pipeline.nflverse.client import NflverseClient, NflverseError
from research.pipeline.nflverse.config import PUBLICATION_LAG_HOURS, Files, Releases
from research.pipeline.nflverse.csv import CsvRow
from research.pipeline.nflverse.participation import (
    SNAP_COUNT_ASSET_FLOOR,
    NflverseSource,
    ParticipationMetric,
    map_participation,
    participation_observations,
    week_as_of_from_snap_counts,
)
from research.pipeline.nflverse.players import PlayerUniverse, UnresolvedRef, map_nfl_players, record_nfl_players
from research.pipeline.nflverse.schedule import (
    SCHEDULE_BASE_URL,
    SCHEDULE_FILE,
    SCHEDULE_RELEASE,
    map_schedule,
    week_as_of_from_schedule,
)
from research.pipeline.nflverse.stat_lines import STAT_LINE_GAPS, map_stat_lines, stat_line_observations
from research.pipeline.nflverse.team_map import (
    line_continuity_observations,
    map_player_teams,
    map_player_teams_from_weekly_stats,
)
from research.pipeline.observations import (
    delete_observations_by_source,
    record_observations,
    record_player_teams,
    record_team_observations,
)

LOG = logging.getLogger(__name__)

# The six participation metrics built from the weekly file rather than from snap counts: withheld
# (and any stale false zeros deleted) for a season whose weekly file does not exist.
PLAYERWEEK_PARTICIPATION_METRICS: tuple[str, ...] = (
    ParticipationMetric.TARGETS,
    ParticipationMetric.TEAM_TARGETS,
    ParticipationMetric.CARRIES,
    ParticipationMetric.TEAM_CARRIES,
    ParticipationMetric.PASS_ATTEMPTS,
    ParticipationMetric.TEAM_PASS_ATTEMPTS,
)


@dataclass(frozen=True)
class UnresolvedSummary:
    id: str
    name: str
    occurrences: int


@dataclass(frozen=True)
class SeasonIngestReport:
    season: int
    participation_rows: int
    stat_lines: int
    observations_written: int
    participation_resolution: float | None
    stat_line_resolution: float | None
    unresolved: list[UnresolvedSummary]
    week_as_of: Mapping[float, datetime]
    player_week_unavailable: bool
    snap_counts_unavailable: bool
    player_team_edges: int


def schedule_client(client: NflverseClient) -> NflverseClient:
    """The schedule lives in a different repository from the release assets."""
    return NflverseClient(fetcher=client.fetcher, base_url=SCHEDULE_BASE_URL)


def ingest_player_universe(conn: Connection, client: NflverseClient) -> PlayerUniverse:
    """`ingestPlayerUniverse`: fetch, upsert into `players`, return the lookup."""
    players = map_nfl_players(client.get_csv(Releases.PLAYERS, Files.PLAYERS))
    record_nfl_players(conn, players)
    return PlayerUniverse(players)


def _fetch_player_week(client: NflverseClient, season: int) -> list[dict[str, str]]:
    try:
        return client.get_csv(Releases.PLAYER_WEEK, f"stats_player_week_{season}.csv")
    except NflverseError as error:
        if error.kind != "not_found":
            raise
        if season not in STAT_LINE_GAPS:
            LOG.warning(
                "WARNING: nflverse has no weekly stats for %s, and %s is not in STAT_LINE_GAPS. This is not the known "
                "2019 hole; investigate before trusting this season's participation or stat lines.",
                season,
                season,
            )
        return []


def _fetch_snap_counts(client: NflverseClient, season: int) -> list[dict[str, str]]:
    try:
        rows = client.get_csv(Releases.SNAP_COUNTS, f"snap_counts_{season}.csv")
    except NflverseError as error:
        if error.kind != "not_found":
            raise
        rows = []
    if not rows and season >= SNAP_COUNT_ASSET_FLOOR:
        LOG.warning(
            "WARNING: nflverse has no snap counts for %s, which is at or above SNAP_COUNT_ASSET_FLOOR (%s).",
            season,
            SNAP_COUNT_ASSET_FLOOR,
        )
    return rows


def schedule_week_as_of(client: NflverseClient, seasons: Sequence[int]) -> dict[int, dict[float, datetime]]:
    """`scheduleWeekAsOf`: per-season week stamps from one `games.csv` download. Writes nothing."""
    rows = schedule_client(client).get_csv(SCHEDULE_RELEASE, SCHEDULE_FILE)
    games = map_schedule(rows, seasons)
    return {season: week_as_of_from_schedule([g for g in games if g.season == season]) for season in seasons}


def _week_as_of(
    snap_counts: Sequence[CsvRow], schedule_as_of: Mapping[float, datetime] | None
) -> dict[float, datetime]:
    """Each week's as-of: the snap-count publication where there is one, else the schedule's."""
    return {
        **(dict(schedule_as_of) if schedule_as_of is not None else {}),
        **week_as_of_from_snap_counts(snap_counts, PUBLICATION_LAG_HOURS),
    }


def _retract_false_zeros(conn: Connection, season: int) -> None:
    """With no player-week release, its earlier participation zeros are false: they go."""
    removed = delete_observations_by_source(conn, season, NflverseSource.PLAYER_WEEK, PLAYERWEEK_PARTICIPATION_METRICS)
    if removed > 0:
        LOG.warning("WARNING: removed %s stale false-zero participation observations for %s.", removed, season)


def _merged_unresolved(refs: Sequence[UnresolvedRef]) -> list[UnresolvedSummary]:
    """One summary per unresolved id, occurrences summed, in first-seen order."""
    unresolved: dict[str, UnresolvedSummary] = {}
    for ref in refs:
        already = unresolved.get(ref.id)
        unresolved[ref.id] = (
            UnresolvedSummary(ref.id, ref.name, ref.occurrences)
            if already is None
            else UnresolvedSummary(already.id, already.name, already.occurrences + ref.occurrences)
        )
    return list(unresolved.values())


def ingest_season(
    conn: Connection,
    client: NflverseClient,
    universe: PlayerUniverse,
    season: int,
    schedule_as_of: Mapping[float, datetime] | None = None,
) -> SeasonIngestReport:
    """`ingestSeason`: participation, stat lines, team edges and line continuity for one season."""
    snap_counts = _fetch_snap_counts(client, season)
    player_week = _fetch_player_week(client, season)
    if not snap_counts and schedule_as_of is None:
        raise ValueError(
            f"nflverse has no snap counts for {season} and no schedule-derived week as-ofs were supplied, so its "
            f"stat lines cannot be dated. Pass scheduleWeekAsOf([...]).get({season}) for seasons at or below "
            "SNAP_COUNT_ASSET_FLOOR."
        )
    week_as_of = _week_as_of(snap_counts, schedule_as_of)

    participation = map_participation(snap_counts, player_week, universe)
    stat_lines = map_stat_lines(player_week, week_as_of, universe)
    participation_rows = [
        row
        for row in participation_observations(participation.participation)
        if player_week or row.source != NflverseSource.PLAYER_WEEK
    ]

    if not player_week:
        _retract_false_zeros(conn, season)

    written = record_observations(conn, participation_rows) + record_observations(
        conn, stat_line_observations(stat_lines.stat_lines)
    )
    player_teams = (
        map_player_teams(snap_counts, universe)
        if snap_counts
        else map_player_teams_from_weekly_stats(player_week, season, week_as_of, universe)
    )
    edges = record_player_teams(conn, player_teams)
    record_team_observations(conn, line_continuity_observations(snap_counts, season))

    unresolved = _merged_unresolved([*participation.unresolved, *stat_lines.unresolved])
    return SeasonIngestReport(
        season=season,
        participation_rows=len(participation.participation),
        stat_lines=len(stat_lines.stat_lines),
        observations_written=written,
        participation_resolution=participation.resolution_rate,
        stat_line_resolution=stat_lines.resolution_rate,
        unresolved=unresolved,
        week_as_of=week_as_of,
        player_week_unavailable=not player_week,
        snap_counts_unavailable=not snap_counts,
        player_team_edges=edges,
    )
