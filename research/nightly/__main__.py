"""`python -m research.nightly`: the nightly run and its publication (the Cloud Run Job `nightly`).

    uv run python -m research.nightly run [--out DIR] [--skip ingest,fit,capsules,week-reads,headshots]
                                          [--capsule-budget N] [--regenerate-all] [--mend-only]
    uv run python -m research.nightly publish [--out DIR] [--at ISO] [--no-dispatch]
    uv run python -m research.nightly mark --out DIR
    uv run python -m research.nightly week-reads

`mark` writes the newest injury capture beside a local directory's public run (`designations.json`,
publish's first step alone), reading the store and writing nothing to it: the stand-in's way to the
statuses the site prints (development).

`week-reads` is the run's week-ahead read pass alone (Lane 72, `nightly/week_reads.py`): every board
player's read that is due now (a status the newest injury capture changed, a published projection that
moved by more than a point, a new week), so an hourly job can rewrite a read the day its facts move.

`run` writes one run under a new run id (05:00 UTC); `publish` makes the newest passed run public
once its early-access hour is over, dispatches the web build of it (every hour), and
keeps `research.published_boards` equal to the public run's boards, the table the API reads, and
writes the newest injury capture beside the run and into that table, dispatching the build again when
the run's players on a season-long list move (Lane 63, `nightly/designations.py`).
Without `--out` both write the R2 bucket (CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID); with it, a
local directory laid out as the bucket is, which the web build reads as PUBLIC_RUN_BASE_URL.
RESEARCH_DATABASE_URL is the store (both commands; a local `--out` publish without it skips the
table by name); provider keys (TANK01_API_KEY, ODDS_API_KEY), the writer's (AI_GATEWAY_API_KEY) and
the dispatch token (WEB_DISPATCH_TOKEN) come from the environment, and a part whose key is missing is
skipped by name. Exit status 1 when the run failed a gate or a step, the dispatch failed, or the
published board could not be written: one `published board: FAILED (...)` line, the pointer and the
dispatch already done, the table still the previous run whole, retried at the next publish hour
(every hour; `nightly/published_board.py`).
"""

import argparse
import logging
import os
import sys
from collections.abc import Sequence
from datetime import datetime
from pathlib import Path
from typing import Final

import httpx
from sqlalchemy import Engine

from research.capsules.config import CAPSULE_CONFIG
from research.cli import log_line as _line
from research.db.engine import make_engine
from research.db.url import database_url_from_env
from research.logging_setup import configure_logging
from research.nightly.capsule_step import CapsuleStepPlan, night_facts
from research.nightly.designations import Hour, finish_marks, mark_public_runs
from research.nightly.publish import Dispatcher, publish
from research.nightly.published_board import SyncOutcome, failed, sync_published_board
from research.nightly.r2 import run_store
from research.nightly.run import STEPS, RunDeps, RunOptions, run_nightly
from research.nightly.run_store import RunStore
from research.nightly.schema_gate import contract_dir, schema_gate
from research.nightly.week_reads import run_week_read_step
from research.pipeline.commands import now_ms
from research.pipeline.http import LiveFetcher

DATABASE_VARIABLE: Final = "RESEARCH_DATABASE_URL"


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
            outcome = run_nightly(
                deps, RunOptions(skip, CapsuleStepPlan(args.capsule_budget, args.regenerate_all, args.mend_only))
            )
    finally:
        fetcher.close()
        engine.dispose()
    return 0 if outcome.passed else 1


def _publish(args: argparse.Namespace) -> int:
    now = now_ms() if args.at is None else datetime.fromisoformat(args.at)
    engine = make_engine(database_url_from_env(DATABASE_VARIABLE)) if _has_store() else None
    try:
        with httpx.Client(timeout=60.0) as http:
            store = _store(args, http)
            dispatcher = None if args.no_dispatch else Dispatcher.from_environ(http, os.environ)
            # The injury capture is written beside the public and the early run first (Lane 63), so a
            # build the pointer step dispatches already reads it.
            marked = mark_public_runs(engine, store)
            _line(marked.line)
            outcome = publish(store, dispatcher, now)
            _line(outcome.line)
            # Whatever the pointer step did, the table follows `latest` (Lane 28): a write that failed
            # an earlier hour is made good now, and an unmoved pointer costs one row read.
            synced = _sync_table(args, engine, store, now)
            _line(synced.line)
            finished = finish_marks(engine if synced.ok else None, store, marked, Hour(dispatcher, outcome, now))
            for step in finished:
                _line(step.line)
    finally:
        if engine is not None:
            engine.dispose()
    return 0 if outcome.ok and synced.ok and marked.ok and all(step.ok for step in finished) else 1


