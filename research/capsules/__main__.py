"""`python -m research.capsules`: the capsule writer's command line.

    facts <provider id>               one player's fact sheet (the narrow read), as JSON
    prompt <provider id>              the user message the writer would be sent for him
    write [--players a,b] [--count 10] [--spread 50] [--budget CALLS]
                                      write and gate capsules for chosen board players: paid calls,
                                      never starting a player whose worst case would pass --budget
    sweep [--budget N]                the nightly sweep: every player whose facts moved (phase D's run)
    queue --slugs a,b                 stamp these pages' capsules (by their public slug) for the next
                                      capsule step to rewrite; every slug resolves or nothing is stamped
    restamp-injury-day                once, after fix round 3: restamp capsules whose sheet moved only by
                                      its injury status's dating (instant to Eastern day)
    export --out FILE                 the board's written capsules on their current sheets, to one file
    import --in FILE [--dry-run]      each into this store where its sheet hashes the same; the rest refused

RESEARCH_DATABASE_URL names the store (the dev copy for every measurement; never production for a
measurement run). `write` and `sweep` read AI_GATEWAY_API_KEY from the environment, never a file.
"""

import argparse
import json
import logging
import os
import sys
from collections.abc import Sequence
from datetime import UTC, datetime
from pathlib import Path

import httpx
from sqlalchemy import Engine

from research.capsules.config import CAPSULE_CONFIG, writer_settings
from research.capsules.facts.collect_one import ServedBoardCache, collect_player_facts
from research.capsules.facts.model import to_js
from research.capsules.gateway import GatewayClient
from research.capsules.narrative import narrative_requests_for
from research.capsules.prompt import NO_WORN_PHRASES, bundle_prompt_for
from research.capsules.requeue import queue_slugs
from research.capsules.restamp import restamp_injury_day
from research.capsules.sweep import SweepPlan, sweep_capsules
from research.capsules.transfer import export_capsules, import_capsules
from research.capsules.trial import Choice, gate_written, write_chosen
from research.db.engine import make_engine
from research.db.url import database_url_from_env
from research.errors import ConfigurationError
from research.logging_setup import configure_logging


def _out(line: str = "") -> None:
    sys.stdout.write(line + "\n")


def _gateway(http: httpx.Client) -> GatewayClient:
    key = os.environ.get(CAPSULE_CONFIG.gateway.api_key_variable, "").strip()
    if not key:
        raise ConfigurationError(f"{CAPSULE_CONFIG.gateway.api_key_variable} is not set.")
    return GatewayClient.for_run(key, http, writer_settings(os.environ))


def _facts(engine: Engine, player_id: str, prompt: bool) -> int:
    with engine.connect() as conn:
        facts = collect_player_facts(conn, player_id, datetime.now(UTC), ServedBoardCache())
    if facts is None:
        _out(f"{player_id}: the board does not rank him, so there is no sheet")
        return 1
    _out(
        bundle_prompt_for(facts, narrative_requests_for(facts), NO_WORN_PHRASES)
        if prompt
        else json.dumps(to_js(facts), indent=2)
    )
    return 0


def _write(engine: Engine, choice: Choice) -> int:
    with httpx.Client() as http:
        gateway = _gateway(http)
        now = datetime.now(UTC)
        trial = write_chosen(engine, gateway, now, choice)
    for line in gate_written(engine, trial.written, now):
        _out(line)
    if trial.unstarted:
        _out(
            f"budget: {len(trial.unstarted)} chosen players not started, their worst case would pass "
            f"{choice.call_budget} calls: {', '.join(trial.unstarted)}"
        )
    return 0 if all(not w.findings for w in trial.written) and not trial.unstarted else 1


def _sweep(engine: Engine, budget: int) -> int:
    with httpx.Client() as http:
        report = sweep_capsules(engine, _gateway(http), datetime.now(UTC), SweepPlan(budget))
    _out(
        f"capsule-sweep: {report.board_players} board players, {report.eligible} needed a fresh generation, "
        f"{len(report.processed)} processed ({report.llm} llm, {report.facts} facts blocks), {report.calls} calls, "
        f"{report.prompt_tokens} prompt and {report.completion_tokens} completion tokens, ${report.cost_usd:.6f}, "
        f"{report.queued} queued for regeneration"
    )
    for line in report.detail:
        _out(f"  {line}")
    return 0


