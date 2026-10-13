"""SEEDING THE ARTIFACT STORE WITH THE ORACLE'S COMMITTED FITS (version 1 of each).

    RESEARCH_DATABASE_URL=... uv run python -m research.model.seed [export.json]

Runs `research/parity/ts/artifacts.ts` (or reads its saved output) and publishes every payload as
version 1 of its artifact. The fit stamp is the commit that last changed the committed constant,
read from git, so the provenance is a fact about the repository and not the hour the seed ran. A
re-seed of the same payloads is a no-op; a changed payload under version 1 is refused.

After this, nothing the Python board reads comes from a file: the fits are rows.
"""

import json
import subprocess
import sys
from datetime import datetime
from pathlib import Path
from typing import Any, Final

from research.db.engine import make_engine
from research.db.url import database_url_from_env
from research.model.artifacts import publish_artifact

_REPO: Final = Path(__file__).resolve().parents[2]
_EXPORTER: Final = _REPO / "research" / "parity" / "ts" / "artifacts.ts"
_VERSION: Final = 1


def oracle_export() -> dict[str, Any]:
    """The exporter's output: `{name: {payload, file}}`."""
    completed = subprocess.run(["npx", "tsx", str(_EXPORTER)], cwd=_REPO, check=True, capture_output=True, text=True)
    exported: dict[str, Any] = json.loads(completed.stdout)
    return exported


def committed_at(file: str) -> datetime:
    """The commit time of the last change to `file`."""
    completed = subprocess.run(
        ["git", "log", "-1", "--format=%cI", "--", file], cwd=_REPO, check=True, capture_output=True, text=True
    )
    stamp = completed.stdout.strip()
    if not stamp:
        raise LookupError(f"{file} has no commit to stamp its fit with")
    return datetime.fromisoformat(stamp)


def seed(exported: dict[str, Any]) -> list[tuple[str, str]]:
    engine = make_engine(database_url_from_env())
    outcomes: list[tuple[str, str]] = []
    with engine.begin() as conn:
        for name, entry in exported.items():
            file = str(entry["file"])
            fitted_on = f"the committed constant {file} in research-ts, the parity oracle (its fit's own seasons are stated there)"
            outcome = publish_artifact(conn, name, _VERSION, entry["payload"], committed_at(file), fitted_on)
            outcomes.append((name, outcome))
    return outcomes


def main(argv: list[str]) -> int:
    exported = json.loads(Path(argv[0]).read_text()) if argv else oracle_export()
    for name, outcome in seed(exported):
        sys.stdout.write(f"{name:32} v{_VERSION}  {outcome}\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
