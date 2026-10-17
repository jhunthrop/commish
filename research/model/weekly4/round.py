"""THE ROUND'S COMMAND LINE: the development check and the one judgment of `commish_weekly_v4`.

    uv run python -m research.model.weekly4.round develop --database <scratch> --features <dir> [--out <file>]
    uv run python -m research.model.weekly4.round judge --database <scratch> --features <dir> --out <file>

Both name their database explicitly and run only on a local scratch copy on 5433 (the judgment on a
`lane70_` copy, 6.3; the development check also on the model lane's `lane69_` copy), in one read-only
transaction whose every statement is refused if it names a closed season (round 2's guard: 2025 and
2026 for the judgment, 2024 on for the check). `--features` names the feature store's build
(`python -m research.model.weekly4.features history ... --depth-chart <the recorded verdict>`); its
files are read with their digests checked against the build's report.

`develop`: fit on 2021 to 2022 for the player-level models and 2016 to 2022 forward-chained for the
play and team models, check on 2023 weeks 6 to 17, every gate line reported, the stop rule read
(3.2: a check that fails G2 pooled or G6 pooled ends the round). `judge`: fit on 2021 to 2023 and 2016
to 2023, judge 2024 weeks 6 to 17 once, the decision rule, the whole output to JSON. The judgment
refuses unless the lock and the amendment commits are in this tree's history, the preconditions pass,
a committed development record shows the stop rule unmet, and no claim or record exists; it claims
an exclusive file before any 2024 row is read; the five tables are digested before and after.
"""

import argparse
import json
import logging
import subprocess
import sys
import time
from collections.abc import Callable, Mapping, Sequence
from dataclasses import asdict, fields
from pathlib import Path
from typing import Any, Final

import pandas as pd
from sqlalchemy import Connection, text

from research.cli import log_line
from research.db.engine import make_engine
from research.db.url import sqlalchemy_url
from research.errors import ConfigurationError
from research.logging_setup import configure_logging
from research.model.arithmetic import model_version
from research.model.domain import Position
from research.model.priors import ModelArtifacts, load_model_artifacts
from research.model.reads.preseason import all_positions
from research.model.register.freeze import IMPLEMENTATION
from research.model.ros.scratch import check_scratch_url
from research.model.weekly.round.judge import table_digests
from research.model.weekly2.gates import GateLine
from research.model.weekly2.guard import closed_seasons, guard_queries
from research.model.weekly2.judge import DOCS
from research.model.weekly2.round import claim_judgment, tree_status
from research.model.weekly3.ledger import per_game_clause
from research.model.weekly4 import gates
from research.model.weekly4.files import build_report, load_store
from research.model.weekly4.gates import DEVELOPMENT_CHECK, GATE_LINES, ROUND_FOUR, RoundFour
from research.model.weekly4.margins import MarginReader, margins
from research.model.weekly4.preconditions import depth_chart_verdict, payload, read_counts
from research.model.weekly4.preconditions import missing_preconditions as missing_round_four
from research.model.weekly4.reporting import fitted_payload, judge_season, stage_digests
from research.model.weekly4.round_three import (
    RoundThree,
    fit_season_reads,
    lines_of,
    rates,
    reproduction,
    run_round_three,
)
from research.model.weekly4.system import Extras, dispersion_seasons, fit_system

