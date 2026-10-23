"""THE SUB-ROUND'S COMMAND LINE: the development check and the one judgment (Amendment 7 items 7 to 12).

    uv run python -m research.model.weekly_kdef check --database <lane157_kdef URL> --features <store dir>
    uv run python -m research.model.weekly_kdef judgment --database <lane157_kdef URL> --features <store dir> --out <file>

Both run only on the coordinator's scratch copy `lane157_kdef` on 5433 (design 7.3), in one read-only
transaction whose every statement binding a closed season is refused (2024 on for the check, 2025 on for
the judgment), on a clean tree whose HEAD descends from the amendment's commit. Each is taken once: it
claims its own exclusive file (`CHECK_CLAIM`, `JUDGMENT_CLAIM`) after its preconditions pass and before any
row of its judged season is read, so a second run is refused even if the first died part way. The
judgment also needs the committed check record, judges only the positions the stop rule left (a position
failing KD1 or KD2 pooled on 2023 is not judged), and prints only those positions' K and DEF lines and the
reported views: nothing club-level of 2024 (item 12). `--features` names round 4's feature store build;
its team files of the run's seasons are read with their digests checked against the build's report.
"""

import argparse
import hashlib
import json
import logging
import subprocess
import sys
import time
from collections.abc import Callable, Mapping, Sequence
from dataclasses import asdict, dataclass, field, fields
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Final

import pandas as pd
from sqlalchemy import Connection, text

from research.cli import log_line
from research.db.engine import make_engine
from research.db.url import sqlalchemy_url
from research.errors import ConfigurationError
from research.logging_setup import configure_logging
from research.model.ros.scratch import check_scratch_url
from research.model.weekly2.gates import GateLine
from research.model.weekly2.guard import guard_queries
from research.model.weekly2.judge import DOCS
from research.model.weekly4.features.depth import DepthRule
from research.model.weekly4.files import build_report, reported_digests
from research.model.weekly4.tuning import BOOSTED_GRID, Cell
from research.model.weekly_kdef import gates
from research.model.weekly_kdef.gates import DEVELOPMENT_CHECK, KDEF_WEEKLY, POSITIONS, KdefWeekly
from research.model.weekly_kdef.outcome import judge
from research.model.weekly_kdef.reads import KdefReader, closed_after

_ROOT: Final = Path(__file__).resolve().parents[3]
PREREGISTRATION: Final = "docs/research/2026-10-16-weekly-projection-round4-preregistration.md"
AMENDMENT: Final = "95adfeb3"  # Amendment 7 item 12, the rulings on the build's readings: the lock
SCRATCH_PREFIXES: Final = ("lane157_kdef",)  # design 7.3: "a scratch copy on 5433 named `lane157_kdef`"
CHECK_RECORD: Final = DOCS / "2026-10-23-weekly-kdef-dev-check.json"
CHECK_CLAIM: Final = DOCS / "2026-10-23-weekly-kdef-dev-check-taken.json"
JUDGMENT_RECORD: Final = DOCS / "2026-10-23-weekly-kdef-results.json"
JUDGMENT_CLAIM: Final = DOCS / "2026-10-23-weekly-kdef-judgment-taken.json"
MEASURED_LAST: Final = 2024  # B132 L5: no count this sub-round makes reads a season after 2024
ARTIFACT_PREFIX: Final = "weekly_kdef/"  # this sub-round's own `model_artifacts` keys
ISOLATED: Final = (
    "preseason_projections",
    "preseason_board_reasons",
    "published_boards",
    "register_freeze_rows",
    "register_grade_rows",
)
PRECONDITIONS: Final = (
    "select season, count(*) filter (where field_goal_result is not null and kick_distance is not null) as goals, "
    "count(*) filter (where extra_point_result is not null) as extra from research.nflverse_pbp_plays "
    "where season = any(:seasons) and play_type in ('field_goal', 'extra_point') group by season"
)
ESPN_WEEKS: Final = (
    "select count(distinct week) from research.espn_kdef_archive_rows where season = :season and week = any(:weeks)"
)


class RefusedError(ConfigurationError):
    """The run may not start."""


def table_digests(conn: Connection) -> dict[str, str]:
    """KD6's tables: each digested whole, `model_artifacts` outside this sub-round's keys."""
    found: dict[str, str] = {}
    queries = {name: f"select * from research.{name}" for name in ISOLATED}
    queries["model_artifacts"] = f"select * from research.model_artifacts where name not like '{ARTIFACT_PREFIX}%'"
    for name, query in queries.items():
        row = conn.execute(
            text(
                f"select count(*) as n, md5(coalesce(string_agg(md5(t::text), '' order by md5(t::text)), '')) as d from ({query}) t"
            )
        ).one()
        found[name] = f"{row.n}:{row.d}"
    return found


