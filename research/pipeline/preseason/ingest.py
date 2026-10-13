"""THE PRESEASON STORE AND THE WEEK-ONE INGESTS (`preseason/{ingest,store,current}.ts`). The
published boards, the thin-run gate and the nightly ADP capture are in `boards.py`.

Week-one rosters into `preseason_rosters` (a LIVE season's capture supersedes the season's stored
rows in one transaction; a past season only appends what is absent), the week-one depth chart into
`player_week_observations`, and the store's reads the boards resolve against.
"""

import logging
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from sqlalchemy import Connection, delete, select, text

from research.db.schema import (
    PLAYER_CROSSWALK,
    PLAYERS,
    PRESEASON_RANKINGS,
    PRESEASON_ROSTERS,
    PROVIDER_PLAYERS,
    TEAM_WEEK_OBSERVATIONS,
)
from research.errors import ResearchError
from research.pipeline.nflverse.client import NflverseClient
from research.pipeline.nflverse.config import Releases
from research.pipeline.nflverse.schedule import ScheduleMetric, ScheduleSource
from research.pipeline.nflverse.universe_reads import all_positions, known_player_ids
from research.pipeline.observations import insert_ignoring_conflicts, record_observations
from research.pipeline.preseason.benchmarks import (
    BenchmarkSource,
    RosterIdentity,
)
from research.pipeline.preseason.publishers import (
    FfcAdpFormat,
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
FINAL = datetime(9999, 12, 31, tzinfo=UTC)

# Each board format: (format, ADP source, snapshot format, feed format).
BOARD_FORMATS: tuple[tuple[str, str, str, FfcAdpFormat], ...] = (
    ("ppr", BenchmarkSource.ADP, "ppr_12", "ppr"),
    ("half", BenchmarkSource.ADP_HALF, "half_12", "half-ppr"),
    ("std", BenchmarkSource.ADP_STD, "std_12", "standard"),
)
DEFAULT_BOARD_FORMAT = "ppr"
# The superflex board's market: Fantasy Football Calculator's two-quarterback drafts, captured by the
# nightly beside the three above (`ingest_superflex_adp_snapshot`). Kept out of BOARD_FORMATS, which
# is the oracle's three and what the parity cases prove; the oracle never captured it.
SUPERFLEX_ADP_SNAPSHOT: tuple[str, str, str, FfcAdpFormat] = ("superflex", "ffc_adp_2qb_12", "2qb_12", "2qb")


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
            f"select distinct on (player_id) player_id, team, position, status from {PRESEASON_ROSTERS.fullname} "
            "where season = :season and as_of <= :as_of order by player_id asc, as_of desc"
        ),
        {"season": season, "as_of": as_of},
    )
    return [StoredRoster(r.player_id, r.team, r.position, r.status) for r in rows]


def first_kickoff_for(conn: Connection, season: int) -> datetime | None:
    """`firstKickoffFor`: the earliest week-one kickoff instant the schedule stored."""
    return conn.execute(
        text(
            f"select min(as_of) from {TEAM_WEEK_OBSERVATIONS.fullname} where season = :season and week = 1 "
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
    names = dict(conn.execute(select(PLAYERS.c.id, PLAYERS.c.name)).tuples().all())
    identities = [
        RosterIdentity(r.player_id, names.get(r.player_id, ""), r.position, r.team)
        for r in preseason_rosters_as_of(conn, season, FINAL)
    ]
    return [i for i in identities if i.name != ""]


def crossed_roster_identities(conn: Connection) -> list[RosterIdentity]:
    """`crossedRosterIdentities`: the provider roster, on the universe ids the crosswalk placed."""
    query = (
        select(
            PLAYER_CROSSWALK.c.player_id, PROVIDER_PLAYERS.c.name, PROVIDER_PLAYERS.c.position, PROVIDER_PLAYERS.c.team
        )
        .select_from(
            PROVIDER_PLAYERS.join(PLAYER_CROSSWALK, PLAYER_CROSSWALK.c.provider_player_id == PROVIDER_PLAYERS.c.id)
        )
        .where(PLAYER_CROSSWALK.c.player_id.is_not(None))
    )
    return [RosterIdentity(r[0], r[1], r[2], r[3]) for r in conn.execute(query)]