_ROOT: Final = Path(__file__).resolve().parents[3]
PREREGISTRATION: Final = "docs/research/2026-10-16-weekly-projection-round4-preregistration.md"
LOCK: Final = "b56c05d8"
AMENDMENTS: Final = ("65cc5b96", "f358f375", "b3796049")  # section 7: amendments 1, 2 and 3
JUDGMENT_RECORD: Final = DOCS / "2026-10-16-weekly-projection-round4-results.json"
JUDGMENT_CLAIM: Final = DOCS / "2026-10-16-weekly-projection-round4-judgment-taken.json"
DEVELOPMENT_RECORD: Final = DOCS / "2026-10-16-weekly-projection-round4-dev-check.json"
JUDGMENT_PREFIXES: Final = ("lane70_",)  # 6.3: "The round's scratch guard admits only a `lane70_` database on 5433"
DEVELOPMENT_PREFIXES: Final = ("lane69_", "lane70_")  # and the model lane's development copy
STOPPING: Final = (("G2", "pooled vs recent form"), ("G6", "pooled vs the expert's spreadsheet"))
PROVISIONAL: Final = (
    '2024 is read as provisional (preregistration section 5): the fit-round close-out ruled "After it, 2024 '
    'is spent for selection purposes: future configurations wait for the 2026 judge". This judgment is not '
    "a selection, but it is one more confirmatory read of a season several reads have eroded, in the "
    "direction of a pass; the test that cannot be eroded is the 2026 register's two fixed looks (3.3)."
)
EXPOSURE: Final = (
    "2024's exposure (section 5): (6) three artifacts fitted on 2023 and 2024 (preseason/priors v1, "
    "market/props-anchor-weight v1, preseason/game-variance-skill v1) stand behind m's 2024 inputs, flattering m "
    "against form in G2, and m is an input here; (1) no weekly model was judged on 2024; (2) the rest-of-season "
    "round 3 judgment gated 2024 weeks 8 and 12, whose sums hold weeks 8 to 17; (3) the rest-of-season rounds 1 "
    "and 2 development checks computed 2024 ordering and fitted on it; (4) the rest-of-season round 3 results "
    "recorded that form ordered 2024 about as well as the model; (5) round 1's development check computed 2024 "
    "single-week ordering; (7) the fit-round close-out's ruling and the reads it describes; (8) round 3's number "
    "is computed on 2024 here as G7's benchmark, and none of its numbers carries a verdict for round 3."
)


def commits_present(commits: Sequence[str] = (LOCK, *AMENDMENTS)) -> list[str]:
    """The named commits that are not ancestors of HEAD."""
    absent = []
    for commit in commits:
        found = subprocess.run(
            ["git", "merge-base", "--is-ancestor", commit, "HEAD"], cwd=_ROOT, capture_output=True, check=False
        )
        if found.returncode != 0:
            absent.append(commit)
    return absent


def head_commit() -> str:
    return subprocess.run(
        ["git", "rev-parse", "HEAD"], cwd=_ROOT, capture_output=True, text=True, check=True
    ).stdout.strip()


def development_record(path: Path = DEVELOPMENT_RECORD) -> dict[str, Any] | None:
    if not path.exists():
        return None
    found: dict[str, Any] = json.loads(path.read_text())
    return found


def stop_rule_refusal(record: Mapping[str, Any] | None) -> str | None:
    """Why the judgment may not run under 3.2's stop rule, or None when the check passed G2 pooled and
    G6 pooled."""
    if record is None:
        return f"no development check record ({DEVELOPMENT_RECORD.name}); the judgment runs only after the check"
    lines = {(line.get("gate"), line.get("subject")): line.get("passed") for line in record.get("gates", [])}
    for key in STOPPING:
        if key not in lines:
            return f"the development check record names no {key[0]} {key[1]} line"
        if lines[key] is not True:
            return f"the stop rule (3.2): the development check failed {key[0]} {key[1]}; the round ended, 2024 is not judged"
    return None


def thresholds_for(
    command: str,
    absent: Callable[[], list[str]] = commits_present,
    exists: Callable[[Path], bool] = Path.exists,
    record: Callable[[], Mapping[str, Any] | None] = development_record,
) -> RoundFour:
    """The constant a command runs under, or the refusal."""
    if command != "judge":
        return DEVELOPMENT_CHECK
    missing = absent()
    if missing:
        raise ConfigurationError(
            f"the lock and amendment commits {missing} are not in this tree's history; no judgment without them"
        )
    refused = stop_rule_refusal(record())
    if refused is not None:
        raise ConfigurationError(refused)
    for taken in (JUDGMENT_CLAIM, JUDGMENT_RECORD):
        if exists(taken):
            raise ConfigurationError(f"the 2024 judgment was taken once ({taken.name}); it is never rerun")
    return ROUND_FOUR


