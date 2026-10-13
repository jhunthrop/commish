"""THE PUBLISHED BOARDS AND THE NIGHTLY ADP CAPTURE (`preseason/adp-benchmark.ts`,
`market/adp-snapshot.ts`, and the operator scripts `preseason-ingest.ts`, `kdef-adp-ingest.ts`,
`ingest-current-ecr.ts`).

THE THIN-RUN GATE. `preseason-ingest.ts` exits 2 when any board failed or resolved below
`MINIMUM_RESOLUTION` (0.7), and `ingest-current-ecr.ts` exits 2 below the same floor: "do not
publish a comparison against it without saying so". The rows are written either way. Each
function here returns a report that says whether the run was thin, and the command line turns a
thin report into exit status 2, never 0.
"""

import logging
import re
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Final

from sqlalchemy import Connection

from research.db.schema import ADP_SNAPSHOTS
from research.errors import ResearchError
from research.pipeline.http import Fetcher
from research.pipeline.nflverse.client import NflverseClient
from research.pipeline.observations import insert_ignoring_conflicts
from research.pipeline.preseason.benchmarks import (
    BENCHMARK_BOARD_FLOOR,
    BenchmarkSource,
    RosterIdentity,
    resolve_rankings,
)
from research.pipeline.preseason.ingest import (
    BOARD_FORMATS,
    DEFAULT_BOARD_FORMAT,
    PRODUCT_SEASON,
    RankingRow,
    crossed_roster_identities,
    ingest_depth_charts,
    ingest_week1_rosters,
    record_preseason_rankings,
    roster_identities_for,
)
from research.pipeline.preseason.publishers import (
    FfcAdpFormat,
    PublishedBoard,
    fetch_average_draft_position,
    fetch_expert_consensus,
)
from research.pipeline.tolerated import TOLERATED_FAILURES

LOG = logging.getLogger(__name__)
MINIMUM_RESOLUTION: Final = 0.7
_NOT_PUBLISHED = re.compile(r"published no \d{4} board")
_KDEF_POSITIONS = frozenset({"PK", "K", "DEF", "DST", "D/ST"})


@dataclass(frozen=True)
class BoardOutcome:
    source: str
    published: int
    resolved: int
    resolution_rate: float | None
    written: int


@dataclass(frozen=True)
class BoardFailure:
    source: str
    reason: str


@dataclass(frozen=True)
class BoardsReport:
    """Every board a run attempted: what landed, what failed, and whether the run was thin."""

    outcomes: tuple[BoardOutcome, ...] = ()
    failures: tuple[BoardFailure, ...] = ()

    @property
    def thin(self) -> bool:
        under = any(o.resolution_rate is not None and o.resolution_rate < MINIMUM_RESOLUTION for o in self.outcomes)
        return under or bool(self.failures)

    def merged(self, other: "BoardsReport") -> "BoardsReport":
        return BoardsReport(self.outcomes + other.outcomes, self.failures + other.failures)


def record_board(
    conn: Connection, season: int, source: str, board: PublishedBoard, identities: Sequence[RosterIdentity]
) -> BoardOutcome:
    """The script's own `ingestBenchmark`: resolve onto the spine, record what resolved."""
    resolution = resolve_rankings(board.candidates, identities)
    written = record_preseason_rankings(
        conn, [RankingRow(season, source, r.player_id, r.rank, board.published_at) for r in resolution.resolved]
    )
    return BoardOutcome(source, len(board.candidates), len(resolution.resolved), resolution.resolution_rate, written)


def _adp_boards(
    conn: Connection, fetcher: Fetcher, season: int, now: datetime, identities: Sequence[RosterIdentity]
) -> BoardsReport:
    report = BoardsReport()
    for board_format, source, _snapshot, feed in BOARD_FORMATS:
        try:
            with conn.begin_nested():
                board = fetch_average_draft_position(fetcher, season, now, feed)
                outcome = record_board(conn, season, source, board, identities)
            report = report.merged(BoardsReport(outcomes=(outcome,)))
        except TOLERATED_FAILURES as error:
            if board_format != DEFAULT_BOARD_FORMAT and _NOT_PUBLISHED.search(str(error)):
                LOG.info("%s not published upstream for %s", source, season)
                continue
            LOG.error("%s FAILED: %s", source, error)
            report = report.merged(BoardsReport(failures=(BoardFailure(source, str(error)),)))
    return report


