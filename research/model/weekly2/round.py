"""THE ROUND'S COMMAND LINE: the development check and the one judgment of `commish_weekly_v2`.

    uv run python -m research.model.weekly2.round develop --database <scratch> [--out <file.json>]
    uv run python -m research.model.weekly2.round judge --database <scratch> --out <file.json>

Both name their database explicitly and run only on a local scratch copy on 5433 (the judgment on a
`lane42_` copy, as section 5 names it; the development check also on the implementer's `lane44_`
copy), in one read-only transaction whose every statement is refused if it names a closed season
(`guard`). Both check the preconditions first and refuse, naming what is missing. The judgment also
refuses unless the preregistration's commit is in this tree's history, and once its record exists.
`develop` fits on 2021-2022 and checks on 2023: every gate reported, nothing shipped, nothing decided.
"""

import argparse
import json
import logging
import subprocess
import sys
import time
from collections.abc import Callable, Sequence
from dataclasses import asdict, fields
from pathlib import Path
from typing import Any, Final

from sqlalchemy import text

from research.cli import log_line
from research.db.engine import make_engine
from research.db.url import sqlalchemy_url
from research.errors import ConfigurationError
from research.logging_setup import configure_logging
from research.model.arithmetic import ARM64_BOARDS, model_version
from research.model.priors import load_model_artifacts
from research.model.reads.preseason import all_positions
from research.model.register.freeze import IMPLEMENTATION
from research.model.ros.scratch import check_scratch_url
from research.model.weekly.round.judge import table_digests
from research.model.weekly2 import gates
from research.model.weekly2.gates import DEVELOPMENT_CHECK, ROUND_TWO, Thresholds
from research.model.weekly2.guard import closed_seasons, fit_reader, guard_queries, judgment_reader
from research.model.weekly2.judge import DOCS, RoundFit, elasticities_payload, fit_round
from research.model.weekly2.judgment import Judgment, judge_round
from research.model.weekly2.preconditions import missing_preconditions, read_counts

_ROOT: Final = Path(__file__).resolve().parents[3]
PREREGISTRATION_COMMIT: Final = "86ca79d6"
PREREGISTRATION: Final = "docs/research/2026-10-15-weekly-projection-round2-preregistration.md"
JUDGMENT_RECORD: Final = DOCS / "2026-10-15-weekly-projection-round2-results.json"
DEVELOPMENT_RECORD: Final = DOCS / "2026-10-15-weekly-projection-round2-dev-check.json"
JUDGMENT_PREFIXES: Final = ("lane42_",)  # section 5: "admits only a `lane42_` database on 5433"
DEVELOPMENT_PREFIXES: Final = ("lane42_", "lane44_")  # and the implementer's development copy
COMMANDS: Final = ("develop", "judge")


def preregistration_committed() -> bool:
    """The preregistration's commit is an ancestor of the tree's HEAD."""
    found = subprocess.run(
        ["git", "merge-base", "--is-ancestor", PREREGISTRATION_COMMIT, "HEAD"],
        cwd=_ROOT,
        capture_output=True,
        check=False,
    )
    return found.returncode == 0


def thresholds_for(
    command: str,
    committed: Callable[[], bool] = preregistration_committed,
    exists: Callable[[Path], bool] = Path.exists,
) -> Thresholds:
    """The constant a command runs under, or the refusal: the judgment needs the lock in its history
    and is taken once."""
    if command != "judge":
        return DEVELOPMENT_CHECK
    if not committed():
        raise ConfigurationError(
            f"the preregistration's commit {PREREGISTRATION_COMMIT} is not in this tree's history; no judgment without the lock"
        )
    if exists(JUDGMENT_RECORD):
        raise ConfigurationError(f"the 2024 judgment was taken once ({JUDGMENT_RECORD.name}); it is never rerun")
    return ROUND_TWO


def check_round_scratch(command: str, url: str) -> None:
    check_scratch_url(url, JUDGMENT_PREFIXES if command == "judge" else DEVELOPMENT_PREFIXES)


def tree_status() -> list[str]:
    found = subprocess.run(["git", "status", "--porcelain"], cwd=_ROOT, capture_output=True, text=True, check=True)
    return found.stdout.splitlines()


