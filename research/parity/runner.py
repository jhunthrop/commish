"""RUNNING ONE CASE: scratch databases, both ingests on the same recorded input, a diff after every pass.

THE PASSES. A nightly run lands on yesterday's rows, not on an empty database, so a case is not
judged on a cold start alone:

1. `first`: both sides into empty databases.
2. `rerun`: both sides again, on top of their own first pass, from the same recordings. Every
   upsert's conflict branch, every changed-row check, every insert-or-ignore and every
   supersede (the live season's week-one rosters) runs here, against real rows.
3. `prior` then `later`, on a second pair of empty databases, when the case names an earlier
   recording: the earlier release lands first and today's lands on top of it.

The databases are diffed after each pass. A pass fails on any differing row, on a declared table
that is empty on both sides (a vacuous comparison), on the two sides asking for different
recordings, or on different exit statuses from the operator scripts.

THE DATABASES. The TypeScript side's is cloned from a template migrated by the drizzle journal, the
Python side's from one migrated by alembic; the `Harness` owns both templates for one harness run,
and every case drops its own databases when it ends.
"""

import json
import os
import subprocess
import tempfile
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Final

from research.db.engine import make_engine
from research.db.url import sqlalchemy_url
from research.parity import databases
from research.parity.case import Case, RunContext
from research.parity.diff import TableDiff, diff_table
from research.parity.replay import FIXTURES_ROOT, ReplayFetcher
from research.pipeline.jscompat import js_iso

TS_DRIVER: Final = databases.RESEARCH_ROOT / "parity" / "ts" / "run.ts"
TS_PRELOAD: Final = databases.RESEARCH_ROOT / "parity" / "ts" / "preload.ts"
_STDERR_TAIL: Final = 4000
# Long enough for the largest case (a 500,000-row roster release); a side that runs past it is hung
# (an oracle script that fails without closing its database client never exits), and fails its case.
_SIDE_TIMEOUT_SECONDS: Final = 900
# An operator script's two success statuses: clean, and THIN (rows written, comparison unsafe).
_SCRIPT_SUCCESS: Final = frozenset({0, 2})


@dataclass(frozen=True)
class SideRun:
    requested: tuple[str, ...]
    statuses: tuple[int, ...]


@dataclass(frozen=True)
class PassResult:
    name: str
    diffs: tuple[TableDiff, ...]
    ts: SideRun
    py: SideRun

    @property
    def same_requests(self) -> bool:
        return sorted(self.ts.requested) == sorted(self.py.requested)

    @property
    def same_statuses(self) -> bool:
        return self.ts.statuses == self.py.statuses

    @property
    def matches(self) -> bool:
        return self.same_requests and self.same_statuses and all(d.matches for d in self.diffs)


@dataclass(frozen=True)
class CaseResult:
    case: Case
    passes: tuple[PassResult, ...]
    # Why the case could not finish (one side raised); a case with an error never matches.
    error: str | None = None

    @property
    def matches(self) -> bool:
        return self.error is None and all(p.matches for p in self.passes)

    @property
    def rows_compared(self) -> int:
        return sum(d.rows for p in self.passes for d in p.diffs)


@dataclass(frozen=True)
class Harness:
    """One harness run's templates. Built by `open_harness`, dropped by `close_harness`."""

    ts_template: str = "parity_template_ts"
    py_template: str = "parity_template_py"


def open_harness() -> Harness:
    """Drop every `parity_*` leftover on the server, then build the two templates."""
    databases.drop_scratch_databases()
    harness = Harness()
    databases.build_with_drizzle(harness.ts_template)
    databases.build_with_alembic(harness.py_template)
    return harness


def close_harness(harness: Harness) -> None:
    databases.drop(harness.ts_template)
    databases.drop(harness.py_template)


def _fixture_dirs(sets: Sequence[str]) -> list[Path]:
    return [FIXTURES_ROOT / name for name in sets]


def _ts_env(case: Case, url: str) -> dict[str, str]:
    # TZ=UTC because production runs the TypeScript under UTC, and V8 reads an offset-less
    # date-time string as local time: the oracle is the production behaviour, not this laptop's.
    # The provider keys are placeholders: every request is answered from the recordings, and the
    # oracle only checks that a key is present.
    return {
        **os.environ,
        "DATABASE_URL": url,
        "PARITY_NOW": js_iso(case.now),
        "NODE_NO_WARNINGS": "1",
        "TZ": "UTC",
        "ODDS_API_KEY": "replay",
        "TANK01_API_KEY": "replay",
    }