def _has_store() -> bool:
    return bool(os.environ.get(DATABASE_VARIABLE, "").strip())


def _sync_table(args: argparse.Namespace, engine: Engine | None, store: RunStore, now: datetime) -> SyncOutcome:
    """The published board written after the pointer step; a local `--out` publish with no store
    URL skips it by name, the bucket's publish without one fails by name."""
    if engine is None:
        if args.out is not None:
            return SyncOutcome(f"published board: skipped, {DATABASE_VARIABLE} is not set (a local --out publish)")
        return failed(f"{DATABASE_VARIABLE} is not set", None, "what it held")
    return sync_published_board(engine, store, now)


def _mark(args: argparse.Namespace) -> int:
    engine = make_engine(database_url_from_env(DATABASE_VARIABLE))
    try:
        with httpx.Client(timeout=60.0) as http:
            marked = mark_public_runs(engine, _store(args, http))
    finally:
        engine.dispose()
    _line(marked.line)
    return 0 if marked.ok else 1


def _contract(args: argparse.Namespace) -> int:
    """The schema gate alone, over a run already written (CI runs it in the built image, review N16)."""
    record = schema_gate(Path(args.runs), args.run_id, contract_dir(os.environ))
    for reason in record.reasons:
        _line(reason)
    _line(f"schema gate: {'passed' if record.passed else 'FAILED'}, {record.summary}")
    return 0 if record.passed else 1


def _week_reads(_args: argparse.Namespace) -> int:
    """The week-ahead read pass alone, on its own facts pass at now."""
    engine = make_engine(database_url_from_env(DATABASE_VARIABLE))
    try:
        record = run_week_read_step(engine, now_ms(), _line, night_facts(engine))
    finally:
        engine.dispose()
    _line(f"{record.name}: {record.status}, {record.summary}")
    return 1 if record.status == "failed" else 0


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="research.nightly", description=(__doc__ or "").splitlines()[0])
    commands = parser.add_subparsers(dest="command", required=True)
    run = commands.add_parser("run", help="write tonight's run")
    run.add_argument("--skip", default="", help=f"steps to skip, of {', '.join(STEPS)}")
    run.add_argument("--capsule-budget", type=int, default=CAPSULE_CONFIG.sweep_generation_budget)
    run.add_argument(
        "--mend-only",
        action="store_true",
        help="write only unwritten pages and repair failing ones; pages whose facts moved wait",
    )
    run.add_argument("--regenerate-all", action="store_true", help="rewrite every board page's capsule")
    published = commands.add_parser("publish", help="make the early-access run public and dispatch its build")
    published.add_argument("--at", default=None, help="the instant to publish as of (ISO, development)")
    published.add_argument("--no-dispatch", action="store_true", help="move the pointer, dispatch nothing")
    for sub in (run, published):
        sub.add_argument("--out", default=None, help="a local directory instead of the R2 bucket")
    marking = commands.add_parser("mark", help="write the newest injury capture beside a local run")
    marking.add_argument("--out", required=True, help="the local directory laid out as the bucket")
    contract = commands.add_parser("contract", help="the schema gate alone, over a run already written")
    contract.add_argument("--runs", required=True, help="the directory laid out as the bucket (runs/<id>/...)")
    contract.add_argument("--run-id", required=True)
    commands.add_parser("week-reads", help="write every board player's week-ahead read that is due now")
    args = parser.parse_args(argv)
    configure_logging(logging.WARNING)
    commands_by_name = {
        "run": _run,
        "publish": _publish,
        "mark": _mark,
        "contract": _contract,
        "week-reads": _week_reads,
    }
    return commands_by_name[args.command](args)


if __name__ == "__main__":
    sys.exit(main())
