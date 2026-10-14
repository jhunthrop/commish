"""THE ROUND'S COMMAND LINE: the judgment season's ingest into a scratch copy, the development check,
and the one judgment. Every command names its database explicitly (`--database`); none reads an
environment URL, and anything but a local host is refused (`scratch_engine`).

    uv run python -m research.model.ros ingest-judgment-season --database <scratch> --season 2025
    uv run python -m research.model.ros dev-check --round 2 --database <scratch> --out <file.json>
    uv run python -m research.model.ros judge --round 2 --database <scratch> --out <file.json>
"""

import argparse
import json
import sys
from collections.abc import Mapping, Sequence
from dataclasses import asdict, fields
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Final

from sqlalchemy import text

from research.cli import log_line
from research.errors import ConfigurationError
from research.model.arithmetic import ARM64_BOARDS, model_version
from research.model.priors import load_model_artifacts
from research.model.ros import gates
from research.model.ros.judge import Judgment, RoundFit, fit_round, judge_round
from research.model.ros.payload import priors_payload
from research.model.ros.scratch import ingest_judgment_season, scratch_engine

# Each round's one judgment record. Its existence closes that judgment: a second run against 2025
# voids the record, so `judge` refuses unless told it is a marked rerun.
_DOCS: Final = Path(__file__).resolve().parents[3] / "docs/research"
JUDGMENT_RECORDS: Final = {
    1: _DOCS / "2026-10-14-rest-of-season-results.json",
    2: _DOCS / "2026-10-14-rest-of-season-round2-results.json",
}
ROUNDS: Final = {1: (gates.PREREGISTERED, gates.DEVELOPMENT_CHECK), 2: (gates.ROUND_TWO, gates.ROUND_TWO_CHECK)}


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


def _run(url: str, thresholds: gates.Thresholds, out: Path, rerun: bool = False) -> int:
    engine = scratch_engine(url)
    with engine.connect() as conn:
        conn.execute(text("set transaction read only"))
        artifacts = load_model_artifacts(conn)
        fitted = fit_round(conn, thresholds, artifacts, ARM64_BOARDS)
        judged = judge_round(conn, thresholds, fitted, artifacts, ARM64_BOARDS)
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
        "rerun": rerun,
    }  # fmt: skip
    out.write_text(json.dumps(payload, indent=1, default=str))
    return 0 if judged.passed else 1


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m research.model.ros")
    sub = parser.add_subparsers(dest="command", required=True)
    ingest = sub.add_parser("ingest-judgment-season", help="the house's ingests of one season, into the named database")
    ingest.add_argument("--database", required=True)
    ingest.add_argument("--season", type=int, required=True)
    for name in ("dev-check", "judge"):
        run = sub.add_parser(name)
        run.add_argument("--database", required=True)
        run.add_argument("--out", type=Path, required=True)
        run.add_argument("--rerun", action="store_true", help="judge again, marked as a rerun that voids the record")
        run.add_argument("--round", type=int, choices=sorted(ROUNDS), required=True)
    args = parser.parse_args(argv)
    if args.command == "ingest-judgment-season":
        ingest_judgment_season(args.database, args.season, datetime.now(UTC))
        return 0
    judging = args.command == "judge"
    record = JUDGMENT_RECORDS[args.round]
    if judging and record.exists() and not args.rerun:
        raise ConfigurationError(f"round {args.round}'s 2025 judgment was taken once ({record.name}); a rerun voids it")
    judged, checked = ROUNDS[args.round]
    thresholds = judged if judging else checked
    return _run(args.database, thresholds, args.out, rerun=args.rerun)


if __name__ == "__main__":
    sys.exit(main())