def _slugs(raw: str) -> list[str]:
    return [slug.strip() for slug in raw.split(",") if slug.strip()]


def _queue(engine: Engine, raw: str) -> int:
    """Stamp the named pages; non-zero when any named page had no capsule row to stamp."""
    with engine.begin() as conn:
        result = queue_slugs(conn, _slugs(raw), datetime.now(UTC))
    _out(f"queue: {result.stamped} capsules stamped for regeneration ({result.named} slugs named)")
    if result.unstamped:
        _out(f"queue: no capsule row to stamp for {', '.join(result.unstamped)}")
        return 1
    return 0


def _transfer(engine: Engine, args: argparse.Namespace) -> int:
    now = datetime.now(UTC)
    if args.command == "export":
        with engine.connect() as conn:
            count = export_capsules(conn, now, Path(args.out))
        _out(f"export: {count} written capsules on their current sheets, to {args.out}")
        return 0
    dry_run = getattr(args, "dry_run", False)
    with engine.connect() as conn, conn.begin() as transaction:
        report = import_capsules(conn, now, Path(args.source))
        if dry_run:
            transaction.rollback()
    verb = "would import" if dry_run else "imported"
    _out(
        f"import{' (dry run, nothing written)' if dry_run else ''}: {report.imported} {verb}, {len(report.refused)} refused"
    )
    for line in report.refused:
        _out(f"  refused {line}")
    return 0


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="research.capsules", description=(__doc__ or "").splitlines()[0])
    sub = parser.add_subparsers(dest="command", required=True)
    for name in ("facts", "prompt"):
        sub.add_parser(name).add_argument("player_id")
    write = sub.add_parser("write", help="write and gate capsules for chosen board players (paid calls)")
    write.add_argument(
        "--players", default="", help="provider ids, comma separated; else every --spread-th board player"
    )
    write.add_argument("--count", type=int, default=10)
    write.add_argument("--spread", type=int, default=50)
    write.add_argument(
        "--budget",
        type=int,
        default=None,
        help="the run's gateway calls at most; a player starts only if his worst case fits",
    )
    sweep = sub.add_parser("sweep", help="the nightly sweep")
    sweep.add_argument("--budget", type=int, default=CAPSULE_CONFIG.sweep_generation_budget)
    queue = sub.add_parser("queue", help="stamp named pages' capsules for the next capsule step to rewrite")
    queue.add_argument("--slugs", required=True, help="the pages' public slugs, comma separated")
    sub.add_parser("restamp-injury-day", help="once: restamp capsules whose sheet moved only by its injury dating")
    sub.add_parser("export", help="the board's written capsules to a file").add_argument("--out", required=True)
    imported = sub.add_parser("import", help="capsules from an export, where the sheet matches")
    imported.add_argument("--in", dest="source", required=True)
    imported.add_argument("--dry-run", action="store_true", help="print what would land and be refused, write nothing")
    args = parser.parse_args(argv)
    if args.command == "queue" and not _slugs(args.slugs):
        parser.error("queue --slugs names no page")
    configure_logging(logging.WARNING)
    engine = make_engine(database_url_from_env())
    if args.command in ("facts", "prompt"):
        return _facts(engine, args.player_id, args.command == "prompt")
    if args.command == "write":
        players = tuple(p for p in args.players.split(",") if p)
        return _write(engine, Choice(players, args.count, args.spread, args.budget))
    if args.command in ("export", "import"):
        return _transfer(engine, args)
    if args.command == "queue":
        return _queue(engine, args.slugs)
    if args.command == "restamp-injury-day":
        with engine.begin() as conn:
            restamped, stale = restamp_injury_day(conn, datetime.now(UTC))
        _out(f"restamp-injury-day: {restamped} capsules restamped, {stale} left stale (their facts moved)")
        return 0
    return _sweep(engine, args.budget)


if __name__ == "__main__":
    sys.exit(main())
