"""THE MEASURED JOBS: each a job's database work, run on an engine the meter watches.

A scenario takes the engine and the step names its reads are attributed by. None writes anywhere
but the store it is pointed at (a local Postgres, `transfer.__main__` refuses any other), and none
calls the writer: the capsule step runs without AI_GATEWAY_API_KEY, the nightly writes its run to a
temporary directory, and the boards startup only reads.
"""

import os
import tempfile
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Final

from sqlalchemy import Engine, text

from research.boards.custom import CandidateMemo, candidate_format
from research.capsules.store import stored_capsules_for
from research.capsules.sweep import subjects_of
from research.cli import log_line
from research.model.market.curve import board_source_for
from research.model.preseason.candidate_store import read_candidates, served_generation
from research.model.priors import load_game_variance
from research.nightly.capsule_step import CapsuleStepPlan
from research.nightly.run import RunDeps, RunOptions, run_nightly
from research.nightly.run_store import LocalRunStore
from research.pipeline.commands import now_ms
from research.pipeline.http import LiveFetcher
from research.season import PRODUCT_SEASON

# Keys a measurement never hands a job: no provider is called on a key, and the writer never runs.
WITHHELD_KEYS: Final = ("AI_GATEWAY_API_KEY", "TANK01_API_KEY", "ODDS_API_KEY", "WEB_DISPATCH_TOKEN")

NIGHTLY_STEPS: Final = {
    "ingest_step": "ingest",
    "run_fit_step": "fit",
    "subjects_of": "capsules: facts pass",
    "stored_capsules_for": "capsules: stored rows",
    "capsule_gate": "capsules: gate",
    "page_findings": "capsules: page findings",
    "board_universe_ids": "capsules: board ids",
    "frozen_weeks": "assemble",
    "assemble": "assemble",
    "held_out": "held-out backtest",
}
BOARDS_STEPS: Final = {
    "load_game_variance": "startup: game-variance priors",
    "served_generation": "request: served generation",
    "read_candidates": "request: candidate set",
}
INSEASON_STEPS: Final = {
    "stats_ingest": "stats-ingest",
    "play_by_play": "play-by-play",
    "ftn_charting": "ftn-charting",
    "next_gen_stats": "next-gen-stats",
    "pfr_advstats": "pfr-advstats",
    "grade": "grade",
    "freeze": "freeze",
    "scoreboard": "scoreboard",
    "_season": "season placement",
}
SWEEP_STEPS: Final = {"subjects_of": "one sweep: facts pass", "stored_capsules_for": "one sweep: stored rows"}
# The facts pass by its parts, for finding which of its reads are history.
FACTS_STEPS: Final = {
    **SWEEP_STEPS,
    "board_rows": "facts: board rows",
    "active_peers_for": "facts: active peers",
    "last_season_stories_for": "facts: last season's stories",
    "usage_touches_and_trend_for": "facts: usage and trend",
    "props_lines_by_player": "facts: props",
    "vegas_win_totals_by_team": "facts: win totals",
    "collect_depth_facts": "facts: depth",
    "load_model_artifacts": "facts: laws",
    "injury_snapshot": "facts: injuries",
    "news_for_players": "facts: news",
    "current_season_summaries": "facts: current season",
    "run_market_adp": "facts: market ADP",
    "season_usage_by_player": "facts: this season's usage",
}
API_STEPS: Final = {"_api_board": "api board read"}


def _environ() -> dict[str, str]:
    return {name: value for name, value in os.environ.items() if name not in WITHHELD_KEYS}


def nightly(engine: Engine, skip: frozenset[str]) -> str:
    """The nightly run as the job runs it, to a temporary directory, the writer withheld."""
    for name in WITHHELD_KEYS:
        os.environ.pop(name, None)
    fetcher = LiveFetcher()
    try:
        with tempfile.TemporaryDirectory(prefix="transfer-") as root:
            deps = RunDeps(engine, LocalRunStore(Path(root)), fetcher, _environ(), now_ms, log_line)
            return run_nightly(deps, RunOptions(skip, CapsuleStepPlan())).summary
    finally:
        fetcher.close()


