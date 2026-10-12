"""The schedule, injury, roster, draft and kicker/defense cases: `projection-context.ts`,
`draft-picks-ingest.ts`, `schedule-results-ingest.ts`, `schedule-points-allowed-ingest.ts` and
`kdef-backfill.ts`, each over recorded releases."""

from collections.abc import Callable

from sqlalchemy import Connection

from research.parity.case import Case, Recording, RunContext
from research.parity.cases.nflverse_season import NOW, SCHEDULE
from research.parity.cases.nflverse_sources import SLICE_TEAMS, TeamFilter, release_url
from research.parity.cases.tables import (
    NFL_DRAFT_PICKS,
    NFL_PLAYERS,
    NFLVERSE_INJURIES,
    NFLVERSE_KICKING_WEEKS,
    NFLVERSE_ROSTER_WEEKS,
    NFLVERSE_TEAM_DEFENSE_WEEKS,
    PLAYER_WEEK_OBSERVATIONS,
    TEAM_WEEK_OBSERVATIONS,
)
from research.parity.record import RecordSpec
from research.pipeline.crosswalk import seed_team_defense_universe
from research.pipeline.http import Fetcher
from research.pipeline.nflverse.client import NflverseClient
from research.pipeline.nflverse.config import Files, Releases
from research.pipeline.nflverse.draft_picks import ingest_draft_picks
from research.pipeline.nflverse.ingest import ingest_player_universe, schedule_client
from research.pipeline.nflverse.ingest_schedule import ingest_game_results, ingest_points_allowed, ingest_schedule
from research.pipeline.nflverse.injury_archive import ingest_injuries
from research.pipeline.nflverse.injury_reports import ingest_injury_reports
from research.pipeline.nflverse.kicking_weeks import ingest_kicking_weeks
from research.pipeline.nflverse.roster_weeks import ingest_roster_weeks
from research.pipeline.nflverse.team_defense_weeks import ingest_team_defense_weeks

CONTEXT_SEASONS = (2024, 2025)
SCHEDULE_SEASONS = (2023, 2024, 2025, 2026)
KDEF_SEASONS = (2024, 2025)

Step = Callable[[Connection, RunContext], None]


def _after_universe(step: Step) -> Step:
    def run(conn: Connection, ctx: RunContext) -> None:
        ingest_player_universe(conn, NflverseClient(ctx.fetcher))
        step(conn, ctx)

    return run


def _kicker_or_slice(row: object) -> bool:
    assert isinstance(row, dict)
    return row.get("position") == "K" or row.get("team") in SLICE_TEAMS


INJURIES = Recording(
    fixture_set="nflverse-injuries-2024-2025",
    specs=lambda _f: [
        RecordSpec(url=release_url(Releases.INJURIES, f"injuries_{s}.csv"), file=f"injuries_{s}.csv.gz")
        for s in CONTEXT_SEASONS
    ],
    note="The official injury report for 2024 (the stamped shape) and 2025 (the shape with no date_modified "
    "column), both unfiltered.",
)

ROSTERS = Recording(
    fixture_set="nflverse-rosters-2024-2025",
    specs=lambda _f: [
        RecordSpec(
            url=release_url(Releases.WEEKLY_ROSTERS, f"roster_weekly_{s}.csv"),
            file=f"roster_weekly_{s}.csv.gz",
            row_filter=TeamFilter(("team",)),
            filtered=TeamFilter(("team",)).describe(),
        )
        for s in CONTEXT_SEASONS
    ],
    note="The weekly roster release for 2024 and 2025, narrowed to four clubs' every row (every status a club's "
    "roster emits, every week).",
)

DRAFT_PICKS = Recording(
    fixture_set="nflverse-draft-picks",
    specs=lambda _f: [RecordSpec(url=release_url(Releases.DRAFT_PICKS, Files.DRAFT_PICKS), file="draft_picks.csv.gz")],
    note="Every NFL draft pick, the whole release, unfiltered (the blank-gsis rows it really carries included).",
)


def _kdef_specs(_fetcher: Fetcher) -> list[RecordSpec]:
    specs = [
        RecordSpec(
            url=release_url(Releases.STATS_PLAYER, f"stats_player_week_{s}.csv"),
            file=f"stats_player_week_{s}.csv.gz",
            row_filter=_kicker_or_slice,
            filtered=f"rows whose position is K, plus every row whose team is one of {', '.join(sorted(SLICE_TEAMS))} "
            "(so the kicker filter has non-kickers to refuse)",
        )
        for s in KDEF_SEASONS
    ]
    specs += [
        RecordSpec(url=release_url(Releases.STATS_TEAM, f"stats_team_week_{s}.csv"), file=f"stats_team_week_{s}.csv.gz")
        for s in KDEF_SEASONS
    ]
    return specs