def decision(command: str, lines: Sequence[GateLine]) -> str:
    """The decision rule (3.2) for the judgment; the stop rule for the check."""
    passed = gates.verdict(lines)
    if command == "judge":
        if passed:
            return f"DECISION: all {GATE_LINES} lines pass; the weekly number ships (provisional, section 5)"
        return "DECISION: a line failed or cannot answer; nothing ships"
    stopped = [f"{g} {s}" for g, s in STOPPING if not any((x.gate, x.subject) == (g, s) and x.passed for x in lines)]
    if stopped:
        return f"STOP RULE: the development check fails {' and '.join(stopped)}; the round ends, no judgment"
    return f"DEVELOPMENT CHECK: {sum(g.passed for g in lines)} of {len(lines)} lines pass; G2 and G6 pooled pass, the judgment may run"


def thresholds_payload(t: RoundFour) -> dict[str, Any]:
    found: dict[str, Any] = {}
    for field in fields(t):
        value = getattr(t, field.name)
        if field.name == "round_three":
            value = {
                "model_name": value.model_name,
                "fit_seasons": list(value.fit_seasons),
                "judgment_season": value.judgment_season,
            }
        elif hasattr(value, "items"):
            value = dict(value)
        found[field.name] = value
    return found


def _store_clause(report: Mapping[str, Any]) -> tuple[bool, str]:
    """The store's per-game clause (its build's report): no broken read and both clauses held."""
    seasons = report["seasons"]
    broken = sum(int(s["stamps"]["broken"]) for s in seasons)
    held = all(s["clause"]["team"]["holds"] and s["clause"]["player"]["holds"] is not False for s in seasons)
    return (
        broken == 0 and held,
        f"the store: {broken} broken reads over {len(seasons)} seasons, clauses {'held' if held else 'broken'}",
    )


def _extras(  # noqa: PLR0913, PLR0917 - the fit weeks' reads, named
    conn: Connection,
    t: RoundFour,
    r3: RoundThree,
    artifacts: ModelArtifacts,
    positions: Mapping[str, Position],
    teams: pd.DataFrame,
) -> tuple[Extras, Any, tuple[int, ...]]:
    reads, reader = fit_season_reads(conn, t.round_three, r3.fit, artifacts, positions, t.fit_weeks)
    margin_reader = MarginReader(frozenset(dispersion_seasons(t)))
    allowed = []
    for season in dispersion_seasons(t):
        found, margin_reader = margin_reader.season(conn, season)
        allowed.append(found)
    pairing = teams[["season", "week", "club", "opponent"]]
    extras = Extras(
        rates([*reads, r3.judged], t.population),
        pd.concat([lines_of(r) for r in [*reads, r3.judged]], ignore_index=True),
        margins(pd.concat(allowed, ignore_index=True), pairing),
    )
    clause = per_game_clause(tuple(g for r in reads for g in r.games), tuple(s for r in reads for s in r.all_stamps))
    return extras, clause, (*reader.served, *margin_reader.served)


