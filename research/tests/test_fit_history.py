"""The fit-history walk refuses a path whose last change is a deletion (the post-cutover case).

Needs the repository's history: on a shallow checkout (CI's default) no deletion is visible, and the
test is skipped rather than passed. The walk's positive result is proven where the seed runs: it
dates `preseason/kdef-priors` to `63cd8c6e`, past the refactor `3d4afb70` that moved its file.
"""

import subprocess
from pathlib import Path

import pytest

from research.model.fit_history import fit_commit

_REPO = Path(__file__).resolve().parents[2]


def _deleted_path() -> str | None:
    listed = subprocess.run(
        ["git", "log", "--diff-filter=D", "--name-only", "--format=", "-50"],
        cwd=_REPO,
        capture_output=True,
        text=True,
        check=False,
    ).stdout.split()
    return next((path for path in listed if not (_REPO / path).exists()), None)


def test_a_deleted_path_is_refused_not_taken_as_the_fit() -> None:
    path = _deleted_path()
    if path is None:
        pytest.skip("no deleted path in this checkout's history (shallow clone)")
    with pytest.raises(LookupError, match="a deletion is not a fit"):
        fit_commit(path, ("ANY_EXPORT",))