KDEF = Recording(
    fixture_set="nflverse-kdef-2024-2025",
    specs=_kdef_specs,
    note="The modern per-player and per-team weekly releases for 2024 and 2025: the team file whole, the player "
    "file narrowed to every kicker plus four clubs.",
)


def _schedule_step(ingest: Callable[[Connection, NflverseClient, tuple[int, ...]], int]) -> Step:
    def run(conn: Connection, ctx: RunContext) -> None:
        ingest(conn, NflverseClient(ctx.fetcher), SCHEDULE_SEASONS)

    return run


def _injury_reports(conn: Connection, ctx: RunContext) -> None:
    ingest_injury_reports(conn, NflverseClient(ctx.fetcher), CONTEXT_SEASONS)


def _injury_archive(conn: Connection, ctx: RunContext) -> None:
    ingest_injuries(conn, NflverseClient(ctx.fetcher), CONTEXT_SEASONS)


def _roster_weeks(conn: Connection, ctx: RunContext) -> None:
    ingest_roster_weeks(conn, NflverseClient(ctx.fetcher), CONTEXT_SEASONS)


def _draft_picks(conn: Connection, ctx: RunContext) -> None:
    ingest_draft_picks(conn, NflverseClient(ctx.fetcher))


def _kdef(conn: Connection, ctx: RunContext) -> None:
    client = NflverseClient(ctx.fetcher)
    seed_team_defense_universe(conn)
    ingest_kicking_weeks(conn, client, KDEF_SEASONS)
    ingest_team_defense_weeks(conn, client, KDEF_SEASONS, schedule_client(client))


UNIVERSE_SET = "nflverse-universe"

CASES: tuple[Case, ...] = (
    Case(
        name="nflverse-schedule",
        summary="games.csv into team_week_observations for 2023-2026 (both source stamps, unplayed 2026 games)",
        fixture_sets=("nflverse-schedule",),
        tables=(TEAM_WEEK_OBSERVATIONS,),
        run_python=_schedule_step(ingest_schedule),
        now=NOW,
        recordings=(SCHEDULE,),
    ),
    Case(
        name="nflverse-game-results",
        summary="the game-result rows alone (ingestGameResults), 2023-2026",
        fixture_sets=("nflverse-schedule",),
        tables=(TEAM_WEEK_OBSERVATIONS,),
        run_python=_schedule_step(ingest_game_results),
        now=NOW,
    ),
    Case(
        name="nflverse-points-allowed",
        summary="the points-allowed rows alone (ingestPointsAllowed), 2023-2026",
        fixture_sets=("nflverse-schedule",),
        tables=(TEAM_WEEK_OBSERVATIONS,),
        run_python=_schedule_step(ingest_points_allowed),
        now=NOW,
    ),
    Case(
        name="nflverse-injury-reports",
        summary="the injury report as ordinal features (2024 stamped, 2025 unstamped and withheld)",
        fixture_sets=(UNIVERSE_SET, "nflverse-injuries-2024-2025"),
        tables=(NFL_PLAYERS, PLAYER_WEEK_OBSERVATIONS),
        run_python=_after_universe(_injury_reports),
        now=NOW,
        recordings=(INJURIES,),
    ),
    Case(
        name="nflverse-injury-archive",
        summary="the injury report archived verbatim into nflverse_injuries (both published shapes)",
        fixture_sets=(UNIVERSE_SET, "nflverse-injuries-2024-2025"),
        tables=(NFLVERSE_INJURIES,),
        run_python=_after_universe(_injury_archive),
        now=NOW,
    ),
    Case(
        name="nflverse-roster-weeks",
        summary="the weekly roster release archived into nflverse_roster_weeks, 2024-2025",
        fixture_sets=(UNIVERSE_SET, "nflverse-rosters-2024-2025"),
        tables=(NFLVERSE_ROSTER_WEEKS,),
        run_python=_after_universe(_roster_weeks),
        now=NOW,
        recordings=(ROSTERS,),
    ),
    Case(
        name="nflverse-draft-picks",
        summary="every draft pick into nfl_draft_picks, filtered to the universe",
        fixture_sets=(UNIVERSE_SET, "nflverse-draft-picks"),
        tables=(NFL_DRAFT_PICKS,),
        run_python=_after_universe(_draft_picks),
        now=NOW,
        recordings=(DRAFT_PICKS,),
    ),
    Case(
        name="nflverse-kdef",
        summary="kdef-backfill: 32 synthetic defenses, kicking weeks and team defense weeks, 2024-2025",
        fixture_sets=(UNIVERSE_SET, "nflverse-schedule", "nflverse-kdef-2024-2025"),
        tables=(NFL_PLAYERS, NFLVERSE_KICKING_WEEKS, NFLVERSE_TEAM_DEFENSE_WEEKS),
        run_python=_after_universe(_kdef),
        now=NOW,
        recordings=(KDEF,),
    ),
)
