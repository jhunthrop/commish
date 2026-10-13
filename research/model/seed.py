"""SEEDING THE ARTIFACT STORE WITH THE ORACLE'S COMMITTED FITS (version 1 of each).

    RESEARCH_DATABASE_URL=... uv run python -m research.model.seed [--restamp] [export.json]

Runs `research/parity/ts/artifacts.ts` (or reads its saved output) and publishes every payload as
version 1 of its artifact, with the provenance `research.model.fit_provenance` states: the fit's
own commit (followed through renames) as the stamp, and in `fitted_on` the oracle module and
export, the seasons, the inputs the store has lost and the re-fit path. A re-seed of the same
payloads is a no-op; a changed payload under version 1 is refused.

`--restamp` corrects the provenance of version-1 rows already published with an identical payload
(the first seed stamped every fit with the commit that moved the oracle's files). It never touches a
payload: a row whose payload differs is refused exactly as a publish would refuse it.

After this, nothing the Python board reads comes from a file: the fits are rows.
"""

import argparse
import json
import subprocess
import sys
from collections.abc import Mapping, Sequence
from datetime import datetime
from pathlib import Path
from typing import Any, Final, Literal

from sqlalchemy import Connection, text

from research.db.engine import make_engine
from research.db.url import database_url_from_env
from research.model.artifacts import ArtifactVersionConflictError, publish_artifact, stable_json
from research.model.fit_provenance import FIT_SOURCES, fit_commit, fitted_on

_REPO: Final = Path(__file__).resolve().parents[2]
_EXPORTER: Final = _REPO / "research" / "parity" / "ts" / "artifacts.ts"
_VERSION: Final = 1

SeedOutcome = Literal["inserted", "unchanged", "restamped"]


def oracle_export() -> dict[str, Any]:
    """The exporter's output: `{name: {payload, file}}`."""
    completed = subprocess.run(["npx", "tsx", str(_EXPORTER)], cwd=_REPO, check=True, capture_output=True, text=True)
    exported: dict[str, Any] = json.loads(completed.stdout)
    return exported


def provenance(name: str, file: str) -> tuple[datetime, str]:
    """`(fit_stamp, fitted_on)` for one exported fit, refusing an export the catalog does not name."""
    source = FIT_SOURCES.get(name)
    if source is None or source.file != file:
        raise LookupError(f"{name} ({file}) is not a fit research.model.fit_provenance describes")
    commit = fit_commit(file)
    return commit.committed_at, fitted_on(name, commit)


def restamp_artifact(conn: Connection, name: str, payload: Any, fit_stamp: datetime, described: str) -> SeedOutcome:
    """Corrects a published version 1's provenance; its payload must be identical."""
    existing = conn.execute(
        text("select payload, fit_stamp, fitted_on from research.model_artifacts where name = :n and version = :v"),
        {"n": name, "v": _VERSION},
    ).first()
    if existing is None:
        return publish_artifact(conn, name, _VERSION, payload, fit_stamp, described)
    if stable_json(existing.payload) != stable_json(payload):
        raise ArtifactVersionConflictError(
            f"{name} v{_VERSION} holds a different payload; a restamp never changes one."
        )
    if existing.fit_stamp == fit_stamp and existing.fitted_on == described:
        return "unchanged"
    conn.execute(
        text(
            "update research.model_artifacts set fit_stamp = :stamp, fitted_on = :on where name = :n and version = :v"
        ),
        {"stamp": fit_stamp, "on": described, "n": name, "v": _VERSION},
    )
    return "restamped"


def seed_into(conn: Connection, exported: Mapping[str, Any], restamp: bool = False) -> list[tuple[str, SeedOutcome]]:
    outcomes: list[tuple[str, SeedOutcome]] = []
    for name, entry in exported.items():
        stamp, described = provenance(name, str(entry["file"]))
        outcome: SeedOutcome = (
            restamp_artifact(conn, name, entry["payload"], stamp, described)
            if restamp
            else publish_artifact(conn, name, _VERSION, entry["payload"], stamp, described)
        )
        outcomes.append((name, outcome))
    return outcomes


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="research.model.seed", description="publish the oracle's fits as version 1")
    parser.add_argument("export", nargs="?", help="a saved `ts/artifacts.ts` output (default: run the exporter)")
    parser.add_argument("--restamp", action="store_true", help="correct the provenance of identical version-1 rows")
    args = parser.parse_args(argv)
    exported = json.loads(Path(args.export).read_text()) if args.export else oracle_export()
    engine = make_engine(database_url_from_env())
    with engine.begin() as conn:
        outcomes = seed_into(conn, exported, args.restamp)
    for name, outcome in outcomes:
        sys.stdout.write(f"{name:32} v{_VERSION}  {outcome}\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
