"""`python -m research.nightly`: the nightly run and its publication (the Cloud Run Job `nightly`).

    uv run python -m research.nightly run [--out DIR] [--skip ingest,fit,capsules,headshots]
                                          [--capsule-budget N] [--regenerate-all]
    uv run python -m research.nightly publish [--out DIR] [--at ISO] [--no-dispatch]

`run` writes one run under a new run id (05:00 UTC); `publish` makes the newest passed run public
once its early-access hour is over and dispatches the web build of it (hourly from 06:00 UTC).
Without `--out` both write the R2 bucket (CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID); with it, a
local directory laid out as the bucket is, which the web build reads as PUBLIC_RUN_BASE_URL.
RESEARCH_DATABASE_URL is the store; provider keys (TANK01_API_KEY, ODDS_API_KEY), the writer's
(AI_GATEWAY_API_KEY) and the dispatch token (WEB_DISPATCH_TOKEN) come from the environment, and a
part whose key is missing is skipped by name. Exit status 1 when the run failed a gate or a step, or
the dispatch failed.
"""

import argparse
import os
import sys
from collections.abc import Sequence
from datetime import UTC, datetime

import httpx

from research.capsules.config import CAPSULE_CONFIG
from research.db.engine import make_engine
from research.db.url import database_url_from_env
from research.nightly.capsule_step import CapsuleStepPlan
from research.nightly.publish import Dispatcher, publish
from research.nightly.r2 import run_store
from research.nightly.run import STEPS, RunDeps, RunOptions, run_nightly
from research.nightly.run_store import RunStore
from research.pipeline.commands import now_ms
from research.pipeline.http import LiveFetcher


def _line(text: str) -> None:
    sys.stdout.write(f"{datetime.now(UTC).isoformat()} {text}\n")
    sys.stdout.flush()


def _store(args: argparse.Namespace, http: httpx.Client) -> RunStore:
    return run_store(args.out, http)


def _run(args: argparse.Namespace) -> int:
    skip = frozenset(step for step in args.skip.split(",") if step)
    unknown = skip - set(STEPS)
    if unknown:
        raise SystemExit(f"nightly: no step {', '.join(sorted(unknown))}; steps are {', '.join(STEPS)}")
    engine = make_engine(database_url_from_env())
    fetcher = LiveFetcher()
    try:
        with httpx.Client(timeout=60.0) as http:
            deps = RunDeps(engine, _store(args, http), http, fetcher, os.environ, now_ms, _line)
            outcome = run_nightly(deps, RunOptions(skip, CapsuleStepPlan(args.capsule_budget, args.regenerate_all)))
    finally:
        fetcher.close()
        engine.dispose()
    return 0 if outcome.passed else 1


def _publish(args: argparse.Namespace) -> int:
    now = now_ms() if args.at is None else datetime.fromisoformat(args.at)
    with httpx.Client(timeout=60.0) as http:
        dispatcher = None if args.no_dispatch else Dispatcher.from_environ(http, os.environ)
        outcome = publish(_store(args, http), dispatcher, now)
    _line(outcome.line)
    return 0 if outcome.ok else 1


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="research.nightly", description=(__doc__ or "").splitlines()[0])
    commands = parser.add_subparsers(dest="command", required=True)
    run = commands.add_parser("run", help="write tonight's run")
    run.add_argument("--skip", default="", help=f"steps to skip, of {', '.join(STEPS)}")
    run.add_argument("--capsule-budget", type=int, default=CAPSULE_CONFIG.sweep_generation_budget)
    run.add_argument("--regenerate-all", action="store_true", help="rewrite every board page's capsule")
    published = commands.add_parser("publish", help="make the early-access run public and dispatch its build")
    published.add_argument("--at", default=None, help="the instant to publish as of (ISO, development)")
    published.add_argument("--no-dispatch", action="store_true", help="move the pointer, dispatch nothing")
    for sub in (run, published):
        sub.add_argument("--out", default=None, help="a local directory instead of the R2 bucket")
    args = parser.parse_args(argv)
    return _run(args) if args.command == "run" else _publish(args)


if __name__ == "__main__":
    sys.exit(main())
