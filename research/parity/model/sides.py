"""THE ORACLE'S SIDE OF A MODEL CASE: `ts/model.ts` run against a database, its JSON lines and its
refusal. The port's side runs in-process (`boards.port_boards`, the register and fit modules)."""

import json
import os
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Final

_REPO: Final = Path(__file__).resolve().parents[3]
_DRIVER: Final = _REPO / "research" / "parity" / "ts" / "model.ts"
_TIMEOUT_SECONDS: Final = 900


@dataclass(frozen=True, slots=True)
class OracleRun:
    lines: list[Any]
    error: str | None


def run_oracle(database_url: str, *args: str) -> OracleRun:
    """`ts/model.ts <args>` against a database: its JSON lines, and its refusal if it threw."""
    completed = subprocess.run(
        ["npx", "tsx", str(_DRIVER), *args],
        cwd=_REPO,
        capture_output=True,
        text=True,
        timeout=_TIMEOUT_SECONDS,
        env={**os.environ, "DATABASE_URL": database_url},
        check=False,
    )
    lines = [json.loads(line) for line in completed.stdout.splitlines() if line.startswith("{") or line.startswith("[")]
    error = None if completed.returncode == 0 else _first_error_line(completed.stderr)
    return OracleRun(lines, error)


def _first_error_line(stderr: str) -> str:
    """The thrown error as node prints it (`Error: <the whole message>`)."""
    for line in stderr.splitlines():
        stripped = line.strip()
        if stripped.startswith("Error:") or stripped.startswith("DrizzleQueryError"):
            return stripped
    return stderr.strip().splitlines()[-1] if stderr.strip() else "the oracle exited non-zero"
