"""`python -m research.nightly`: the image's nightly command (the Cloud Run Job's argument).

The steps phase C owns, in the oracle's order (`research-ts/src/nightly/main.ts`): the fit step
(check only, `research.model.fit_check`), then the capsule sweep, skipped by name when
AI_GATEWAY_API_KEY is not set, because a sweep without the key would demote written reads to the
template. Each step's line names what it did. The ingests, the run writer, the gates and the web
dispatch are phase D's (this package's `__init__` names the whole chain); they extend this entry
point rather than replace it.

    uv run python -m research.nightly [--skip fit,capsules] [--capsule-budget N]
"""

import argparse
import os
import sys
from collections.abc import Sequence
from datetime import UTC, datetime

import httpx
from sqlalchemy import Engine

from research.capsules.config import CAPSULE_CONFIG
from research.capsules.gateway import GatewayClient
from research.capsules.sweep import sweep_capsules
from research.db.engine import make_engine
from research.db.url import database_url_from_env
from research.model.arithmetic import ARM64_BOARDS
from research.model.fit_check import fit_step
from research.model.priors import load_model_artifacts

STEPS = ("fit", "capsules")


def _line(text: str) -> None:
    sys.stdout.write(text + "\n")


def _fit(engine: Engine, now: datetime) -> bool:
    with engine.begin() as conn:
        record = fit_step(conn, now, load_model_artifacts(conn), ARM64_BOARDS)
    _line(f"fit: {record.status}, {record.summary}")
    return record.status != "failed"


def _capsules(engine: Engine, now: datetime, budget: int) -> bool:
    key = os.environ.get(CAPSULE_CONFIG.gateway.api_key_variable, "").strip()
    if not key:
        _line(
            f"capsules: skipped, {CAPSULE_CONFIG.gateway.api_key_variable} is not set (a sweep without it would demote written reads)"
        )
        return True
    with httpx.Client() as http:
        report = sweep_capsules(engine, GatewayClient(key, http), now, budget)
    _line(
        f"capsules: ran, {report.board_players} board players, {report.eligible} needed a fresh generation, "
        f"{len(report.processed)} processed ({report.llm} llm, {report.template} template), {report.calls} calls, "
        f"${report.cost_usd:.6f}, {report.queued} queued for regeneration"
    )
    return True


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="research.nightly", description=(__doc__ or "").splitlines()[0])
    parser.add_argument("--skip", default="", help=f"steps to skip, comma separated, of {', '.join(STEPS)}")
    parser.add_argument("--capsule-budget", type=int, default=CAPSULE_CONFIG.sweep_generation_budget)
    args = parser.parse_args(argv)
    skip = {step for step in args.skip.split(",") if step}
    unknown = skip - set(STEPS)
    if unknown:
        parser.error(f"no step {', '.join(sorted(unknown))}")
    engine = make_engine(database_url_from_env())
    now = datetime.now(UTC)
    ok = True
    if "fit" in skip:
        _line("fit: skipped by --skip")
    else:
        ok = _fit(engine, now) and ok
    if "capsules" in skip:
        _line("capsules: skipped by --skip")
    else:
        ok = _capsules(engine, now, args.capsule_budget) and ok
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