def commits_absent(commits: Sequence[str] = (AMENDMENT,)) -> list[str]:
    absent = []
    for commit in commits:
        found = subprocess.run(
            ["git", "merge-base", "--is-ancestor", commit, "HEAD"], cwd=_ROOT, capture_output=True, check=False
        )
        if found.returncode != 0:
            absent.append(commit)
    return absent


def tree_status() -> list[str]:
    found = subprocess.run(["git", "status", "--porcelain"], cwd=_ROOT, capture_output=True, text=True, check=True)
    return found.stdout.splitlines()


def head_commit() -> str:
    return subprocess.run(
        ["git", "rev-parse", "HEAD"], cwd=_ROOT, capture_output=True, text=True, check=True
    ).stdout.strip()


@dataclass(frozen=True, slots=True)
class Setup:
    """Everything a run is bound to; the command line binds the preregistered ones."""

    t: KdefWeekly
    claim: Path
    record: Path | None  # the check record the judgment reads; None for the check
    prefixes: tuple[str, ...] = SCRATCH_PREFIXES
    grid: Sequence[Cell] = BOOSTED_GRID
    absent: Callable[[], list[str]] = commits_absent
    status: Callable[[], list[str]] = tree_status
    head: Callable[[], str] = head_commit
    taken: tuple[Path, ...] = field(default_factory=tuple)  # records that, once present, refuse the run


def judged_positions(record: Mapping[str, Any] | None) -> tuple[str, ...]:
    """The positions the stop rule leaves after the check (item 11), or the refusal."""
    if record is None:
        raise RefusedError("no development check record: the judgment runs only after the check")
    if record.get("command") != "check":
        raise RefusedError("the development check record is not a check's record")
    left = []
    for position in POSITIONS:
        lines = [GateLine(**line) for line in record.get("gates", {}).get(position, [])]
        if not lines:
            raise RefusedError(f"the development check record names no {position} line")
        if not gates.stopped(lines):
            left.append(position)
    if not left:
        raise RefusedError("the stop rule: both positions failed KD1 or KD2 pooled on the check; nothing is judged")
    return tuple(left)


def refusals(command: str, setup: Setup) -> tuple[str, ...]:
    """The run's positions, or the refusal: a dirty tree, the amendment absent, once taken, the stop rule."""
    if setup.t.judgment_season > MEASURED_LAST:
        raise RefusedError(f"the sub-round judges no season after {MEASURED_LAST}")
    dirty = setup.status()
    if dirty:
        raise RefusedError(f"the tree is not clean ({len(dirty)} paths); the run is taken on a committed tree only")
    missing = setup.absent()
    if missing:
        raise RefusedError(f"the amendment's commit {missing} is not in this tree's history")
    for done in (setup.claim, *setup.taken):
        if done.exists():
            raise RefusedError(f"the {command} was taken once ({done.name}); it is never rerun")
    if command == "check":
        return POSITIONS
    record = json.loads(setup.record.read_text()) if setup.record is not None and setup.record.exists() else None
    return judged_positions(record)


def claim(path: Path, out: Path, command: str) -> None:
    """Created exclusively before any judged row is read: a second claim is refused."""
    try:
        with path.open("x") as file:
            json.dump({"command": command, "output": str(out), "claimed_at": datetime.now(UTC).isoformat()}, file)
    except FileExistsError as error:
        raise RefusedError(f"the {command} was taken once ({path.name}); it is never rerun") from error


def preconditions(conn: Connection, t: KdefWeekly) -> list[str]:
    """What the run needs before it may claim: every season's kick plays (Lane 156's backfill) and ESPN's
    archive for every judged week. The counts bind seasons through the judged one only (B132 L5)."""
    seasons = sorted({*t.fit_seasons, t.judgment_season})
    found = {
        int(r.season): (int(r.goals), int(r.extra)) for r in conn.execute(text(PRECONDITIONS), {"seasons": seasons})
    }
    missing = [f"{s} has no field goal with a distance and a result" for s in seasons if found.get(s, (0, 0))[0] == 0]
    weeks = int(conn.execute(text(ESPN_WEEKS), {"season": t.judgment_season, "weeks": list(t.weeks)}).scalar_one())
    if weeks != len(t.weeks):
        missing.append(f"ESPN's archive holds {weeks} of the {len(t.weeks)} judged weeks of {t.judgment_season}")
    return missing


