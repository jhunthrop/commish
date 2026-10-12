"""THE PRESEASON INGESTS (`src/projections/preseason/{ingest,store,adp-benchmark,current}.ts`,
`market/adp-snapshot.ts`, and the operator scripts `preseason-ingest`, `kdef-adp-ingest`,
`ingest-current-ecr`).

Week-one rosters into `preseason_rosters` (a LIVE season's capture supersedes the season's stored
rows in one transaction; a past season only appends what is absent), the week-one depth chart into
`player_week_observations`, the published boards into `preseason_rankings`, and the nightly ADP
capture in all three formats into the append-only `adp_snapshots`.
"""

import logging
import re
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from sqlalchemy import Connection, delete, select, text

from research.db.schema import (
    ADP_SNAPSHOTS,
    NFL_PLAYERS,
    PLAYER_CROSSWALK,
    PLAYERS,
    PRESEASON_RANKINGS,
    PRESEASON_ROSTERS,
)
from research.errors import ResearchError
from research.pipeline.http import Fetcher
from research.pipeline.nflverse.client import NflverseClient
from research.pipeline.nflverse.config import Releases
from research.pipeline.nflverse.schedule import ScheduleMetric, ScheduleSource
from research.pipeline.nflverse.universe_reads import all_positions, known_player_ids
from research.pipeline.observations import insert_ignoring_conflicts, record_observations
from research.pipeline.preseason.benchmarks import (
    BENCHMARK_BOARD_FLOOR,
    BenchmarkSource,
    RosterIdentity,
    resolve_rankings,
)
from research.pipeline.preseason.publishers import (
    FfcAdpFormat,
    PublishedBoard,
    fetch_average_draft_position,
    fetch_expert_consensus,
)
from research.pipeline.preseason.rosters import (
    HISTORICAL_ROSTER_FLOOR,
    ROSTER_EARLIEST_SEASON,
    PreseasonRosterEntry,
    map_depth_chart,
    map_week1_rosters,
    roster_file,
    week1_roster_as_of_bounded_by,
)

LOG = logging.getLogger(__name__)
_NOT_PUBLISHED = re.compile(r"published no \d{4} board")
FINAL = datetime(9999, 12, 31, tzinfo=UTC)
PRODUCT_SEASON = 2026

# Each board format: (format, ADP source, snapshot format, feed format).
BOARD_FORMATS: tuple[tuple[str, str, str, FfcAdpFormat], ...] = (
    ("ppr", BenchmarkSource.ADP, "ppr_12", "ppr"),
    ("half", BenchmarkSource.ADP_HALF, "half_12", "half-ppr"),
    ("std", BenchmarkSource.ADP_STD, "std_12", "standard"),
)
DEFAULT_BOARD_FORMAT = "ppr"


# --- the store ----------------------------------------------------------------------------------


def record_preseason_rosters(conn: Connection, rows: Sequence[PreseasonRosterEntry]) -> int:
    return insert_ignoring_conflicts(
        conn,
        PRESEASON_ROSTERS,
        [
            {
                "season": r.season, "team": r.team, "player_id": r.player_id, "position": r.position,
                "status": r.status, "birth_date": r.birth_date, "draft_year": r.draft_year,
                "draft_pick": r.draft_pick, "draft_club": r.draft_club, "as_of": r.as_of,
            }
            for r in rows
        ],
    )  # fmt: skip


@dataclass(frozen=True)
class RankingRow:
    season: int
    source: str
    player_id: str
    rank: float
    as_of: datetime


def record_preseason_rankings(conn: Connection, rows: Sequence[RankingRow]) -> int:
    return insert_ignoring_conflicts(
        conn,
        PRESEASON_RANKINGS,
        [
            {"season": r.season, "source": r.source, "player_id": r.player_id, "rank": r.rank, "as_of": r.as_of}
            for r in rows
        ],
    )


@dataclass(frozen=True)
class StoredRoster:
    player_id: str
    team: str
    position: str
    status: str


def preseason_rosters_as_of(conn: Connection, season: int, as_of: datetime) -> list[StoredRoster]:
    """`preseasonRostersAsOf`: each player's latest roster row at or before `as_of`."""
    rows = conn.execute(
        text(
            "select distinct on (player_id) player_id, team, position, status from preseason_rosters "
            "where season = :season and as_of <= :as_of order by player_id asc, as_of desc"
        ),
        {"season": season, "as_of": as_of},
    )
    return [StoredRoster(r.player_id, r.team, r.position, r.status) for r in rows]


