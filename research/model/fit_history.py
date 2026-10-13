"""THE COMMIT THAT CHANGED A FIT'S NUMBERS, found in git history rather than taken from a file date.

`git log --follow` lists every commit that touched a fitted file, through its renames. Many of
them changed no fitted number: the moves into `research-ts/`, and refactors such as `3d4afb70`,
which took the game-variance tables out of `kdef-fitted.ts` and left the kicker and defense priors
as they were. So the walk evaluates the fit's own numbers (the named exports of a `.ts` module, via
`parity/ts/fitted-values.ts`, or the whole of a `.json` file) at each commit, newest first, and stops
at the commit whose numbers are today's while the commit before it held different ones (or none).

A path whose newest entry is a deletion is refused: after cutover the oracle's files are gone, and
the deletion would otherwise be read as the last change to the fit.
"""

import json
import subprocess
import tempfile
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Final

_REPO: Final = Path(__file__).resolve().parents[2]
_EVALUATOR: Final = _REPO / "research" / "parity" / "ts" / "fitted-values.ts"
_PURE_RENAME: Final = "R100"
_DELETED: Final = "D"


@dataclass(frozen=True, slots=True)
class FitCommit:
    sha: str
    committed_at: datetime
    subject: str


@dataclass(frozen=True, slots=True)
class _Touch:
    commit: FitCommit
    status: str
    path: str


def _git(*args: str) -> str:
    return subprocess.run(["git", *args], cwd=_REPO, check=True, capture_output=True, text=True).stdout


def _touches(file: str) -> list[_Touch]:
    """Every commit that touched `file`, newest first, with the path it had there."""
    touches: list[_Touch] = []
    header: list[str] | None = None
    for line in _git("log", "--follow", "-M", "--format=@%h%x09%cI%x09%s", "--name-status", "--", file).splitlines():
        if line.startswith("@"):
            header = line[1:].split("\t", 2)
        elif line.strip() and header is not None:
            status, *paths = line.split("\t")
            commit = FitCommit(header[0], datetime.fromisoformat(header[1]), header[2])
            touches.append(_Touch(commit, status, paths[-1]))
    return touches


def _numbers(touch: _Touch, names: tuple[str, ...]) -> object:
    """The fit's numbers as `touch`'s commit held them: named exports of a module, or a JSON file."""
    text = _git("show", f"{touch.commit.sha}:{touch.path}")
    if not names:
        return json.loads(text)
    with tempfile.TemporaryDirectory(prefix="fit-") as directory:
        module = Path(directory) / "fitted.ts"
        module.write_text(text)
        completed = subprocess.run(
            ["npx", "tsx", str(_EVALUATOR), str(module), *names], cwd=_REPO, check=True, capture_output=True, text=True
        )
    return json.loads(completed.stdout)


def fit_commit(file: str, names: tuple[str, ...]) -> FitCommit:
    """The commit that last changed the fitted numbers in `file` (`names`: its fitted exports; empty
    for a JSON file, whose whole content is the fit)."""
    touches = _touches(file)
    if not touches:
        raise LookupError(f"{file} has no history in this repository")
    if touches[0].status == _DELETED:
        raise LookupError(
            f"{file} was deleted at {touches[0].commit.sha} ({touches[0].commit.subject}); a deletion is not a fit. "
            "Read the fit's provenance from the artifact store, where it was recorded before cutover."
        )
    changes = [touch for touch in touches if touch.status != _PURE_RENAME]
    today = _numbers(changes[0], names)
    for index, touch in enumerate(changes):
        older = changes[index + 1] if index + 1 < len(changes) else None
        if older is None or older.status == _DELETED or _numbers(older, names) != today:
            return touch.commit
    raise LookupError(f"{file}'s fitted numbers have no commit that introduced them")
