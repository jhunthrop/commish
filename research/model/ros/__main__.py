"""THE ROUND'S COMMAND LINE: the judgment season's ingest into a scratch copy, the development check,
and the one judgment. Every command names its database explicitly (`--database`); none reads an
environment URL, and anything but a local host is refused (`scratch_engine`).

    uv run python -m research.model.ros ingest-judgment-season --database <scratch> --season 2025
    uv run python -m research.model.ros dev-check --round 2 --database <scratch> --out <file.json>
    uv run python -m research.model.ros judge --round 2 --database <scratch> --out <file.json>
"""

import argparse
import json
import logging
import subprocess
import sys
from collections.abc import Callable, Mapping, Sequence
from dataclasses import asdict, fields
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Final

from sqlalchemy import text

from research.cli import log_line
from research.errors import ConfigurationError
from research.logging_setup import configure_logging
from research.model.arithmetic import ARM64_BOARDS, model_version
from research.model.priors import load_model_artifacts
from research.model.ros import gates
from research.model.ros.judge import Judgment, RoundFit, fit_round, judge_round
from research.model.ros.payload import priors_payload
from research.model.ros.scratch import ingest_judgment_season, ingest_week_one_rosters, scratch_engine
from research.model.ros.ship import SHIPPED_ROUND, fit_and_publish

# Each round's one judgment record. Its existence closes that judgment for good: `judge` refuses a
# round whose record exists, and `dev-check` refuses a check that would judge a closed season.
_ROOT: Final = Path(__file__).resolve().parents[3]
_DOCS: Final = _ROOT / "docs/research"
JUDGMENT_RECORDS: Final = {
    1: _DOCS / "2026-10-14-rest-of-season-results.json",
    2: _DOCS / "2026-10-14-rest-of-season-round2-results.json",
    3: _DOCS / "2026-10-14-rest-of-season-round3-results.json",
}
ROUNDS: Final = {
    1: (gates.PREREGISTERED, gates.DEVELOPMENT_CHECK),
    2: (gates.ROUND_TWO, gates.ROUND_TWO_CHECK),
    3: (gates.ROUND_THREE, gates.ROUND_THREE_CHECK),
}


def _render(fitted: RoundFit, judged: Judgment) -> list[str]:
    seconds = ", ".join(f"{name} {value:.1f}s" for name, value in fitted.seconds.items())
    lines = [f"fit: {fitted.rows} population rows; {seconds}"]
    lines += [f"{'PASS' if g.passed else 'FAIL'}  {g.gate} {g.subject:<14} {g.detail}" for g in judged.lines]
    lines.append(f"DECISION: {'all gates pass' if judged.passed else 'a gate failed; nothing ships'}")
    return lines


def thresholds_payload(thresholds: gates.Thresholds) -> dict[str, Any]:
    """The constant as JSON (its mappings are read-only proxies, which `asdict` cannot copy)."""
    return {
        name: dict(value) if isinstance(value, Mapping) else value
        for name, value in ((f.name, getattr(thresholds, f.name)) for f in fields(thresholds))
    }


def closed_seasons(exists: Callable[[Path], bool] = Path.exists) -> frozenset[int]:
    """Every season a round has taken its one judgment on (its record exists)."""
    return frozenset(ROUNDS[number][0].judgment_season for number, path in JUDGMENT_RECORDS.items() if exists(path))


def thresholds_for(command: str, number: int, exists: Callable[[Path], bool] = Path.exists) -> gates.Thresholds:
    """The constant a command runs under, or the refusal: a round's judgment is taken once, and a
    development check may not judge a season that already carries a closed judgment."""
    judged, checked = ROUNDS[number]
    if command == "judge":
        record = JUDGMENT_RECORDS[number]
        if exists(record):
            raise ConfigurationError(
                f"round {number}'s {judged.judgment_season} judgment was taken once ({record.name}); it is never rerun"
            )
        return judged
    if checked.judgment_season in closed_seasons(exists):
        raise ConfigurationError(
            f"round {number}'s development check would judge {checked.judgment_season}, "
            "which carries a closed judgment; refused"
        )
    return checked


def tree_status() -> list[str]:
    """`git status --porcelain` of the tree the run used: empty when every file is committed."""
    found = subprocess.run(["git", "status", "--porcelain"], cwd=_ROOT, capture_output=True, text=True, check=True)
    return found.stdout.splitlines()


def _run(url: str, thresholds: gates.Thresholds, out: Path) -> int:
    status = tree_status()
    engine = scratch_engine(url)
    try:
        with engine.connect() as conn:
            conn.execute(text("set transaction read only"))
            artifacts = load_model_artifacts(conn)
            fitted = fit_round(conn, thresholds, artifacts, ARM64_BOARDS)
            judged = judge_round(conn, thresholds, fitted, artifacts, ARM64_BOARDS)
    finally:
        engine.dispose()
    report = _render(fitted, judged)
    for line in report:
        log_line(line)
    payload: dict[str, Any] = {
        "model": thresholds.model_name,
        "model_version": model_version(),
        "arithmetic": ARM64_BOARDS.label,
        "thresholds": thresholds_payload(thresholds),
        "priors": priors_payload(fitted.priors),
        "fit_rows": fitted.rows,
        "fit_seconds": dict(fitted.seconds),
        "gates": [asdict(line) for line in judged.lines],
        "passed": judged.passed,
        "numbers": dict(judged.numbers),
        "report": report,
        "tree_status": status,
        "tree_clean": not status,
    }  # fmt: skip
    out.write_text(json.dumps(payload, indent=1, default=str))
    return 0 if judged.passed else 1


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m research.model.ros")
    sub = parser.add_subparsers(dest="command", required=True)
    ingest = sub.add_parser("ingest-judgment-season", help="the house's ingests of one season, into the named database")
    ingest.add_argument("--database", required=True)
    ingest.add_argument("--season", type=int, required=True)
    rosters = sub.add_parser(
        "ingest-week-one-rosters", help="the house's week-one roster ingest, into the named database"
    )
    rosters.add_argument("--database", required=True)
    rosters.add_argument("--season", type=int, action="append", required=True)
    fit = sub.add_parser("fit", help="fit the judged model on the named store and publish its artifact")
    fit.add_argument("--database", required=True)
    for name in ("dev-check", "judge"):
        run = sub.add_parser(name)
        run.add_argument("--database", required=True)
        run.add_argument("--out", type=Path, required=True)
        run.add_argument("--round", type=int, choices=sorted(ROUNDS), required=True)
    args = parser.parse_args(argv)
    configure_logging(logging.WARNING)
    if args.command == "ingest-week-one-rosters":
        ingest_week_one_rosters(args.database, args.season, datetime.now(UTC))
        return 0
    if args.command == "fit":
        for line in fit_and_publish(args.database, JUDGMENT_RECORDS[SHIPPED_ROUND], datetime.now(UTC)):
            log_line(line)
        return 0
    if args.command == "ingest-judgment-season":
        ingest_judgment_season(args.database, args.season, datetime.now(UTC))
        return 0
    return _run(args.database, thresholds_for(args.command, args.round), args.out)


if __name__ == "__main__":
    sys.exit(main())
