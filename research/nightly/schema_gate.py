"""THE SCHEMA GATE: the run read by the web's own reader and schema, before any pointer moves.

The web's schema (`web/src/lib/run/schema.ts`) is the run's contract, and the web build refuses a run
that breaks it, so the nightly runs the same code over the run before it can become early or public:
`contract/run-contract.ts` under node, against the web's `schema.ts` and `source.ts` (the research image
copies them from the repository at build, with the web's own zod and aws4fetch, into
`WEB_CONTRACT_DIR`). A field the web adds later (the player card's season block) is gated the night the
image carrying it deploys, with no change here.

The gate fails, naming each refusal `schema:<file>:<message>`, when the reader refuses anything, and
also when it cannot run at all (no node, no web contract): a run is never promoted unchecked.
"""

import os
import shutil
import subprocess
from pathlib import Path
from typing import Final

from research.nightly.gates import GateRecord, gate_record

CONTRACT_DIR_VARIABLE: Final = "WEB_CONTRACT_DIR"
_SCRIPT: Final = Path(__file__).resolve().parent / "contract" / "run-contract.ts"
# The repository's web/ in a developer's tree (it needs `npm ci` there for node_modules).
_REPOSITORY_WEB: Final = Path(__file__).resolve().parents[2] / "web"
_TIMEOUT_SECONDS: Final = 600
_REFUSED: Final = 1


def contract_dir(environ: dict[str, str] | os._Environ[str]) -> Path:
    configured = environ.get(CONTRACT_DIR_VARIABLE, "").strip()
    return Path(configured) if configured else _REPOSITORY_WEB


def schema_gate(runs_root: Path, run_id: str, web_dir: Path) -> GateRecord:
    """Run the web's reader over `runs_root/runs/<run_id>`; every refusal is a reason."""
    node = shutil.which("node")
    missing = [
        what
        for what, present in (
            ("node on the PATH", node is not None),
            (f"the web contract at {web_dir}", (web_dir / "src/lib/run/schema.ts").is_file()),
            ("zod in the web contract", (web_dir / "node_modules/zod").is_dir()),
        )
        if not present
    ]
    if missing or node is None:
        return gate_record("schema", [f"schema_unchecked:{', '.join(missing)}"], "the web's reader could not run")
    completed = subprocess.run(
        [node, "--experimental-strip-types", "--no-warnings", str(_SCRIPT), str(web_dir), str(runs_root), run_id],
        capture_output=True,
        text=True,
        timeout=_TIMEOUT_SECONDS,
        check=False,
    )
    lines = [line for line in completed.stdout.splitlines() if line.strip()]
    reasons = [line for line in lines if line.startswith("schema:")]
    summary = next((line for line in reversed(lines) if not line.startswith("schema:")), "")
    if completed.returncode != 0 and not reasons:
        reasons = [f"schema_unchecked:exit {completed.returncode}: {completed.stderr.strip()[-400:]}"]
    return gate_record("schema", reasons, summary or "the web's reader returned nothing")
