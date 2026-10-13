"""The play-by-play cases: `projection-context.ts`'s sequence (schedule, play-by-play, the coaches
seed and coach observations, the opponent adjustment) and the gap-season derived stat lines."""

from collections.abc import Mapping

from sqlalchemy import Connection

from research.parity.case import Case, Recording, RunContext, Script
from research.parity.cases.nflverse_season import NOW
from research.parity.cases.nflverse_sources import release_url
from research.parity.cases.steps import cli, universe
from research.parity.cases.tables import (
    COACHES,
    NFLVERSE_INJURIES,
    NFLVERSE_ROSTER_WEEKS,
    PLAYER_WEEK_OBSERVATIONS,
    TEAM_WEEK_OBSERVATIONS,
)
from research.parity.record import RecordSpec
from research.pipeline.http import Fetcher
from research.pipeline.nflverse.client import NflverseClient
from research.pipeline.nflverse.config import Releases
from research.pipeline.nflverse.derived_stat_lines import ingest_derived_stat_lines

CONTEXT_SEASONS = (2023, 2024)
PBP_TEAMS = frozenset({"BUF", "KC"})


def _game_of(row: Mapping[str, str]) -> bool:
    return row.get("home_team") in PBP_TEAMS or row.get("away_team") in PBP_TEAMS


def _pbp_specs(seasons: tuple[int, ...]) -> "PbpSpecs":
    return PbpSpecs(seasons)


class PbpSpecs:
    def __init__(self, seasons: tuple[int, ...]) -> None:
        self._seasons = seasons

    def __call__(self, _fetcher: Fetcher) -> list[RecordSpec]:
        return [
            RecordSpec(
                url=release_url(Releases.PBP, f"play_by_play_{season}.csv"),
                file=f"play_by_play_{season}.csv.gz",
                row_filter=_game_of,
                filtered=f"every play of every game {' or '.join(sorted(PBP_TEAMS))} played in, home or away "
                "(whole games, so drive pace and both sides of each defence are intact)",
            )
            for season in self._seasons
        ]


PBP_CONTEXT = Recording(
    fixture_set="nflverse-pbp-2023-2024",
    specs=_pbp_specs(CONTEXT_SEASONS),
    note="Play-by-play for 2023 and 2024, every game two clubs played, every column as published.",
)
PBP_GAP = Recording(
    fixture_set="nflverse-pbp-2025",
    specs=_pbp_specs((2025,)),
    note="Play-by-play for 2025 (a gap season: no published weekly stats), every game two clubs played.",
)


def _coaches_seed(conn: Connection, ctx: RunContext) -> tuple[int, ...]:
    """`coaches-ingest.ts`."""
    return (cli(conn, ctx, ["coaches"]),)


def _context(conn: Connection, ctx: RunContext) -> tuple[int, ...]:
    """The universe, then `coaches-ingest.ts` and `projection-context.ts 2024 2025`."""
    universe(conn, ctx)
    return (cli(conn, ctx, ["coaches"]), cli(conn, ctx, ["context", "--first", "2024", "--last", "2025"]))


def _derived(conn: Connection, ctx: RunContext) -> tuple[int, ...]:
    universe(conn, ctx)
    ingest_derived_stat_lines(conn, NflverseClient(ctx.fetcher), 2025)
    return ()


CONTEXT_SETS = (
    "nflverse-universe",
    "nflverse-schedule",
    "nflverse-pbp-2023-2024",
    "nflverse-pbp-2025",
    "nflverse-injuries-2024-2025",
    "nflverse-rosters-2024-2025",
)

CASES: tuple[Case, ...] = (
    Case(
        name="coaches-seed",
        summary="coaches-ingest.ts run as is: the committed play-caller CSV, validated whole, into coaches",
        fixture_sets=(),
        tables=(COACHES,),
        run_python=_coaches_seed,
        now=NOW,
        ts_scripts=(Script("research-ts/scripts/coaches-ingest.ts"),),
    ),
    Case(
        name="nflverse-context",
        summary="projection-context.ts run as is for 2024-2025: schedule, play-by-play, coach observations, "
        "opponent adjustment, injury features, injury archive, weekly rosters",
        fixture_sets=CONTEXT_SETS,
        tables=(
            TEAM_WEEK_OBSERVATIONS,
            PLAYER_WEEK_OBSERVATIONS,
            NFLVERSE_INJURIES,
            NFLVERSE_ROSTER_WEEKS,
            COACHES.as_setup(),
        ),
        run_python=_context,
        now=NOW,
        recordings=(PBP_CONTEXT,),
        ts_scripts=(
            Script("research-ts/scripts/coaches-ingest.ts"),
            Script("research-ts/scripts/projection-context.ts", ("2024", "2025")),
        ),
    ),
    Case(
        name="nflverse-derived-stat-lines",
        summary="the gap season's stat lines derived from play-by-play (self-superseding), 2025",
        fixture_sets=("nflverse-universe", "nflverse-pbp-2025"),
        tables=(PLAYER_WEEK_OBSERVATIONS,),
        run_python=_derived,
        now=NOW,
        recordings=(PBP_GAP,),
    ),
)
