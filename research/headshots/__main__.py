"""`python -m research.headshots`: our headshot copies (the Cloud Run Job `headshots`).

    uv run python -m research.headshots sync [--season 2026] [--limit N] [--out DIR]
    uv run python -m research.headshots curate --missing [--season 2026]
    uv run python -m research.headshots curate --player <id> --url <https url> --by <who> [--out DIR]
    uv run python -m research.headshots curate --refresh --player <id>

`sync` is the job: every provider player's copy (`sync.py`), its counts on one line. `curate --missing`
lists the season's missing and failed players, the most drafted first. `curate --player --url --by`
replaces one player's copy from the URL a person chose and marks it curated; `curate --refresh
--player` marks his row so the next sync fetches his source again. `--out DIR` writes the copies to a
local directory laid out as the bucket instead of `commish-images`.

RESEARCH_DATABASE_URL names the database; CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID the bucket.
Exit status 1 when the pass could not run, every player died of a bucket or database error, or a
curation was refused; a player's failed fetch or error is a row on the curation list, not a failure
of the pass.
"""

import argparse
import sys
import time
from collections.abc import Sequence
from datetime import UTC, datetime

import httpx

from research.cli import log_line
from research.db.engine import make_engine
from research.db.url import database_url_from_env
from research.errors import ResearchError
from research.headshots.bucket import NO_BUCKET, image_bucket
from research.headshots.config import FETCH_INTERVAL_SECONDS
from research.headshots.curate import curate, curation_lines, refresh
from research.headshots.sync import SyncDeps, Throttle, sync
from research.headshots.table import curation_list
from research.season import PRODUCT_SEASON

_USER_AGENT = "commish-headshots/1"


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="research.headshots", description="Our headshot copies.")
    commands = parser.add_subparsers(dest="command", required=True)
    run = commands.add_parser("sync", help="copy every provider player's headshot once a season")
    run.add_argument("--limit", type=int, default=None, help="fetch at most this many players")
    hand = commands.add_parser("curate", help="list, replace or refresh one player's copy by hand")
    hand.add_argument("--missing", action="store_true", help="list the season's missing and failed players")
    hand.add_argument("--refresh", action="store_true", help="mark the player's row to be fetched again")
    hand.add_argument("--player", default=None, help="the provider player id")
    hand.add_argument("--url", default=None, help="the https image to copy from")
    hand.add_argument("--by", default=None, help="who curated it")
    for command in (run, hand):
        command.add_argument("--season", type=int, default=PRODUCT_SEASON)
        command.add_argument("--out", default=None, help="a local directory in place of the bucket")
    return parser


def _writes(args: argparse.Namespace) -> bool:
    """Whether the command writes copies, so needs the bucket (and its token)."""
    return args.command == "sync" or (args.url is not None and not args.missing and not args.refresh)


def _curate(args: argparse.Namespace, deps: SyncDeps) -> None:
    if args.missing:
        with deps.engine.connect() as conn:
            rows = curation_list(conn, args.season)
        for line in curation_lines(rows):
            log_line(f"headshots: missing {line}")
        log_line(f"headshots: {len(rows)} on the {args.season} curation list")
    elif args.refresh and args.player:
        refresh(deps, args.season, args.player)
        log_line(f"headshots: {args.player} marked for the next sync")
    elif args.player and args.url and args.by:
        curate(deps, args.season, args.player, args.url, args.by)
        log_line(f"headshots: {args.player} curated by {args.by.strip()}")
    else:
        raise SystemExit("curate: --missing, --refresh --player, or --player --url --by")


def run_sync(deps: SyncDeps, season: int, limit: int | None) -> int:
    """The sync's exit status: 1 only when every player died of a bucket or database error."""
    counts = sync(deps, season, limit)
    log_line(f"headshots: {season}, {counts.line()}")
    if counts.systemic:
        log_line("headshots: FAILED, every player died of a bucket or database error")
        return 1
    return 0


def main(argv: Sequence[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    engine = make_engine(database_url_from_env())
    try:
        with httpx.Client(headers={"user-agent": _USER_AGENT}) as http:
            deps = SyncDeps(
                engine=engine,
                http=http,
                bucket=image_bucket(args.out, http) if _writes(args) else NO_BUCKET,
                throttle=Throttle(FETCH_INTERVAL_SECONDS, time.monotonic, time.sleep),
                now=lambda: datetime.now(UTC),
                log=log_line,
            )
            if args.command == "sync":
                return run_sync(deps, args.season, args.limit)
            else:
                _curate(args, deps)
    except ResearchError as error:
        log_line(f"headshots: FAILED, {error}")
        return 1
    finally:
        engine.dispose()
    return 0


if __name__ == "__main__":
    sys.exit(main())
