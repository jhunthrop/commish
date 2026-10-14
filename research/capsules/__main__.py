"""`python -m research.capsules`: the capsule writer's command line.

    facts <provider id>               one player's fact sheet (the narrow read), as JSON
    prompt <provider id>              the user message the writer would be sent for him
    write [--players a,b] [--count 10] [--spread 50]
                                      write and gate capsules for chosen board players: paid calls
    sweep [--budget N]                the nightly sweep: every player whose facts moved (phase D's run)
    restamp-injury-day                once, after fix round 3: restamp capsules whose sheet moved only by
                                      its injury status's dating (instant to Eastern day)

RESEARCH_DATABASE_URL names the store (the dev copy for every measurement; never production for a
measurement run). `write` and `sweep` read AI_GATEWAY_API_KEY from the environment, never a file.
"""

import argparse
import json
import os
import sys
from collections.abc import Sequence
from datetime import UTC, datetime

import httpx
from sqlalchemy import Engine

from research.capsules.config import CAPSULE_CONFIG
from research.capsules.facts.collect_one import ServedBoardCache, collect_player_facts
from research.capsules.facts.model import to_js
from research.capsules.gateway import GatewayClient
from research.capsules.narrative import narrative_requests_for
from research.capsules.prompt import NO_WORN_PHRASES, bundle_prompt_for
from research.capsules.restamp import restamp_injury_day
from research.capsules.sweep import SweepPlan, sweep_capsules
from research.capsules.trial import Choice, gate_written, write_chosen
from research.db.engine import make_engine
from research.db.url import database_url_from_env
from research.errors import ConfigurationError


def _out(line: str = "") -> None:
    sys.stdout.write(line + "\n")


def _gateway(http: httpx.Client) -> GatewayClient:
    key = os.environ.get(CAPSULE_CONFIG.gateway.api_key_variable, "").strip()
    if not key:
        raise ConfigurationError(f"{CAPSULE_CONFIG.gateway.api_key_variable} is not set.")
    return GatewayClient(key, http)


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


def _write(engine: Engine, players: Sequence[str], count: int, spread: int) -> int:
    with httpx.Client() as http:
        gateway = _gateway(http)
        written = write_chosen(engine, gateway, datetime.now(UTC), Choice(tuple(players), count, spread))
    report = gate_written(engine, written)
    for line in report:
        _out(line)
    return 0 if all(not w.findings for w in written) else 1


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
    sweep = sub.add_parser("sweep", help="the nightly sweep")
    sweep.add_argument("--budget", type=int, default=CAPSULE_CONFIG.sweep_generation_budget)
    sub.add_parser("restamp-injury-day", help="once: restamp capsules whose sheet moved only by its injury dating")
    args = parser.parse_args(argv)
    engine = make_engine(database_url_from_env())
    if args.command in ("facts", "prompt"):
        return _facts(engine, args.player_id, args.command == "prompt")
    if args.command == "write":
        players = [p for p in args.players.split(",") if p]
        return _write(engine, players, args.count, args.spread)
    if args.command == "restamp-injury-day":
        with engine.begin() as conn:
            restamped, stale = restamp_injury_day(conn, datetime.now(UTC))
        _out(f"restamp-injury-day: {restamped} capsules restamped, {stale} left stale (their facts moved)")
        return 0
    return _sweep(engine, args.budget)


if __name__ == "__main__":
    sys.exit(main())