def thresholds_payload(t: Thresholds) -> dict[str, Any]:
    payload: dict[str, Any] = {}
    for field in fields(t):
        value = getattr(t, field.name)
        if field.name == "rate_round":
            value = {"model_name": value.model_name, "fit_seasons": list(value.fit_seasons)}
        elif hasattr(value, "items"):
            value = dict(value)
        payload[field.name] = value
    return payload


def _render(fitted: RoundFit, judged: Judgment, lines: Sequence[gates.GateLine], passed: bool) -> list[str]:
    seconds = ", ".join(f"{name} {value:.1f}s" for name, value in fitted.seconds.items())
    elasticities = ", ".join(f"{p} pass {e.passing} rush {e.rushing}" for p, e in fitted.elasticities.items())
    report = [
        f"fit: {fitted.fit_rows} fit-population rows; {seconds}",
        f"elasticities: {elasticities}",
        f"judged: {judged.rows} population rows",
    ]
    report += [f"{'PASS' if g.passed else 'FAIL'}  {g.gate} {g.subject:<24} {g.detail}" for g in lines]
    report.append(f"DECISION: {'all 26 lines pass' if passed else 'a line failed or cannot answer; nothing ships'}")
    return report


def _run(command: str, url: str, t: Thresholds, out: Path) -> int:
    started = time.monotonic()
    status = tree_status()
    check_round_scratch(command, url)
    engine = make_engine(sqlalchemy_url(url))
    try:
        with engine.connect() as conn:
            conn.execute(text("set transaction read only"))
            guard_queries(conn, closed_seasons(t))
            missing = missing_preconditions(read_counts(conn, t), t)
            if missing:
                raise ConfigurationError("the round's preconditions are not met: " + "; ".join(missing))
            before = table_digests(conn)
            artifacts = load_model_artifacts(conn)
            positions = all_positions(conn)
            version = model_version()
            fitted = fit_round(conn, t, artifacts, fit_reader(t), positions, version)
            judged = judge_round(conn, t, fitted, artifacts, positions, version, judgment_reader(t))
            after = table_digests(conn)
    finally:
        engine.dispose()
    fit_served = (*fitted.rate.served, *fitted.served)
    lines = [*judged.lines, gates.isolation_line(fit_served, judged.served, before, after, t)]
    passed = gates.verdict(lines)
    report = _render(fitted, judged, lines, passed)
    for line in report:
        log_line(line)
    payload: dict[str, Any] = {
        "model": t.model_name,
        "command": command,
        "model_version": version,
        "implementation": IMPLEMENTATION,
        "arithmetic": ARM64_BOARDS.label,
        "preregistration": {"path": PREREGISTRATION, "commit": PREREGISTRATION_COMMIT},
        "thresholds": thresholds_payload(t),
        "rate": {"record": t.rate_record, "equal_to_record": True, "fit_rows": fitted.rate.rows},
        "elasticities": elasticities_payload(fitted.elasticities),
        "range": fitted.ranges.payload(),
        "fit_rows": fitted.fit_rows,
        "board_moments": {**{str(s): m for s, m in fitted.board_moments.items()}, str(t.judgment_season): judged.numbers["board_moment"]},
        "outcome_seasons_read": {"fit": sorted(set(fit_served)), "judgment": sorted(set(judged.served))},
        "digests": {"before": before, "after": after},
        "gates": [asdict(line) for line in lines],
        "passed": passed,
        "numbers": dict(judged.numbers),
        "seconds": {**dict(fitted.seconds), "total": time.monotonic() - started},
        "report": report,
        "tree_status": status,
        "tree_clean": not status,
    }  # fmt: skip
    out.write_text(json.dumps(payload, indent=1, default=str))
    return 0 if passed or command == "develop" else 1


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m research.model.weekly2.round")
    sub = parser.add_subparsers(dest="command", required=True)
    develop = sub.add_parser("develop", help="fit on 2021-2022, check on 2023 weeks 6-17; nothing ships")
    develop.add_argument("--database", required=True)
    develop.add_argument("--out", type=Path, default=DEVELOPMENT_RECORD)
    judge = sub.add_parser("judge", help="fit on 2021-2023, judge 2024 weeks 6-17 once")
    judge.add_argument("--database", required=True)
    judge.add_argument("--out", type=Path, required=True)
    args = parser.parse_args(argv)
    configure_logging(logging.WARNING)
    return _run(args.command, args.database, thresholds_for(args.command), args.out)


if __name__ == "__main__":
    sys.exit(main())