def first_kickoff_for(conn: Connection, season: int) -> datetime | None:
    """`firstKickoffFor`: the earliest week-one kickoff instant the schedule stored."""
    return conn.execute(
        text(
            "select min(as_of) from team_week_observations where season = :season and week = 1 "
            "and source = :source and metric = :metric"
        ),
        {"season": season, "source": ScheduleSource.KICKOFF, "metric": ScheduleMetric.KICKOFF_INSTANT},
    ).scalar_one_or_none()


def require_first_kickoff_for(conn: Connection, season: int) -> datetime:
    kickoff = first_kickoff_for(conn, season)
    if kickoff is None:
        raise ResearchError(
            f"The store holds no {season} kickoff instants, so the season's first kickoff cannot be derived. "
            "Run `npm run projections:context` first."
        )
    return kickoff


# --- week-one rosters and depth charts ----------------------------------------------------------

_ONE_MS = timedelta(milliseconds=1)


def week1_roster_stamp_for(conn: Connection, season: int, fetched_at: datetime) -> datetime:
    if season >= ROSTER_EARLIEST_SEASON:
        return week1_roster_as_of_bounded_by(season, fetched_at)
    if season < HISTORICAL_ROSTER_FLOOR:
        raise ResearchError(
            f"Week-one rosters are not backfilled before {HISTORICAL_ROSTER_FLOOR}; {season} is out of scope."
        )
    return require_first_kickoff_for(conn, season) - _ONE_MS


@dataclass(frozen=True)
class RosterIngestReport:
    season: int
    entries_read: int
    unknown_to_universe: int
    mode: str
    written: int


def ingest_week1_rosters(conn: Connection, client: NflverseClient, season: int, now: datetime) -> RosterIngestReport:
    """`ingestWeek1Rosters`: supersede a live season's rows, append to a past season's."""
    rows = client.get_csv(Releases.WEEKLY_ROSTERS, roster_file(season))
    as_of = week1_roster_stamp_for(conn, season, now)
    entries = map_week1_rosters(rows, season, as_of)
    known = known_player_ids(conn)
    insertable = [e for e in entries if e.player_id in known]
    kickoff = first_kickoff_for(conn, season)
    live = kickoff is not None and now < kickoff
    if live:
        if not insertable:
            raise ResearchError(
                f"{season}'s week-one roster file mapped to an empty capture, so there is nothing to supersede its "
                "stored rows with. Refusing to delete the season's rosters on the strength of an empty file."
            )
        with conn.begin_nested():
            conn.execute(delete(PRESEASON_ROSTERS).where(PRESEASON_ROSTERS.c.season == season))
            written = record_preseason_rosters(conn, insertable)
    else:
        written = record_preseason_rosters(conn, insertable)
    return RosterIngestReport(
        season, len(entries), len(entries) - len(insertable), "supersede" if live else "insert_if_absent", written
    )


def ingest_depth_charts(conn: Connection, client: NflverseClient, season: int, now: datetime) -> int:
    """`ingestDepthCharts`: the chart as of the earlier of now and the eve of the first kickoff."""
    rows = client.get_csv(Releases.DEPTH_CHARTS, f"depth_charts_{season}.csv")
    kickoff_eve = require_first_kickoff_for(conn, season) - _ONE_MS
    as_of = now if now < kickoff_eve else kickoff_eve
    mapped = map_depth_chart(rows, frozenset(all_positions(conn)), season, as_of)
    return record_observations(conn, mapped.observations)


# --- the published boards -----------------------------------------------------------------------


def roster_identities_for(conn: Connection, season: int) -> list[RosterIdentity]:
    """`rosterIdentitiesFor`: the season's roster spine, named from the universe, nameless dropped."""
    names = dict(conn.execute(select(NFL_PLAYERS.c.id, NFL_PLAYERS.c.name)).tuples().all())
    identities = [
        RosterIdentity(r.player_id, names.get(r.player_id, ""), r.position, r.team)
        for r in preseason_rosters_as_of(conn, season, FINAL)
    ]
    return [i for i in identities if i.name != ""]


def crossed_roster_identities(conn: Connection) -> list[RosterIdentity]:
    """`crossedRosterIdentities`: the provider roster, on the universe ids the crosswalk placed."""
    query = (
        select(PLAYER_CROSSWALK.c.nfl_player_id, PLAYERS.c.name, PLAYERS.c.position, PLAYERS.c.nfl_team)
        .select_from(PLAYERS.join(PLAYER_CROSSWALK, PLAYER_CROSSWALK.c.player_id == PLAYERS.c.id))
        .where(PLAYER_CROSSWALK.c.nfl_player_id.is_not(None))
    )
    return [RosterIdentity(r[0], r[1], r[2], r[3]) for r in conn.execute(query)]