def load_teams(directory: Path, seasons: Sequence[int]) -> tuple[pd.DataFrame, dict[str, str]]:
    """Round 4's store team rows of the run's seasons, each file's digest checked against its build's report."""
    reported = reported_digests(build_report(directory))
    digests: dict[str, str] = {}
    frames = []
    for s in seasons:
        path = directory / f"history-{s}-teams.parquet"
        if not path.exists():
            raise RefusedError(f"the feature store has no {path.name}")
        digests[path.name] = hashlib.sha256(path.read_bytes()).hexdigest()
        frames.append(pd.read_parquet(path))
    moved = sorted(name for name, digest in digests.items() if reported.get(name) != digest)
    if moved:
        raise RefusedError(f"the feature files differ from their build's report: {moved}")
    return pd.concat(frames, ignore_index=True), digests


def depth_rule(report: Mapping[str, Any]) -> DepthRule:
    """The coordinator's recorded depth chart rule, as the store's build carries it (one for every season)."""
    rules = {s.get("depth_chart_rule") for s in report["seasons"]}
    if len(rules) != 1 or next(iter(rules)) not in ("week", "prior"):
        raise RefusedError(
            f"the store's build carries depth chart rules {sorted(map(str, rules))}, not one recorded verdict"
        )
    found: DepthRule = "week" if next(iter(rules)) == "week" else "prior"
    return found


def _payload(t: KdefWeekly) -> dict[str, Any]:
    return {f.name: getattr(t, f.name) for f in fields(t)}


def execute(command: str, url: str, features: Path, out: Path, setup: Setup) -> int:
    started = time.monotonic()
    positions = refusals(command, setup)
    check_scratch_url(url, setup.prefixes)
    t = setup.t
    rule = depth_rule(build_report(features))  # the store's build is there before anything is claimed
    engine = make_engine(sqlalchemy_url(url))
    try:
        with engine.connect() as conn:
            conn.execute(text("set transaction read only"))
            guard_queries(conn, closed_after(t.judgment_season))
            missing = preconditions(conn, t)
            if missing:
                raise RefusedError("the run's preconditions are not met: " + "; ".join(missing))
            before = table_digests(conn)
            claim(setup.claim, out, command)
            teams, digests = load_teams(features, sorted({*t.fit_seasons, t.judgment_season}))
            reader = KdefReader(closed_after(t.judgment_season))
            result = judge(conn, teams, t, reader, setup.grid, positions, before, lambda: table_digests(conn), rule)
    finally:
        engine.dispose()
    rendered = [
        f"{'PASS' if g.passed else 'FAIL'}  {p} {g.gate} {g.subject:<36} {g.detail}"
        for p in positions
        for g in result.lines[p]
    ]
    rendered += [result.decision(command, p) for p in positions]
    for line in rendered:
        log_line(line)
    record = {
        "model": t.model_name,
        "command": command,
        "preregistration": {"path": PREREGISTRATION, "amendment": AMENDMENT},
        "head": setup.head(),
        "thresholds": _payload(t),
        "features": {"directory": str(features), "digests": digests, "depth_chart_rule": rule},
        "positions": list(positions),
        "gates": {p: [asdict(line) for line in result.lines[p]] for p in positions},
        "passed": {p: gates.verdict(result.lines[p]) for p in positions},
        "decision": {p: result.decision(command, p) for p in positions},
        "reported": result.reported,
        "seconds": time.monotonic() - started,
        "report": rendered,
    }
    out.write_text(json.dumps(record, indent=1, default=str))
    return 0 if command == "check" or all(gates.verdict(result.lines[p]) for p in positions) else 1


def setup_for(command: str) -> Setup:
    if command == "check":
        return Setup(DEVELOPMENT_CHECK, CHECK_CLAIM, None, taken=(CHECK_RECORD,))
    return Setup(KDEF_WEEKLY, JUDGMENT_CLAIM, CHECK_RECORD, taken=(JUDGMENT_RECORD,))


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m research.model.weekly_kdef")
    sub = parser.add_subparsers(dest="command", required=True)
    check = sub.add_parser("check", help="fit 2016-2022, check 2023 weeks 3-17 once; nothing ships")
    check.add_argument("--out", type=Path, default=CHECK_RECORD)
    judgment = sub.add_parser("judgment", help="fit 2016-2023, judge 2024 weeks 3-17 once")
    judgment.add_argument("--out", type=Path, default=JUDGMENT_RECORD)
    for command in (check, judgment):
        command.add_argument("--database", required=True)
        command.add_argument("--features", type=Path, required=True)
    args = parser.parse_args(argv)
    configure_logging(logging.WARNING)
    return execute(args.command, args.database, args.features, args.out, setup_for(args.command))


if __name__ == "__main__":
    sys.exit(main())
