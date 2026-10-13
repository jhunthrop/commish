"""The Python side's building blocks: a command-line run (the mirror of an operator script, exit
status included) and the prerequisites cases land before the ingest under test."""

from collections.abc import Sequence

from sqlalchemy import Connection

from research.parity.case import RunContext
from research.pipeline.__main__ import build_parser, exit_status, run_command
from research.pipeline.checkpoint import no_checkpoint
from research.pipeline.commands import COMMANDS, Invocation
from research.pipeline.crosswalk import seed_team_defense_universe
from research.pipeline.nflverse.client import NflverseClient
from research.pipeline.nflverse.ingest import ingest_player_universe
from research.pipeline.nflverse.ingest_schedule import ingest_schedule


def cli(conn: Connection, ctx: RunContext, argv: Sequence[str]) -> int:
    """`python -m research.pipeline <argv>` on this connection, at the case's instant, with the
    replay's fetcher and keys: the mirror of the operator script the TypeScript side runs as is.
    Whatever the case wrote before is committed first, as a separate process would see it."""
    ctx.checkpoint()
    args = build_parser().parse_args(list(argv))
    invocation = Invocation(ctx.fetcher, args, no_checkpoint, ctx.now, ctx.environ)
    return exit_status(run_command(conn, COMMANDS[args.command], invocation))


def universe(conn: Connection, ctx: RunContext) -> None:
    ingest_player_universe(conn, NflverseClient(ctx.fetcher))


def universe_with_defenses(conn: Connection, ctx: RunContext) -> None:
    """The universe and the 32 synthetic defenses, as production has had since the kicker and
    defense backfill (the published boards resolve defenses onto them)."""
    universe(conn, ctx)
    seed_team_defense_universe(conn)


def schedule(conn: Connection, ctx: RunContext, seasons: Sequence[int]) -> None:
    ingest_schedule(conn, NflverseClient(ctx.fetcher), seasons)