def sweep_reads(engine: Engine, skip: frozenset[str]) -> str:
    """What one sweep pass reads before it writes anything: the board facts pass and the stored rows."""
    del skip
    with engine.connect() as conn:
        subjects = subjects_of(conn, now_ms())
        stored = stored_capsules_for(conn, [s.universe_id for s in subjects])
    return f"{len(subjects)} subjects, {len(stored)} stored rows"


def boards(engine: Engine, skip: frozenset[str]) -> str:
    """The boards service's startup read, then two uncached builds for each scoring format (two
    leagues' rules) on one instance, through its candidate memo."""
    del skip
    memo = CandidateMemo(read_candidates)
    with engine.connect() as conn:
        load_game_variance(conn)
        sizes = []
        for reception in (1.0, 1.0, 0.5, 0.5, 0.0, 0.0):
            source = board_source_for(candidate_format(reception))
            as_of = served_generation(conn, PRODUCT_SEASON, source)
            sizes.append(0 if as_of is None else len(memo(conn, PRODUCT_SEASON, source, as_of)))
    return f"candidate sets of {sizes}"


def inseason(engine: Engine, skip: frozenset[str]) -> str:
    """The season-week pass on the season the stored schedule places today."""
    from research.inseason.__main__ import _season  # noqa: PLC0415 - the job's own placement
    from research.inseason.season_week import SeasonWeekContext, run_season_week  # noqa: PLC0415
    from research.inseason.step_result import StepResult  # noqa: PLC0415

    fetcher = LiveFetcher()
    try:
        now = now_ms()
        season = _season(engine, None, now)
        if isinstance(season, StepResult):
            return f"no pass: {season.summary}"
        results = run_season_week(SeasonWeekContext(engine, fetcher, now, season, _environ(), skip))
    finally:
        fetcher.close()
    return "; ".join(f"{r.step} {r.status}: {r.summary}" for r in results)


def _api_board_query(schema: str) -> str:
    """The api's board read (`api/internal/boards/source.go`, `boardQuery`), in psycopg's placeholders."""
    table = f"{schema}.preseason_projections"
    return f"""with latest as (
  select max(as_of) as as_of from {table} where season = %(season)s and source = %(source)s
), proj as (
  select c.provider_player_id, p.projected_points, p.floor_points, p.median_points, p.ceiling_points
  from {table} p
  join latest l on p.as_of = l.as_of
  join {schema}.player_crosswalk c on c.player_id = p.player_id
  where p.season = %(season)s and p.source = %(source)s
)
select pp.id, pp.name, pp.position, pp.team, coalesce(pp.headshot_url, ''), pp.adp, proj.projected_points,
  proj.floor_points, proj.median_points, proj.ceiling_points, (select as_of from latest)
from {schema}.provider_players pp left join proj on proj.provider_player_id = pp.id
order by pp.adp asc nulls last, pp.id collate "C\""""


def _api_board(engine: Engine, source: str) -> int:
    with engine.connect() as conn:
        raw = conn.exec_driver_sql(_api_board_query("research"), {"season": PRODUCT_SEASON, "source": source})
        return len(raw.fetchall())


def api_board(engine: Engine, skip: frozenset[str]) -> str:
    """The api's board read for each stored format, as `PGSource.Load` sends it."""
    del skip
    counts = [_api_board(engine, f"commish_board_v9_{f}_12") for f in ("ppr", "half", "std")]
    with engine.connect() as conn:
        conn.execute(text("select 1"))
    return f"rows per format {counts}"


@dataclass(frozen=True, slots=True)
class Scenario:
    run: Callable[[Engine, frozenset[str]], str]
    steps: Mapping[str, str]


SCENARIOS: Final[Mapping[str, Scenario]] = {
    "nightly": Scenario(nightly, NIGHTLY_STEPS),
    "sweep-reads": Scenario(sweep_reads, SWEEP_STEPS),
    "facts-parts": Scenario(sweep_reads, FACTS_STEPS),
    "boards": Scenario(boards, BOARDS_STEPS),
    "inseason": Scenario(inseason, INSEASON_STEPS),
    "api-board": Scenario(api_board, API_STEPS),
}