def _run_ts_case(case: Case, url: str, dirs: list[Path]) -> list[str]:
    completed = subprocess.run(
        ["npx", "tsx", str(TS_DRIVER), case.name, *[str(d) for d in dirs]],
        cwd=databases.REPO_ROOT,
        env=_ts_env(case, url),
        capture_output=True,
        text=True,
        check=False,
        timeout=_SIDE_TIMEOUT_SECONDS,
    )
    if completed.returncode != 0:
        raise RuntimeError(f"TypeScript side of {case.name} failed:\n{completed.stderr[-_STDERR_TAIL:]}")
    payload: dict[str, list[str]] = json.loads(completed.stdout.strip().splitlines()[-1])
    return payload["requested"]


def _run_ts_scripts(case: Case, url: str, dirs: list[Path]) -> tuple[list[str], list[int]]:
    requested: list[str] = []
    statuses: list[int] = []
    for script in case.ts_scripts:
        with tempfile.TemporaryDirectory() as scratch:
            out = Path(scratch) / "requested.json"
            env = {
                **_ts_env(case, url),
                "PARITY_FIXTURE_DIRS": "\n".join(str(d) for d in dirs),
                "PARITY_REQUESTED_OUT": str(out),
            }
            command = ["npx", "tsx", "--import", str(TS_PRELOAD), script.path, *script.args]
            completed = subprocess.run(
                command,
                cwd=databases.REPO_ROOT,
                env=env,
                capture_output=True,
                text=True,
                check=False,
                timeout=_SIDE_TIMEOUT_SECONDS,
            )
            if completed.returncode not in _SCRIPT_SUCCESS:
                raise RuntimeError(f"{script.path} for {case.name} failed:\n{completed.stderr[-_STDERR_TAIL:]}")
            statuses.append(completed.returncode)
            requested.extend(json.loads(out.read_text())["requested"])
    return requested, statuses


def _run_typescript(case: Case, url: str, sets: Sequence[str]) -> SideRun:
    dirs = _fixture_dirs(sets)
    requested = _run_ts_case(case, url, dirs)
    script_requested, statuses = _run_ts_scripts(case, url, dirs)
    return SideRun(tuple(requested + script_requested), tuple(statuses))


def _run_python(case: Case, url: str, sets: Sequence[str]) -> SideRun:
    fetcher = ReplayFetcher(_fixture_dirs(sets))
    engine = make_engine(sqlalchemy_url(url))
    try:
        with engine.connect() as conn:
            statuses = case.run_python(conn, RunContext(fetcher=fetcher, now=case.now, checkpoint=conn.commit))
            conn.commit()
    finally:
        engine.dispose()
    return SideRun(tuple(fetcher.requested), statuses)


def _pass(name: str, case: Case, urls: tuple[str, str], sets: Sequence[str]) -> PassResult:
    ts = _run_typescript(case, urls[0], sets)
    py = _run_python(case, urls[1], sets)
    diffs = tuple(diff_table(urls[0], urls[1], spec) for spec in case.tables)
    return PassResult(name, diffs, ts, py)


def _pair(harness: Harness, case: Case, suffix: str) -> tuple[str, str]:
    slug = f"{case.name.replace('-', '_')}_{suffix}"
    return (
        databases.clone(harness.ts_template, f"parity_{slug}_ts"),
        databases.clone(harness.py_template, f"parity_{slug}_py"),
    )


def _drop_pair(case: Case, suffix: str) -> None:
    slug = f"{case.name.replace('-', '_')}_{suffix}"
    databases.drop(f"parity_{slug}_ts")
    databases.drop(f"parity_{slug}_py")


def run_case(harness: Harness, case: Case) -> CaseResult:
    """Every pass of one case. A side that raises ends the case as a failure with its message, and
    the harness goes on to the next case: one broken ingest must not hide the state of the rest."""
    passes: list[PassResult] = []
    error: str | None = None
    try:
        urls = _pair(harness, case, "a")
        passes.append(_pass("first", case, urls, case.fixture_sets))
        passes.append(_pass("rerun", case, urls, case.fixture_sets))
        if case.prior_fixture_sets:
            urls = _pair(harness, case, "b")
            passes.append(_pass("prior", case, urls, case.prior_fixture_sets))
            passes.append(_pass("later", case, urls, case.fixture_sets))
    except Exception as failure:  # reported as the case failure, never swallowed
        error = f"{type(failure).__name__}: {failure}"
    finally:
        _drop_pair(case, "a")
        _drop_pair(case, "b")
    return CaseResult(case, tuple(passes), error)
