"""`python -m research.nightly`: the image's nightly command (the Cloud Run Job's argument).

The steps phase C owns, in the oracle's order (`research-ts/src/nightly/main.ts`): the fit step
(check only, `research.model.fit_check`), then the capsule sweep, skipped by name when
AI_GATEWAY_API_KEY is not set, because a sweep without the key would demote written reads to facts
blocks, then one retry pass over the pages still unwritten (`SweepPlan(unwritten_only=True)`,
from the budget left), then the capsule gate (`capsule_gate`), which fails the run when more than 2% of the
board's pages are unwritten (facts blocks, missing) or a written sentence sits on two pages. Each
step's line names what it did; the run exits 1 when a step failed. The ingests, the run writer, the gates and the web
dispatch are phase D's (this package's `__init__` names the whole chain); they extend this entry
point rather than replace it.

    uv run python -m research.nightly [--skip fit,capsules,capsule-gate] [--capsule-budget N]
"""

import argparse
import sys
from collections.abc import Sequence
from datetime import UTC, datetime
from typing import Final

from sqlalchemy import Engine

from research.capsules.config import CAPSULE_CONFIG
from research.db.engine import make_engine
from research.db.url import database_url_from_env
from research.model.arithmetic import ARM64_BOARDS
from research.model.fit_check import fit_step
from research.model.priors import load_model_artifacts
from research.nightly.capsule_step import CapsuleStepPlan, run_capsule_step

STEPS: Final = ("fit", "capsules")


def _line(text: str) -> None:
    sys.stdout.write(text + "\n")


def _fit(engine: Engine, now: datetime) -> bool:
    with engine.begin() as conn:
        record = fit_step(conn, now, load_model_artifacts(conn), ARM64_BOARDS)
    _line(f"fit: {record.status}, {record.summary}")
    return record.status != "failed"


def _capsules(engine: Engine, now: datetime, plan: CapsuleStepPlan) -> bool:
    return run_capsule_step(engine, now, plan, _line).gate.ok


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="research.nightly", description=(__doc__ or "").splitlines()[0])
    parser.add_argument("--skip", default="", help=f"steps to skip, comma separated, of {', '.join(STEPS)}")
    parser.add_argument("--capsule-budget", type=int, default=CAPSULE_CONFIG.sweep_generation_budget)
    parser.add_argument("--regenerate-all", action="store_true", help="rewrite every board page's capsule")
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
        ok = _capsules(engine, now, CapsuleStepPlan(args.capsule_budget, args.regenerate_all)) and ok
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