def _run(command: str, url: str, features: Path, t: RoundFour, out: Path) -> int:
    started = time.monotonic()
    status = tree_status()
    check_scratch_url(url, JUDGMENT_PREFIXES if command == "judge" else DEVELOPMENT_PREFIXES)
    version = model_version()
    report = build_report(features)
    built = {s["depth_chart_rule"] for s in report["seasons"]}
    store = load_store(features, range(2016, t.judgment_season + 1), (*t.player_fit_seasons, t.judgment_season))
    engine = make_engine(sqlalchemy_url(url))
    try:
        with engine.connect() as conn:
            conn.execute(text("set transaction read only"))
            guard_queries(conn, closed_seasons(t.round_three))
            counts = read_counts(conn, t)
            verdict = depth_chart_verdict()
            missing = missing_round_four(counts, t, verdict, next(iter(built)) if len(built) == 1 else None)
            if missing:
                raise ConfigurationError("the round's preconditions are not met: " + "; ".join(missing))
            before = table_digests(conn)
            artifacts = load_model_artifacts(conn)
            positions = all_positions(conn)
            dev_three = run_round_three(conn, DEVELOPMENT_CHECK.round_three, artifacts, positions, version)
            unreproduced = reproduction(dev_three.lines)
            if unreproduced:
                raise ConfigurationError(
                    "round 3's code does not reproduce its 26 recorded lines: " + "; ".join(unreproduced[:3])
                )
            if command == "judge":  # claimed after the preconditions, before any 2024 row is read
                claim_judgment(out, version, JUDGMENT_CLAIM)
                r3 = run_round_three(conn, t.round_three, artifacts, positions, version)
            else:
                r3 = dev_three
            extras, read_clause, extra_served = _extras(conn, t, r3, artifacts, positions, store.teams)
            after = table_digests(conn)
    finally:
        engine.dispose()
    fitted = fit_system(store, extras, t)
    judged = judge_season(t, fitted, r3.rows, extras.lines, store, judgment=command == "judge")
    r3_clause = next(line for line in r3.lines if line.gate == "G5")
    store_clause = _store_clause(report)
    held = r3_clause.passed and read_clause[0] and store_clause[0]
    detail = f"round 3's reads: {r3_clause.detail.split('per-game clause: ')[-1]}; the fit weeks' reads: {read_clause[1]}; {store_clause[1]}"
    served = {
        "plays and teams": fitted.served["plays and teams"],
        "players": tuple(sorted({*fitted.served["players"], *(s for s in r3.fit.served), *extra_served})),
        "judged": tuple(sorted({s for s in r3.served if s not in r3.fit.served} | {t.judgment_season})),
    }
    lines = [*judged.lines, gates.isolation_line(served, before, after, (held, detail), t)]
    rendered = [
        *([PROVISIONAL, EXPOSURE] if command == "judge" else []),
        f"fit seconds: {', '.join(f'{k} {v:.0f}' for k, v in fitted.seconds.items())}",
        f"judged: {judged.rows} population rows",
        *(f"{'PASS' if g.passed else 'FAIL'}  {g.gate} {g.subject:<36} {g.detail}" for g in lines),
        decision(command, lines),
    ]
    for line in rendered:
        log_line(line)
    record = {
        "model": t.model_name,
        "command": command,
        "implementation": IMPLEMENTATION,
        "model_version": version,
        "preregistration": {"path": PREREGISTRATION, "lock": LOCK, "amendments": list(AMENDMENTS)},
        "head": head_commit(),
        "provisional": PROVISIONAL if command == "judge" else None,
        "exposure": EXPOSURE if command == "judge" else None,
        "thresholds": thresholds_payload(t),
        "features": {"directory": str(features), "digests": dict(store.digests), "depth_chart_rule": sorted(built)},
        "preconditions": payload(counts, t, verdict, next(iter(built)) if len(built) == 1 else None),
        "round_three": {"lines": [asdict(line) for line in r3.lines], "development_check_reproduced": True},
        "fitted": fitted_payload(fitted),
        "outcome_seasons_read": {name: list(found) for name, found in served.items()},
        "gates": [asdict(line) for line in lines],
        "passed": gates.verdict(lines),
        "decision": decision(command, lines),
        "numbers": dict(judged.numbers),
        "stage_digests": stage_digests(fitted, judged),
        "digests": {"before": before, "after": after},
        "seconds": {**fitted.seconds, "total": time.monotonic() - started},
        "report": rendered,
        "tree_status": status,
        "tree_clean": not status,
    }
    out.write_text(json.dumps(record, indent=1, default=str))
    return 0 if gates.verdict(lines) or command == "develop" else 1


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m research.model.weekly4.round")
    sub = parser.add_subparsers(dest="command", required=True)
    develop = sub.add_parser("develop", help="fit on 2021-2022 and 2016-2022, check on 2023 weeks 6-17; nothing ships")
    develop.add_argument("--database", required=True)
    develop.add_argument("--features", type=Path, required=True)
    develop.add_argument("--out", type=Path, default=DEVELOPMENT_RECORD)
    judge = sub.add_parser("judge", help="fit on 2021-2023 and 2016-2023, judge 2024 weeks 6-17 once")
    judge.add_argument("--database", required=True)
    judge.add_argument("--features", type=Path, required=True)
    judge.add_argument("--out", type=Path, required=True)
    args = parser.parse_args(argv)
    configure_logging(logging.WARNING)
    return _run(args.command, args.database, args.features, thresholds_for(args.command), args.out)


if __name__ == "__main__":
    sys.exit(main())
