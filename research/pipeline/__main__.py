"""THE PIPELINE'S COMMAND LINE: every ingest, into the `research` schema at RESEARCH_DATABASE_URL, live.

    uv run python -m research.pipeline <ingest> [options]

Provider keys come from the environment (TANK01_API_KEY, ODDS_API_KEY). The nightly chain
(phase D) calls the same functions; this is the operator's door to them.

TRANSACTIONS. An atomic ingest runs in one transaction and writes nothing if it fails. A
non-atomic one (the provider seed, the props backfill, the multi-season and multi-step ingests)
commits at the points its TypeScript's writes became durable, because the TypeScript writes
outside a transaction there and a re-run is how a stopped run finishes; `commands.py` names which
is which and why.

EXIT STATUS. 0 on success; 2 for a THIN run, exactly where the TypeScript scripts exit 2
(`preseason-ingest.ts` when any board failed or resolved below 0.7, `ingest-current-ecr.ts` below
0.7): the rows are written, and the comparison against them must not be published without saying
so; 1 for a failure. `coaches --check` and `win-totals-seed --check` validate the committed seed
files and write nothing.
"""

import argparse
import logging
import os
import sys
from collections.abc import Sequence
from dataclasses import replace
from typing import Final

from sqlalchemy import Connection

from research.db.engine import make_engine
from research.db.url import database_url_from_env
from research.pipeline import coaches, vegas
from research.pipeline.checkpoint import no_checkpoint
from research.pipeline.commands import COMMANDS, RESEARCH_ROOT, Command, Invocation, now_ms
from research.pipeline.http import LiveFetcher
from research.pipeline.preseason.boards import BoardsReport
from research.pipeline.tank01.client import DEFAULT_SEASON

EXIT_THIN: Final = 2
DEFAULT_BACKFILL_BUDGET: Final = 9000  # `odds-props-backfill.ts`'s DEFAULT_BUDGET, in credits.


def _check(command: str) -> int:
    if command == "coaches":
        rows = coaches.parse_play_callers((RESEARCH_ROOT / coaches.PLAY_CALLERS_CSV_PATH).read_text())
        problems = coaches.validate_play_callers(rows)
    else:
        csv_text = (RESEARCH_ROOT / vegas.WIN_TOTALS_CSV_PATH).read_text()
        vegas.win_total_observations(vegas.parse_win_totals_csv(csv_text))
        problems = []
    for problem in problems:
        sys.stderr.write(problem + "\n")
    return 1 if problems else 0


def exit_status(result: object) -> int:
    """2 for a thin run, where the TypeScript script exits 2; 0 otherwise."""
    return EXIT_THIN if isinstance(result, BoardsReport) and result.thin else 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="research.pipeline", description="Run one research ingest.")
    parser.add_argument("command", choices=sorted(COMMANDS))
    parser.add_argument("--first", type=int, default=DEFAULT_SEASON)
    parser.add_argument("--last", type=int, default=DEFAULT_SEASON)
    parser.add_argument("--last-week", type=int, default=None, help="tank01-roster: stop after this week")
    parser.add_argument("--budget", type=float, default=DEFAULT_BACKFILL_BUDGET, help="props-backfill: credits")
    parser.add_argument("--check", action="store_true", help="coaches, win-totals-seed: validate, write nothing")
    return parser


def run_command(conn: Connection, command: Command, invocation: Invocation) -> object:
    """One command on an open connection: in a transaction when atomic, else committing at each
    of its checkpoints and once at the end."""
    if command.atomic:
        with conn.begin():
            return command.run(conn, replace(invocation, checkpoint=no_checkpoint))
    result = command.run(conn, replace(invocation, checkpoint=conn.commit))
    conn.commit()
    return result


def _run(command: Command, args: argparse.Namespace) -> object:
    engine = make_engine(database_url_from_env())
    fetcher = LiveFetcher()
    try:
        with engine.connect() as conn:
            invocation = Invocation(fetcher, args, no_checkpoint, now_ms(), os.environ)
            return run_command(conn, command, invocation)
    finally:
        fetcher.close()
        engine.dispose()


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    if args.check:
        return _check(args.command)
    result = _run(COMMANDS[args.command], args)
    sys.stdout.write(f"{args.command}: {result}\n")
    status = exit_status(result)
    if status == EXIT_THIN:
        sys.stderr.write(f"{args.command}: THIN. A board failed or resolved below the 0.7 floor; see the log.\n")
    return status


if __name__ == "__main__":
    sys.exit(main())