def record_board(
    conn: Connection, season: int, source: str, board: PublishedBoard, identities: Sequence[RosterIdentity]
) -> int:
    resolution = resolve_rankings(board.candidates, identities)
    return record_preseason_rankings(
        conn, [RankingRow(season, source, r.player_id, r.rank, board.published_at) for r in resolution.resolved]
    )


def ingest_preseason(conn: Connection, fetcher: Fetcher, season: int, now: datetime) -> None:
    """`preseason-ingest.ts` for one season: rosters, depth chart, the three ADP formats, the ECR.
    A secondary ADP format the publisher has not posted is skipped, as the script skips it."""
    client = NflverseClient(fetcher)
    ingest_week1_rosters(conn, client, season, now)
    ingest_depth_charts(conn, client, season, now)
    if season < BENCHMARK_BOARD_FLOOR:
        return
    identities = roster_identities_for(conn, season)
    # Each board in its own savepoint and any failure a logged line, as the script catches every
    # error per board and carries on to the next (exit status 2 marks the run thin).
    for board_format, source, _snapshot, feed in BOARD_FORMATS:
        try:
            with conn.begin_nested():
                record_board(conn, season, source, fetch_average_draft_position(fetcher, season, now, feed), identities)
        except Exception as error:
            if board_format != DEFAULT_BOARD_FORMAT and _NOT_PUBLISHED.search(str(error)):
                continue
            LOG.error("%s FAILED: %s", source, error)
    try:
        with conn.begin_nested():
            record_board(conn, season, BenchmarkSource.ECR, fetch_expert_consensus(fetcher, season, now), identities)
    except Exception as error:
        LOG.error("%s FAILED: %s", BenchmarkSource.ECR, error)


_KDEF_POSITIONS = frozenset({"PK", "K", "DEF", "DST", "D/ST"})


def ingest_kdef_adp(conn: Connection, fetcher: Fetcher, season: int, now: datetime) -> int:
    """`kdef-adp-ingest.ts`: the PPR board's kickers and defenses alone, onto the roster spine."""
    board = fetch_average_draft_position(fetcher, season, now)
    candidates = [c for c in board.candidates if c.position.strip().upper() in _KDEF_POSITIONS]
    narrowed = PublishedBoard(candidates, board.published_at, board.publisher_stamp)
    return record_board(conn, season, BenchmarkSource.ADP, narrowed, roster_identities_for(conn, season))


def ingest_current_ecr(conn: Connection, fetcher: Fetcher, now: datetime, season: int = PRODUCT_SEASON) -> int:
    """`ingest-current-ecr.ts`: the live season's consensus onto the crossed provider roster."""
    identities = crossed_roster_identities(conn)
    if not identities:
        raise ResearchError("The crosswalk is empty. Run `npm run projections:crosswalk` first.")
    return record_board(conn, season, BenchmarkSource.ECR, fetch_expert_consensus(fetcher, season, now), identities)


# --- the nightly ADP capture ----------------------------------------------------------------------


@dataclass(frozen=True)
class AdpSnapshotFormat:
    format: str
    candidates_read: int
    written: int
    error: str | None


def ingest_adp_snapshot(
    conn: Connection, fetcher: Fetcher, captured_at: datetime, season: int = PRODUCT_SEASON
) -> list[AdpSnapshotFormat]:
    """`ingestAdpSnapshot`: three formats, one capture instant; only the PPR capture's failure raises."""
    identities = roster_identities_for(conn, season)
    results: list[AdpSnapshotFormat] = []
    for board_format, source, snapshot_format, feed in BOARD_FORMATS:
        try:
            board = fetch_average_draft_position(fetcher, season, captured_at, feed)
            resolution = resolve_rankings(board.candidates, identities)
            written = 0
            if resolution.resolved:
                written = insert_ignoring_conflicts(
                    conn,
                    ADP_SNAPSHOTS,
                    [
                        {
                            "player_id": r.player_id,
                            "source": source,
                            "format": snapshot_format,
                            "adp": r.rank,
                            "captured_at": captured_at,
                        }
                        for r in resolution.resolved
                    ],
                )
            results.append(AdpSnapshotFormat(board_format, len(board.candidates), written, None))
        except Exception as error:
            results.append(AdpSnapshotFormat(board_format, 0, 0, str(error)))
    primary = next(r for r in results if r.format == DEFAULT_BOARD_FORMAT)
    if primary.error is not None:
        raise ResearchError(f"adp-snapshot: the {DEFAULT_BOARD_FORMAT} capture failed ({primary.error}).")
    return results
