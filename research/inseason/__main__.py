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
from datetime import UTC, datetime
from typing import Final

import httpx

from research.db.engine import make_engine
from research.db.url import database_url_from_env
from research.inseason.season_week import STEPS, SeasonWeekContext, run_season_week
from research.nightly.publish import take_run_id
from research.nightly.r2 import run_store
from research.nightly.register_log import WEEKLY_SUFFIX, record_freeze, record_pass
from research.pipeline.commands import now_ms
from research.pipeline.http import LiveFetcher
from research.pipeline.tank01.capture import run_capture_harvest
from research.pipeline.tank01.client import API_KEY_ENV, DEFAULT_SEASON, SEASON_ENV, Tank01Client

TASKS: Final = ("season-week", "capture-harvest")
# January and February belong to the season that kicked off the autumn before.
_LAST_MONTH_OF_PRIOR_SEASON: Final = 2


def _line(text: str) -> None:
    sys.stdout.write(f"{datetime.now(UTC).isoformat()} {text}\n")


def default_season(now: datetime) -> int:
    """`defaultSeason`: the season that started in the preceding September."""
    return now.year - 1 if now.month <= _LAST_MONTH_OF_PRIOR_SEASON else now.year


def _season_week(args: argparse.Namespace, now: datetime) -> bool:
    skip = frozenset(step for step in args.skip.split(",") if step)
    unknown = skip - set(STEPS)
    if unknown:
        raise SystemExit(f"inseason: no step {', '.join(sorted(unknown))}; steps are {', '.join(STEPS)}")
    engine = make_engine(database_url_from_env())
    fetcher = LiveFetcher()
    try:
        with httpx.Client(timeout=60.0) as http:
            store = run_store(args.out, http)
            run_id = take_run_id(store, now, WEEKLY_SUFFIX)
            season = args.season if args.season is not None else default_season(now)

            def on_freeze(week: int, at: datetime) -> None:
                record_freeze(store, season, week, run_id, at)

            context = SeasonWeekContext(engine, fetcher, now, season, os.environ, skip, on_freeze)
            results = run_season_week(context)
            lines = [
                {"step": r.step, "status": r.status, "summary": r.summary, "detail": list(r.detail)} for r in results
            ]
            record_pass(store, run_id, now, lines)
    finally:
        fetcher.close()
        engine.dispose()
    _line(f"season-week pass {run_id}, season {season}")
    for result in results:
        _line(f"{result.step}: {result.status}, {result.summary}")
        for detail in result.detail:
            _line(f"  {detail}")
    return all(result.status != "failed" for result in results)


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
    parser.add_argument("--season", type=int, default=None, help="season-week: the season (default: the current one)")
    parser.add_argument("--skip", default="", help=f"season-week: steps to skip, of {', '.join(STEPS)}")
    parser.add_argument("--out", default=None, help="season-week: a local directory for the register's trail, not R2")
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    now = now_ms()
    ok = _season_week(args, now) if args.task == "season-week" else _capture_harvest(now)
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
