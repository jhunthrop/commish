"""A PAST TREE, RUN AS IT WAS: the oracle that produced a stored board before the code moved on.

A stored board was made by the tree on main when it was taken (`research.db.provenance`): the
week-1 board by `800aef34`, a model the oracle no longer is, and the week-2 board by `7af71283`.
The board cases prove each claim by construction: they extract that commit's `src/`, `scripts/`,
`tsconfig.json` and `package.json` with `git archive` (read only, the repository is not touched)
into a temporary directory, link the repository's node_modules, and run the tree's own
`scripts/preseason-persist.ts <season>`, unmodified, against a scratch copy of the store as it
stood, with the wall clock frozen at the board's moment and the network refused (phase A's
preload: no recordings, so any fetch fails). The board it writes lands in the scratch copy.
"""

import os
import subprocess
import tempfile
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Final

from research.model.instants import js_iso

_REPO: Final = Path(__file__).resolve().parents[3]
_PRELOAD: Final = _REPO / "research" / "parity" / "ts" / "preload.ts"
_TIMEOUT_SECONDS: Final = 900
_TREE_PATHS: Final = ("src", "scripts", "tsconfig.json", "package.json")


@dataclass(frozen=True, slots=True)
class TreeRun:
    commit: str
    returncode: int
    stdout: str
    stderr: str


def run_tree_persist(commit: str, database_url: str, season: int, now: datetime) -> TreeRun:
    """`scripts/preseason-persist.ts <season>` of `commit`, against `database_url`, at `now`."""
    with tempfile.TemporaryDirectory(prefix=f"tree-{commit}-") as directory:
        root = Path(directory)
        archive = root / "tree.tar"
        subprocess.run(
            ["git", "archive", "--format=tar", f"--output={archive}", commit, *_TREE_PATHS], cwd=_REPO, check=True
        )
        subprocess.run(["tar", "-xf", str(archive)], cwd=root, check=True)
        (root / "node_modules").symlink_to(_REPO / "node_modules")
        completed = subprocess.run(
            ["npx", "tsx", "--import", str(_PRELOAD), "scripts/preseason-persist.ts", str(season)],
            cwd=root,
            capture_output=True,
            text=True,
            timeout=_TIMEOUT_SECONDS,
            check=False,
            env={
                "PATH": _path(),
                "HOME": str(root),
                "DATABASE_URL": database_url,
                "PARITY_NOW": js_iso(now),
                "PARITY_FIXTURE_DIRS": "",
                "PARITY_REQUESTED_OUT": str(root / "requested.json"),
            },
        )
    return TreeRun(commit, completed.returncode, completed.stdout, completed.stderr)


def _path() -> str:
    """The child's PATH, the only variable of this process it inherits."""
    return os.environ.get("PATH", "")
