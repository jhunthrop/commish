"""THE ROUND'S COMMAND LINE: the development check and the one judgment of `commish_weekly_v3`.

    uv run python -m research.model.weekly3.round develop --database <scratch> [--out <file.json>]
    uv run python -m research.model.weekly3.round judge --database <scratch> --out <file.json>

Both name their database explicitly and run only on a local scratch copy on 5433 (the judgment on a
`lane47_` copy, as section 6 names it; the development check also on the implementer's `lane48_`
copy), in one read-only transaction whose every statement is refused if it names a closed season
(round 2's `guard`: 2025 and 2026 for the judgment, 2024 on for the check). Both check the
preconditions first and refuse, naming what is missing. The judgment also refuses unless the lock
`e58ae444` is in this tree's history, and once its claim or record exists; the five tables are
digested before the fit and after the judgment. `develop` fits on 2021-2022 and checks on 2023:
every gate reported, nothing shipped, and the stop rule read (section 4: a check that fails G2
pooled ends the round with no judgment).
"""

import argparse
import json
import logging
import sys
import time
from collections.abc import Callable, Mapping, Sequence
from dataclasses import asdict
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
from research.model.weekly2.band import Ranges
from research.model.weekly2.gates import GateLine, Thresholds
from research.model.weekly2.guard import closed_seasons, guard_queries
from research.model.weekly2.judge import DOCS, elasticities_payload
from research.model.weekly2.round import claim_judgment, preregistration_committed, thresholds_payload, tree_status
from research.model.weekly3.gates import DEVELOPMENT_CHECK, GATE_LINES, ROUND_THREE, isolation_line, verdict
from research.model.weekly3.judge import RoundFit, fit_round
from research.model.weekly3.judgment import Judgment, judge_round
from research.model.weekly3.ledger import per_game_clause
from research.model.weekly3.number import Fitted
from research.model.weekly3.outcomes import fit_reader, judgment_reader
from research.model.weekly3.preconditions import missing_preconditions, preconditions_payload, read_counts

PREREGISTRATION_COMMIT: Final = "e58ae444"
PREREGISTRATION: Final = "docs/research/2026-10-15-weekly-projection-round3-preregistration.md"
JUDGMENT_RECORD: Final = DOCS / "2026-10-15-weekly-projection-round3-results.json"
# The judgment's claim, in one fixed place whatever `--out` names: created exclusively before any
# 2024 row is read, so neither another output path nor a run that dies part way can judge twice.
JUDGMENT_CLAIM: Final = DOCS / "2026-10-15-weekly-projection-round3-judgment-taken.json"
DEVELOPMENT_RECORD: Final = DOCS / "2026-10-15-weekly-projection-round3-dev-check.json"
JUDGMENT_PREFIXES: Final = ("lane47_",)  # section 6: "admits only a `lane47_` database on 5433"
DEVELOPMENT_PREFIXES: Final = ("lane47_", "lane48_")  # and the implementer's development copy
COMMANDS: Final = ("develop", "judge")
DECIDING: Final = ("G2", "pooled vs recent form")  # section 4's stop rule and section 5's decision rule
# Section 4, "What 2024 has already been exposed to, completely", printed beside the verdict, item 6 first.
EXPOSURE_CAVEAT: Final = (
    "2024 caveat (preregistration section 4): a pass on 2024 is weaker evidence than a first look at an "
    "untouched season. (6) Three artifacts fitted on 2023 and 2024 (preseason/priors, "
    "market/props-anchor-weight, preseason/game-variance-skill, version 1 only) stand behind m's 2024 inputs, "
    "so a 2024 outcome sits inside a 2024 input of m, flattering m against form in G2. (1) No weekly model was "
    "judged on 2024 before. (2) The rest-of-season round 3 judgment gated 2024 weeks 8 and 12 (failed 3 of 49 "
    "lines); weeks 8 to 17 here are parts of its sums. (3) The rest-of-season rounds 1 and 2 development "
    "checks computed 2024 ordering. (4) On 2024 season-to-date form ordered about as well as the "
    "rest-of-season model. (5) Round 1's development check computed 2024 single-week ordering."
)


def development_record(path: Path = DEVELOPMENT_RECORD) -> dict[str, Any] | None:
    """The committed development check's record, or None when it is not in this tree."""
    if not path.exists():
        return None
    found: dict[str, Any] = json.loads(path.read_text())
    return found


def stop_rule_refusal(record: Mapping[str, Any] | None) -> str | None:
    """Why the judgment may not run under section 4's stop rule, or None when the check passed G2
    pooled against recent form."""
    if record is None:
        return f"no development check record ({DEVELOPMENT_RECORD.name}); the judgment runs only after the check"
    for line in record.get("gates", []):
        if (line.get("gate"), line.get("subject")) == DECIDING:
            if line.get("passed") is True:
                return None
            return "the stop rule (section 4): the development check failed G2 pooled against recent form; the round ended, 2024 is not judged"
    return f"the development check record names no {DECIDING[0]} {DECIDING[1]} line"


def thresholds_for(
    command: str,
    committed: Callable[[], bool] = lambda: preregistration_committed(PREREGISTRATION_COMMIT),
    exists: Callable[[Path], bool] = Path.exists,
    record: Callable[[], Mapping[str, Any] | None] = development_record,
) -> Thresholds:
    """The constant a command runs under, or the refusal: the judgment needs the lock in its history,
    a development check that passed G2 pooled (the stop rule), and is taken once."""
    if command != "judge":
        return DEVELOPMENT_CHECK
    if not committed():
        raise ConfigurationError(
            f"the preregistration's commit {PREREGISTRATION_COMMIT} is not in this tree's history; no judgment without the lock"
        )
    refused = stop_rule_refusal(record())
    if refused is not None:
        raise ConfigurationError(refused)
    for taken in (JUDGMENT_CLAIM, JUDGMENT_RECORD):
        if exists(taken):
            raise ConfigurationError(f"the 2024 judgment was taken once ({taken.name}); it is never rerun")
    return ROUND_THREE


