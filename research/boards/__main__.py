"""`python -m research.boards`: the boards service on $PORT (8080), or the candidate keeper.

    RESEARCH_DATABASE_URL=... python -m research.boards
    RESEARCH_DATABASE_URL=... python -m research.boards keep-candidates [--point-in-time | --from-url URL]

The service runs one process with `BOARDS_WORKERS` threads (default 2, one per vCPU of the Cloud
Run shape): a custom board is a second of CPU at most and a cached one a single read.
"""

import argparse
import logging
import os
import sys
from collections.abc import Sequence
from typing import Final

import uvicorn
from starlette.applications import Starlette

from research.boards.server import create_app, service_engine
from research.boards.sets import from_store, point_in_time, rebuilt_in
from research.db.engine import make_engine
from research.db.url import database_url_from_env, sqlalchemy_url
from research.logging_setup import configure_logging
from research.model.arithmetic import ARM64_BOARDS, model_version
from research.model.priors import load_model_artifacts
from research.season import PRODUCT_SEASON

DEFAULT_PORT: Final = 8080
DEFAULT_WORKERS: Final = 2


def _positive(name: str, default: int) -> int:
    raw = os.environ.get(name, str(default))
    if not raw.isdigit() or int(raw) <= 0:
        raise SystemExit(f"boards: {name} must be a positive integer; got {raw!r}")
    return int(raw)


def app_from_env() -> Starlette:
    """The uvicorn factory: the service over RESEARCH_DATABASE_URL."""
    workers = _positive("BOARDS_WORKERS", DEFAULT_WORKERS)
    return create_app(service_engine(database_url_from_env(), workers), workers)


def _serve() -> int:
    port = _positive("PORT", DEFAULT_PORT)
    database_url_from_env()  # fail before binding, not on the first call
    uvicorn.run(
        "research.boards.__main__:app_from_env",
        factory=True,
        host="0.0.0.0",
        port=port,
        loop="uvloop",
        http="httptools",
        access_log=False,
        timeout_graceful_shutdown=10,
    )
    return 0


def _keep(argv: Sequence[str]) -> int:
    from research.boards.keep import keep_served_candidates  # noqa: PLC0415 - only the operator command reads it

    parser = argparse.ArgumentParser(prog="research.boards keep-candidates")
    where = parser.add_mutually_exclusive_group()
    where.add_argument("--point-in-time", action="store_true", help="rebuild on a copy of the dev store at the moment")
    where.add_argument("--from-url", help="read the set from another store that keeps it")
    parser.add_argument("--season", type=int, default=PRODUCT_SEASON)
    args = parser.parse_args(argv)
    engine = make_engine(database_url_from_env())
    with engine.begin() as conn:
        artifacts = load_model_artifacts(conn)
        if args.point_in_time:
            sets = point_in_time(args.season)
        elif args.from_url:
            sets = from_store(make_engine(sqlalchemy_url(args.from_url)), args.season)
        else:
            sets = rebuilt_in(conn, args.season, artifacts, ARM64_BOARDS)
        kept = keep_served_candidates(conn, args.season, sets, artifacts.game_variance, model_version())
    for row in kept:
        line = "already kept" if row.already else f"{row.candidates} candidates kept"
        sys.stdout.write(f"{row.source}: {line}\n")
    return 0


def main(argv: Sequence[str] | None = None) -> int:
    args = list(sys.argv[1:] if argv is None else argv)
    configure_logging(logging.INFO)
    if args and args[0] == "keep-candidates":
        return _keep(args[1:])
    if args:
        sys.stderr.write(f"boards: unknown command {args[0]!r}; run with no arguments, or keep-candidates\n")
        return 2
    return _serve()


if __name__ == "__main__":
    sys.exit(main())
