"""The play-by-play cases: `projection-context.ts`'s sequence (schedule, play-by-play, the coaches
seed and coach observations, the opponent adjustment) and the gap-season derived stat lines."""

from collections.abc import Mapping

from sqlalchemy import Connection

from research.parity.case import Case, Recording, RunContext
from research.parity.cases.nflverse_season import NOW
from research.parity.cases.nflverse_sources import release_url
from research.parity.cases.tables import (
    COACHES,
    PLAYER_WEEK_OBSERVATIONS,
    TEAM_WEEK_OBSERVATIONS,
)
from research.parity.databases import REPO_ROOT
from research.parity.record import RecordSpec
from research.pipeline.coaches import PLAY_CALLERS_CSV_PATH, ingest_play_callers_csv
from research.pipeline.http import Fetcher
from research.pipeline.nflverse.client import NflverseClient
from research.pipeline.nflverse.config import Releases
from research.pipeline.nflverse.context import ingest_coaches, ingest_opponent_defence, ingest_play_by_play
from research.pipeline.nflverse.derived_stat_lines import ingest_derived_stat_lines
from research.pipeline.nflverse.ingest import ingest_player_universe
from research.pipeline.nflverse.ingest_schedule import ingest_schedule

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


def _coaches_seed(conn: Connection, _ctx: RunContext) -> None:
    ingest_play_callers_csv(conn, REPO_ROOT / PLAY_CALLERS_CSV_PATH)


def _context(conn: Connection, ctx: RunContext) -> None:
    client = NflverseClient(ctx.fetcher)
    ingest_player_universe(conn, client)
    ingest_play_callers_csv(conn, REPO_ROOT / PLAY_CALLERS_CSV_PATH)
    ingest_schedule(conn, client, CONTEXT_SEASONS)
    for season in CONTEXT_SEASONS:
        ingest_play_by_play(conn, client, season)
    ingest_coaches(conn, client, CONTEXT_SEASONS)
    ingest_opponent_defence(conn, client, CONTEXT_SEASONS)


def _derived(conn: Connection, ctx: RunContext) -> None:
    client = NflverseClient(ctx.fetcher)
    ingest_player_universe(conn, client)
    ingest_derived_stat_lines(conn, client, 2025)


CASES: tuple[Case, ...] = (
    Case(
        name="coaches-seed",
        summary="the committed play-caller CSV, validated whole, into the coaches table",
        fixture_sets=(),
        tables=(COACHES,),
        run_python=_coaches_seed,
        now=NOW,
    ),
    Case(
        name="nflverse-context",
        summary="projection-context: schedule, play-by-play, coach observations, opponent adjustment, 2023-2024",
        fixture_sets=("nflverse-universe", "nflverse-schedule", "nflverse-pbp-2023-2024"),
        tables=(TEAM_WEEK_OBSERVATIONS, PLAYER_WEEK_OBSERVATIONS, COACHES),
        run_python=_context,
        now=NOW,
        recordings=(PBP_CONTEXT,),
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