def check_round_scratch(command: str, url: str) -> None:
    check_scratch_url(url, JUDGMENT_PREFIXES if command == "judge" else DEVELOPMENT_PREFIXES)


def decision(command: str, lines: Sequence[GateLine]) -> str:
    """The decision rule (section 5) for the judgment; the stop rule (section 4) for the check."""
    passed = verdict(lines)
    if command == "judge":
        if passed:
            return f"DECISION: all {GATE_LINES} lines pass; the weekly number ships"
        return "DECISION: a line failed or cannot answer; nothing ships"
    deciding = next((g for g in lines if (g.gate, g.subject) == DECIDING), None)
    if deciding is None or not deciding.passed:
        return "STOP RULE: the development check fails G2 pooled against recent form; the round ends, no judgment"
    return f"DEVELOPMENT CHECK: {sum(g.passed for g in lines)} of {len(lines)} lines pass; G2 pooled passes, the judgment may run"


def fitted_payload(fitted: Fitted, ranges: Ranges) -> dict[str, Any]:
    stage = fitted.stage
    return {
        "stage_one": {
            key: {
                "columns": list(line.columns),
                "coefficients": list(line.coefficients),
                "rows": line.rows,
                "rank": line.rank,
            }
            for key, line in stage.lines.items()
        },
        "club_means": asdict(stage.fallback),
        "red_zone": {key: asdict(found) for key, found in fitted.red_zone.items()},
        "range": ranges.payload(),
    }


def _render(command: str, fitted: RoundFit, judged: Judgment, lines: Sequence[GateLine]) -> list[str]:
    seconds = ", ".join(f"{name} {value:.1f}s" for name, value in fitted.seconds.items())
    report = [
        f"fit: {fitted.fit_rows} fit-population rows with a number, {fitted.stage_rows} with stage-1 inputs; {seconds}",
        f"judged: {judged.rows} population rows",
    ]
    report += [f"{'PASS' if g.passed else 'FAIL'}  {g.gate} {g.subject:<24} {g.detail}" for g in lines]
    report.append(decision(command, lines))
    if command == "judge":
        report.append(EXPOSURE_CAVEAT)
    return report


def _payload(  # noqa: PLR0913, PLR0917 - every part of the record, named
    command: str, t: Thresholds, fitted: RoundFit, judged: Judgment, lines: Sequence[GateLine], extra: dict[str, Any]
) -> dict[str, Any]:
    return {
        "model": t.model_name,
        "command": command,
        "implementation": IMPLEMENTATION,
        "arithmetic": ARM64_BOARDS.label,
        "preregistration": {"path": PREREGISTRATION, "commit": PREREGISTRATION_COMMIT},
        "thresholds": thresholds_payload(t),
        "rate": {"record": t.rate_record, "equal_to_record": True, "fit_rows": fitted.rate.rows},
        "fitted": fitted_payload(fitted.fitted, fitted.ranges),
        "ablation_elasticities": elasticities_payload(fitted.elasticities),
        "fit_rows": fitted.fit_rows,
        "stage_rows": fitted.stage_rows,
        "fit_reported": dict(fitted.reported),
        "board_moments": {**{str(s): m for s, m in fitted.board_moments.items()}, str(t.judgment_season): judged.numbers["board_moment"]},
        "outcome_seasons_read": {"fit": sorted(set(fitted.served)), "judgment": sorted(set(judged.served))},
        "gates": [asdict(line) for line in lines],
        "passed": verdict(lines),
        "numbers": dict(judged.numbers),
        "caveat": EXPOSURE_CAVEAT if command == "judge" else None,
        **extra,
    }  # fmt: skip


def _run(command: str, url: str, t: Thresholds, out: Path) -> int:
    started = time.monotonic()
    status = tree_status()
    check_round_scratch(command, url)
    version = model_version()
    engine = make_engine(sqlalchemy_url(url))
    try:
        with engine.connect() as conn:
            conn.execute(text("set transaction read only"))
            guard_queries(conn, closed_seasons(t))
            counts = read_counts(conn, t)
            missing = missing_preconditions(counts, t)
            if missing:
                raise ConfigurationError("the round's preconditions are not met: " + "; ".join(missing))
            if command == "judge":  # claimed after the preconditions, before any outcome is read
                claim_judgment(out, version, JUDGMENT_CLAIM)
            before = table_digests(conn)
            artifacts = load_model_artifacts(conn)
            positions = all_positions(conn)
            fitted, _ = fit_round(conn, t, artifacts, fit_reader(t), positions)
            judged = judge_round(conn, t, fitted, artifacts, positions, version, judgment_reader(t))
            after = table_digests(conn)
    finally:
        engine.dispose()
    clause = per_game_clause((*fitted.games, *judged.games), (*fitted.stamps, *judged.stamps))
    lines = [*judged.lines, isolation_line(fitted.served, judged.served, before, after, clause, t)]
    report = _render(command, fitted, judged, lines)
    for line in report:
        log_line(line)
    extra = {
        "model_version": version,
        "preconditions": preconditions_payload(counts, t),
        "digests": {"before": before, "after": after},
        "seconds": {**dict(fitted.seconds), "total": time.monotonic() - started},
        "report": report,
        "tree_status": status,
        "tree_clean": not status,
    }
    out.write_text(json.dumps(_payload(command, t, fitted, judged, lines, extra), indent=1, default=str))
    return 0 if verdict(lines) or command == "develop" else 1


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m research.model.weekly3.round")
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
