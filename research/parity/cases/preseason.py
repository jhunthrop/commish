"""The preseason cases (each starting from the universe with its 32 synthetic defenses seeded, as
production has had since the kicker and defense backfill): `preseason-ingest.ts` for a past season (append) and for a live one (the
roster supersedes), `kdef-adp-ingest.ts`, the nightly ADP capture in three formats, and
`ingest-current-ecr.ts` onto the crossed provider roster."""

from datetime import UTC, datetime
from types import MappingProxyType

from sqlalchemy import Connection

from research.parity.case import Case, Recording, RunContext, Script
from research.parity.cases.nflverse_season import NOW
from research.parity.cases.nflverse_sources import TeamFilter, release_url
from research.parity.cases.steps import cli, schedule, universe_with_defenses
from research.parity.cases.tables import (
    ADP_SNAPSHOTS,
    PLAYER_CROSSWALK,
    PLAYER_WEEK_OBSERVATIONS,
    PRESEASON_RANKINGS,
    PRESEASON_ROSTERS,
)
from research.parity.cases.tank01 import _provider, crosswalk_script
from research.parity.record import RecordSpec
from research.pipeline.http import Fetcher
from research.pipeline.nflverse.client import NflverseClient
from research.pipeline.nflverse.config import Releases
from research.pipeline.preseason.boards import ingest_adp_snapshot
from research.pipeline.preseason.ingest import BOARD_FORMATS, ingest_week1_rosters
from research.pipeline.preseason.publishers import ecr_url, ffc_adp_url
from research.pipeline.preseason.rosters import roster_file
from research.pipeline.tank01.ingest import ingest_roster_and_lines

# Before the 2026 opener: the week-one roster is a live season's, and supersedes.
PRESEASON_NOW = datetime(2026, 8, 20, 12, 0, tzinfo=UTC)
_ECR_HEADERS = MappingProxyType({"user-agent": "commish-projection-engine/1.0"})


def _board_specs(season: int) -> list[RecordSpec]:
    specs = [
        RecordSpec(url=ffc_adp_url(season, feed), file=f"ffc_{feed}_{season}.json.gz") for *_, feed in BOARD_FORMATS
    ]
    specs.append(
        RecordSpec(url=ecr_url(season), file=f"fantasypros_ecr_{season}.html.gz", request_headers=_ECR_HEADERS)
    )
    return specs


def _season_specs(season: int) -> "SeasonSpecs":
    return SeasonSpecs(season)


class SeasonSpecs:
    def __init__(self, season: int) -> None:
        self._season = season

    def __call__(self, _fetcher: Fetcher) -> list[RecordSpec]:
        teams = TeamFilter(("team",))
        return [
            RecordSpec(
                url=release_url(Releases.WEEKLY_ROSTERS, roster_file(self._season)),
                file=f"roster_weekly_{self._season}.csv.gz",
                row_filter=teams,
                filtered=teams.describe(),
            ),
            RecordSpec(
                url=release_url(Releases.DEPTH_CHARTS, f"depth_charts_{self._season}.csv"),
                file=f"depth_charts_{self._season}.csv.gz",
                row_filter=teams,
                filtered=teams.describe(),
            ),
            *_board_specs(self._season),
        ]


def _recording(season: int) -> Recording:
    return Recording(
        fixture_set=f"preseason-{season}",
        specs=_season_specs(season),
        note=f"{season}: the weekly roster and depth chart releases narrowed to four clubs, Fantasy Football "
        "Calculator's ADP in all three formats, and FantasyPros' PPR cheat-sheet page, as served.",
    )


class PreseasonRun:
    """The universe with its defenses and the season's schedule (the store a production run
    starts from), then `preseason-ingest.ts <season> <season>` and, when asked,
    `kdef-adp-ingest.ts <season>`, each with its exit status."""

    def __init__(self, season: int, kdef: bool) -> None:
        self._season = season
        self._kdef = kdef

    def __call__(self, conn: Connection, ctx: RunContext) -> tuple[int, ...]:
        universe_with_defenses(conn, ctx)
        schedule(conn, ctx, [self._season])
        season = str(self._season)
        statuses = [cli(conn, ctx, ["preseason", "--first", season, "--last", season])]
        if self._kdef:
            statuses.append(cli(conn, ctx, ["kdef-adp", "--first", season, "--last", season]))
        return tuple(statuses)


def _adp_snapshot(conn: Connection, ctx: RunContext) -> tuple[int, ...]:
    universe_with_defenses(conn, ctx)
    schedule(conn, ctx, [2026])
    ingest_week1_rosters(conn, NflverseClient(ctx.fetcher), 2026, ctx.now)
    ingest_adp_snapshot(conn, ctx.fetcher, ctx.now)
    return ()


def _current_ecr(conn: Connection, ctx: RunContext) -> tuple[int, ...]:
    """The provider seed, then `build-crosswalk.ts` and `ingest-current-ecr.ts 2026`."""
    ingest_roster_and_lines(conn, _provider(ctx, 0))
    return (crosswalk_script(conn, ctx), cli(conn, ctx, ["current-ecr"]))


BASE = ("nflverse-universe", "nflverse-schedule")

CASES: tuple[Case, ...] = (
    Case(
        name="preseason-2025",
        summary="preseason-ingest.ts and kdef-adp-ingest.ts run as is for a past season: rosters appended, "
        "depth chart, ADP x3, ECR, the thin gate",
        fixture_sets=(*BASE, "preseason-2025"),
        tables=(PRESEASON_ROSTERS, PLAYER_WEEK_OBSERVATIONS, PRESEASON_RANKINGS),
        run_python=PreseasonRun(2025, kdef=True),
        now=NOW,
        recordings=(_recording(2025),),
        ts_scripts=(
            Script("research-ts/scripts/preseason-ingest.ts", ("2025", "2025")),
            Script("research-ts/scripts/kdef-adp-ingest.ts", ("2025",)),
        ),
    ),
    Case(
        name="preseason-2026-live",
        summary="preseason-ingest.ts run as is before the 2026 opener: the live roster supersedes (the rerun "
        "pass supersedes stored rows), the dated depth chart, the thin gate",
        fixture_sets=(*BASE, "preseason-2026"),
        tables=(PRESEASON_ROSTERS, PLAYER_WEEK_OBSERVATIONS, PRESEASON_RANKINGS),
        run_python=PreseasonRun(2026, kdef=False),
        now=PRESEASON_NOW,
        recordings=(_recording(2026),),
        ts_scripts=(Script("research-ts/scripts/preseason-ingest.ts", ("2026", "2026")),),
    ),
    Case(
        name="adp-snapshot",
        summary="the nightly ADP capture, three formats at one instant, into adp_snapshots",
        fixture_sets=(*BASE, "preseason-2026"),
        tables=(PRESEASON_ROSTERS.as_setup(), ADP_SNAPSHOTS),
        run_python=_adp_snapshot,
        now=NOW,
    ),
    Case(
        name="current-ecr",
        summary="build-crosswalk.ts and ingest-current-ecr.ts run as is: the 2026 consensus onto the crossed roster",
        fixture_sets=("nflverse-universe", "tank01-2026", "preseason-2026"),
        tables=(PLAYER_CROSSWALK.as_setup(), PRESEASON_RANKINGS),
        run_python=_current_ecr,
        now=NOW,
        ts_scripts=(
            Script("research-ts/scripts/build-crosswalk.ts"),
            Script("research-ts/scripts/ingest-current-ecr.ts", ("2026",)),
        ),
    ),
)
