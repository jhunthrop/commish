"""RUNNING ONE CASE: two scratch databases, two ingests on one recorded input, one diff.

The TypeScript database is migrated by drizzle (the oracle's own schema, every app table
included); the Python database by alembic (this lane's schema). Both are cloned from per-run
templates so the migration cost is paid once per harness run, not once per case. The TypeScript
side runs as a subprocess (`npx tsx research/parity/ts/run.ts`), the Python side in process, both
replaying the same fixture sets and reading the same fixed instant as now.
"""

import json
import os
import subprocess
from dataclasses import dataclass
from functools import cache
from pathlib import Path

import psycopg

from research.db.engine import make_engine
from research.db.url import sqlalchemy_url
from research.parity import databases
from research.parity.case import Case, RunContext
from research.parity.diff import TableDiff, diff_table
from research.parity.replay import FIXTURES_ROOT, ReplayFetcher
from research.pipeline.jscompat import js_iso

TS_DRIVER = databases.RESEARCH_ROOT / "parity" / "ts" / "run.ts"
TS_TEMPLATE = "parity_template_ts"
PY_TEMPLATE = "parity_template_py"


@dataclass(frozen=True)
class CaseResult:
    case: Case
    diffs: list[TableDiff]
    ts_requests: list[str]
    py_requests: list[str]

    @property
    def rows_compared(self) -> int:
        return sum(max(d.ts_rows, d.py_rows) for d in self.diffs)

    @property
    def matches(self) -> bool:
        same_requests = sorted(self.ts_requests) == sorted(self.py_requests)
        return same_requests and self.rows_compared > 0 and all(d.matches for d in self.diffs)


@cache
def templates() -> tuple[str, str]:
    """Build the two template databases once per process."""
    databases.build_with_drizzle(TS_TEMPLATE)
    databases.build_with_alembic(PY_TEMPLATE)
    return TS_TEMPLATE, PY_TEMPLATE


def clone(template: str, database: str) -> str:
    if databases.SCRATCH_NAME.fullmatch(database) is None:
        raise ValueError(f"scratch databases are named parity_*, not {database!r}")
    with psycopg.connect(databases.admin_url(), autocommit=True) as conn:
        conn.execute(f'DROP DATABASE IF EXISTS "{database}" WITH (FORCE)')
        conn.execute(f'CREATE DATABASE "{database}" TEMPLATE "{template}"')
    return databases.url_for(database)


def seed(url: str, statements: tuple[str, ...]) -> None:
    if not statements:
        return
    with psycopg.connect(url, autocommit=True) as conn:
        for statement in statements:
            conn.execute(statement.encode())


def fixture_dirs(case: Case) -> list[Path]:
    return [FIXTURES_ROOT / name for name in case.fixture_sets]


def run_typescript(case: Case, url: str) -> list[str]:
    # TZ=UTC because production runs the TypeScript under UTC (Vercel), and V8 reads an offset-less
    # date-time string as local time: the oracle is the production behaviour, not this laptop's.
    env = {**os.environ, "DATABASE_URL": url, "PARITY_NOW": js_iso(case.now), "NODE_NO_WARNINGS": "1", "TZ": "UTC"}
    completed = subprocess.run(
        ["npx", "tsx", str(TS_DRIVER), case.name, *[str(d) for d in fixture_dirs(case)]],
        cwd=databases.REPO_ROOT,
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )
    if completed.returncode != 0:
        raise RuntimeError(f"TypeScript side of {case.name} failed:\n{completed.stderr[-4000:]}")
    last = completed.stdout.strip().splitlines()[-1]
    payload: dict[str, list[str]] = json.loads(last)
    return payload["requested"]


def run_python(case: Case, url: str) -> list[str]:
    fetcher = ReplayFetcher(fixture_dirs(case))
    engine = make_engine(sqlalchemy_url(url))
    try:
        with engine.begin() as conn:
            case.run_python(conn, RunContext(fetcher=fetcher, now=case.now))
    finally:
        engine.dispose()
    return fetcher.requested


def run_case(case: Case) -> CaseResult:
    ts_template, py_template = templates()
    slug = case.name.replace("-", "_")
    ts_url = clone(ts_template, f"parity_{slug}_ts")
    py_url = clone(py_template, f"parity_{slug}_py")
    seed(ts_url, case.seed_sql)
    seed(py_url, case.seed_sql)
    ts_requests = run_typescript(case, ts_url)
    py_requests = run_python(case, py_url)
    diffs = [diff_table(ts_url, py_url, spec) for spec in case.tables]
    return CaseResult(case=case, diffs=diffs, ts_requests=ts_requests, py_requests=py_requests)
