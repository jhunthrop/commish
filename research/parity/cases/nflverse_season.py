"""The universe and one-season cases: the season-week job's stats-ingest step, three shapes of season:
the season's lines, then its game results (`season_stats`, Lane 78), as the step and the `season`
command write them.

2024 is the ordinary shape (snap counts and weekly stats both published). 2012 sits below the
snap-count asset floor (a header-only snap-count file, weekly stats published), so its stat lines
and team edges are dated from the schedule. 2025 is a gap season (weekly stats a recorded 404,
snap counts published), so the weekly-file participation metrics are withheld.
"""

from datetime import UTC, datetime

from sqlalchemy import Connection

from research.parity.case import Case, Recording, RunContext
from research.parity.cases.nflverse_sources import SCHEDULE_URL, TeamFilter, release_url
from research.parity.cases.tables import (
    PLAYER_WEEK_OBSERVATIONS,
    PLAYER_WEEK_TEAMS,
    PLAYERS,
    TEAM_WEEK_OBSERVATIONS,
)
from research.parity.record import RecordSpec
from research.pipeline.http import Fetcher
from research.pipeline.nflverse.client import NflverseClient
from research.pipeline.nflverse.config import Files, Releases
from research.pipeline.nflverse.ingest import ingest_player_universe, schedule_week_as_of
from research.pipeline.nflverse.season_stats import ingest_season_and_results

NOW = datetime(2026, 10, 12, 5, 0, tzinfo=UTC)

UNIVERSE = Recording(
    fixture_set="nflverse-universe",
    specs=lambda _fetcher: [RecordSpec(url=release_url(Releases.PLAYERS, Files.PLAYERS), file="players.csv.gz")],
    note="The whole nflverse players release, unfiltered: every person back to 1999. The universe decides "
    "who resolves in every nflverse case, so a slice here would change resolution everywhere downstream.",
)

SCHEDULE = Recording(
    fixture_set="nflverse-schedule",
    specs=lambda _fetcher: [RecordSpec(url=SCHEDULE_URL, file="games.csv.gz")],
    note="nflverse/nfldata's games.csv, unfiltered: every game back to 1999.",
)


def _season_recording(season: int, snap_filter: TeamFilter | None, week_filter: TeamFilter | None) -> Recording:
    def specs(_fetcher: Fetcher) -> list[RecordSpec]:
        return [
            RecordSpec(
                url=release_url(Releases.SNAP_COUNTS, f"snap_counts_{season}.csv"),
                file=f"snap_counts_{season}.csv.gz",
                row_filter=snap_filter,
                filtered=snap_filter.describe() if snap_filter else "the whole response, unfiltered",
            ),
            RecordSpec(
                url=release_url(Releases.PLAYER_WEEK, f"stats_player_week_{season}.csv"),
                file=f"stats_player_week_{season}.csv.gz",
                row_filter=week_filter,
                filtered=week_filter.describe() if week_filter else "the whole response, unfiltered",
            ),
        ]

    return Recording(
        fixture_set=f"nflverse-season-{season}",
        specs=specs,
        note=f"The {season} snap-count and weekly-stats assets as the release serves them (a 404 is recorded "
        "as a 404).",
    )


PRIOR = "nflverse-2026-08-27-slices"


class SeasonRunner:
    """`realIngestStats` and `ingestGameResults` for the season (the season-week job's stats step): the
    universe, the schedule's week stamps, then the season's lines and its results."""

    def __init__(self, season: int) -> None:
        self.season = season

    def __call__(self, conn: Connection, ctx: RunContext) -> tuple[int, ...]:
        client = NflverseClient(ctx.fetcher)
        universe = ingest_player_universe(conn, client)
        schedule_as_of = schedule_week_as_of(client, [self.season]).get(self.season)
        # The oracle's release tag, so both sides read the same recording (`player_week_release`),
        # and no completions, which the oracle never wrote.
        ingest_season_and_results(
            conn, client, universe, self.season, schedule_as_of, release=Releases.PLAYER_WEEK, completions=False
        )
        return ()


def _universe_only(conn: Connection, ctx: RunContext) -> tuple[int, ...]:
    ingest_player_universe(conn, NflverseClient(ctx.fetcher))
    return ()


SEASON_TABLES = (PLAYERS.as_setup(), PLAYER_WEEK_OBSERVATIONS, PLAYER_WEEK_TEAMS, TEAM_WEEK_OBSERVATIONS)

CASES: tuple[Case, ...] = (
    Case(
        name="nflverse-universe",
        summary="nflverse players release to players (the universe upsert, moved ids released first)",
        fixture_sets=("nflverse-universe",),
        tables=(PLAYERS,),
        run_python=_universe_only,
        now=NOW,
        recordings=(UNIVERSE,),
        prior_fixture_sets=(PRIOR,),
    ),
    Case(
        name="nflverse-season-2024",
        summary="the season-week stats ingest for an ordinary season (snap counts and weekly stats)",
        fixture_sets=("nflverse-universe", "nflverse-schedule", "nflverse-season-2024"),
        tables=SEASON_TABLES,
        run_python=SeasonRunner(2024),
        now=NOW,
        recordings=(_season_recording(2024, None, None),),
        prior_fixture_sets=(PRIOR, "nflverse-schedule"),
    ),
    Case(
        name="nflverse-season-2012",
        summary="a season below the snap-count floor: stat lines and team edges dated from the schedule "
        "(no line continuity: there are no snap counts to take it from)",
        fixture_sets=("nflverse-universe", "nflverse-schedule", "nflverse-season-2012"),
        tables=SEASON_TABLES[:3],
        run_python=SeasonRunner(2012),
        now=NOW,
        recordings=(_season_recording(2012, None, TeamFilter(("team",))),),
    ),
    Case(
        name="nflverse-season-2025",
        summary="a gap season: weekly stats unpublished, weekly-file participation withheld",
        fixture_sets=("nflverse-universe", "nflverse-schedule", "nflverse-season-2025"),
        tables=SEASON_TABLES,
        run_python=SeasonRunner(2025),
        now=NOW,
        recordings=(_season_recording(2025, TeamFilter(("team",)), None),),
    ),
)

ALSO_RECORDED: tuple[Recording, ...] = (SCHEDULE,)