def ingest_preseason(conn: Connection, fetcher: Fetcher, season: int, now: datetime) -> BoardsReport:
    """`preseason-ingest.ts` for one season: rosters, depth chart, the three ADP formats, the ECR."""
    client = NflverseClient(fetcher)
    ingest_week1_rosters(conn, client, season, now)
    ingest_depth_charts(conn, client, season, now)
    if season < BENCHMARK_BOARD_FLOOR:
        return BoardsReport()
    identities = roster_identities_for(conn, season)
    report = _adp_boards(conn, fetcher, season, now, identities)
    try:
        with conn.begin_nested():
            outcome = record_board(
                conn, season, BenchmarkSource.ECR, fetch_expert_consensus(fetcher, season, now), identities
            )
        return report.merged(BoardsReport(outcomes=(outcome,)))
    except TOLERATED_FAILURES as error:
        LOG.error("%s FAILED: %s", BenchmarkSource.ECR, error)
        return report.merged(BoardsReport(failures=(BoardFailure(BenchmarkSource.ECR, str(error)),)))


def ingest_kdef_adp(conn: Connection, fetcher: Fetcher, season: int, now: datetime) -> BoardOutcome:
    """`kdef-adp-ingest.ts`: the PPR board's kickers and defenses alone, onto the roster spine."""
    board = fetch_average_draft_position(fetcher, season, now)
    candidates = [c for c in board.candidates if c.position.strip().upper() in _KDEF_POSITIONS]
    narrowed = PublishedBoard(candidates, board.published_at, board.publisher_stamp)
    return record_board(conn, season, BenchmarkSource.ADP, narrowed, roster_identities_for(conn, season))


def ingest_current_ecr(conn: Connection, fetcher: Fetcher, now: datetime, season: int = PRODUCT_SEASON) -> BoardsReport:
    """`ingest-current-ecr.ts`: the live season's consensus onto the crossed provider roster."""
    identities = crossed_roster_identities(conn)
    if not identities:
        raise ResearchError("The crosswalk is empty. Run `npm run projections:crosswalk` first.")
    outcome = record_board(conn, season, BenchmarkSource.ECR, fetch_expert_consensus(fetcher, season, now), identities)
    return BoardsReport(outcomes=(outcome,))


@dataclass(frozen=True)
class AdpSnapshotFormat:
    format: str
    candidates_read: int
    written: int
    error: str | None


@dataclass(frozen=True)
class SnapshotPass:
    """One fire of the ADP snapshot: the season, the instant every format is stamped with, and the
    roster identities each board resolves against."""

    season: int
    captured_at: datetime
    identities: Sequence[RosterIdentity]


def _capture_format(
    conn: Connection, fetcher: Fetcher, snapshot: SnapshotPass, spec: tuple[str, str, str, FfcAdpFormat]
) -> AdpSnapshotFormat:
    season, captured_at, identities = snapshot.season, snapshot.captured_at, snapshot.identities
    board_format, source, snapshot_format, feed = spec
    board = fetch_average_draft_position(fetcher, season, captured_at, feed)
    resolution = resolve_rankings(board.candidates, identities)
    rows = [
        {
            "player_id": r.player_id,
            "source": source,
            "format": snapshot_format,
            "adp": r.rank,
            "captured_at": captured_at,
        }
        for r in resolution.resolved
    ]
    written = insert_ignoring_conflicts(conn, ADP_SNAPSHOTS, rows) if rows else 0
    return AdpSnapshotFormat(board_format, len(board.candidates), written, None)


def ingest_adp_snapshot(
    conn: Connection, fetcher: Fetcher, captured_at: datetime, season: int = PRODUCT_SEASON
) -> list[AdpSnapshotFormat]:
    """`ingestAdpSnapshot`: three formats at one instant, each in its own savepoint; only the PPR
    capture's failure raises, a secondary format's is a detail line."""
    snapshot = SnapshotPass(season, captured_at, roster_identities_for(conn, season))
    results: list[AdpSnapshotFormat] = []
    for spec in BOARD_FORMATS:
        try:
            with conn.begin_nested():
                results.append(_capture_format(conn, fetcher, snapshot, spec))
        except TOLERATED_FAILURES as error:
            results.append(AdpSnapshotFormat(spec[0], 0, 0, str(error)))
    primary = next(r for r in results if r.format == DEFAULT_BOARD_FORMAT)
    if primary.error is not None:
        raise ResearchError(f"adp-snapshot: the {DEFAULT_BOARD_FORMAT} capture failed ({primary.error}).")
    return results
