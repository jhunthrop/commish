"""`python -m research.inseason --task <task>`: one pass of an in-season job (the Cloud Run Job `inseason`).

    uv run python -m research.inseason --task season-week [--season 2026] [--skip props-snapshot]
    uv run python -m research.inseason --task capture-harvest

Exit status 1 when any step failed (or the capture was refused), 0 otherwise. Provider keys come
from the environment: TANK01_API_KEY for the capture, ODDS_API_KEY for the props snapshot.
"""

import argparse
import logging
import os
import sys
from collections.abc import Sequence
from datetime import datetime
from typing import Final

import httpx
from sqlalchemy import Engine

from research.cli import log_line as _line
from research.db.engine import make_engine
from research.db.url import database_url_from_env
from research.inseason.season_of import (
    calendar_season,
    out_of_window_reason,
    placed_season,
    season_spans,
    stored_span,
    unplaced_reason,
)
from research.inseason.season_week import STEPS, SeasonWeekContext, StepResult, run_season_week
from research.nightly.publish import take_run_id
from research.nightly.r2 import run_store
from research.nightly.register_log import WEEKLY_SUFFIX, record_freeze, record_pass
from research.pipeline.commands import now_ms
from research.pipeline.http import LiveFetcher
from research.pipeline.tank01.capture import run_capture_harvest
from research.pipeline.tank01.client import API_KEY_ENV, DEFAULT_SEASON, SEASON_ENV, Tank01Client

TASKS: Final = ("season-week", "capture-harvest")
LOG: Final = logging.getLogger(__name__)


def _season_week(args: argparse.Namespace, now: datetime) -> bool:
    skip = frozenset(step for step in args.skip.split(",") if step)
    unknown = skip - set(STEPS)
    if unknown:
        raise SystemExit(f"inseason: no step {', '.join(sorted(unknown))}; steps are {', '.join(STEPS)}")
    engine = make_engine(database_url_from_env())
    fetcher = LiveFetcher()
    freezes: list[tuple[int, datetime]] = []
    try:
        season = _season(engine, args.season, now)
        if isinstance(season, StepResult):
            results = [season]
        else:
            context = SeasonWeekContext(
                engine, fetcher, now, season, os.environ, skip, lambda week, at: freezes.append((week, at))
            )
            results = run_season_week(context)
    finally:
        fetcher.close()
        engine.dispose()
    # The freezes are in the database already; the bucket's trail comes after, and its failure is its
    # own failed line (fix round 2, N2): an R2 outage or a bad token never costs a freeze.
    results.append(_trail(args.out, now, None if isinstance(season, StepResult) else season, freezes, results))
    _line(f"season-week pass, season {season if isinstance(season, int) else 'unplaced'}")
    for result in results:
        _line(f"{result.step}: {result.status}, {result.summary}")
        for detail in result.detail:
            _line(f"  {detail}")
    return all(result.status != "failed" for result in results)


def _season(engine: Engine, given: int | None, now: datetime) -> int | StepResult:
    """The season the pass works on: `--season`, else the one the stored schedule places today."""
    if given is not None:
        return given
    with engine.connect() as conn:
        spans = season_spans(conn)
    placed = placed_season(spans, now)
    if placed is not None:
        return placed
    # Outside the calendar season's window is no pass to make (review R1); a calendar season with no
    # stored schedule is the failure N3 exists for.
    span = stored_span(spans, calendar_season(now))
    if span is not None:
        return StepResult("season", "skipped", out_of_window_reason(span, now))
    return StepResult("season", "failed", unplaced_reason(spans, now))


def _trail(
    out: str | None,
    now: datetime,
    season: int | None,
    freezes: Sequence[tuple[int, datetime]],
    results: Sequence[StepResult],
) -> StepResult:
    """The register's trail in the bucket: the pass's run id, each freeze it took, and its lines."""
    lines = [{"step": r.step, "status": r.status, "summary": r.summary, "detail": list(r.detail)} for r in results]
    try:
        with httpx.Client(timeout=60.0) as http:
            store = run_store(out, http)
            run_id = take_run_id(store, now, WEEKLY_SUFFIX)
            for week, at in freezes:
                if season is not None:
                    record_freeze(store, season, week, run_id, at)
            record_pass(store, run_id, now, lines)
    # Any failure here is reported as the trail's own line, never raised past the freezes.
    except Exception as error:
        LOG.exception("season-week trail failed")
        return StepResult("trail", "failed", f"the register's trail was not written ({error}); every freeze stands")
    return StepResult("trail", "ok", f"pass {run_id}, {len(freezes)} freezes recorded")


def _capture_harvest(now: datetime) -> bool:
    key = os.environ.get(API_KEY_ENV, "").strip()
    if not key:
        _line(f"capture-harvest: REFUSED, {API_KEY_ENV} is not set")
        return False
    engine = make_engine(database_url_from_env())
    fetcher = LiveFetcher()
    try:
        season = int(os.environ.get(SEASON_ENV, DEFAULT_SEASON))
        with engine.begin() as conn:
            result = run_capture_harvest(conn, Tank01Client(fetcher, key), now, season)
    finally:
        fetcher.close()
        engine.dispose()
    for feed in result.feeds:
        reason = "" if feed.reason is None else f", {feed.reason}"
        _line(f"  {feed.source}: {feed.status}, {feed.requests} requests{reason}")
    if result.reason is not None:
        _line(f"capture-harvest: REFUSED, {result.reason}")
        return False
    failed = [feed.source for feed in result.feeds if feed.status == "failed"]
    _line(f"capture-harvest: {len(result.feeds)} feeds, {len(failed)} failed")
    return not failed


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="research.inseason", description=(__doc__ or "").splitlines()[0])
    parser.add_argument("--task", required=True, choices=TASKS)
    parser.add_argument(
        "--season",
        type=int,
        default=None,
        help="season-week: the season (default: the one the stored schedule places today)",
    )
    parser.add_argument("--skip", default="", help=f"season-week: steps to skip, of {', '.join(STEPS)}")
    parser.add_argument("--out", default=None, help="season-week: a local directory for the register's trail, not R2")
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    now = now_ms()
    ok = _season_week(args, now) if args.task == "season-week" else _capture_harvest(now)
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
