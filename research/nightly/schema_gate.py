"""THE SCHEMA GATE: the run read by the web's own reader and schema, before any pointer moves.

The web's schema (`web/src/lib/run/schema.ts`) is the run's contract, and the web build refuses a run
that breaks it, so the nightly runs the same code over the run before it can become early or public:
`contract/run-contract.ts` under node, which drives the web build's own reader (`src/lib/server/run.ts`,
its schemas and every cross-file check it makes; the research image copies `src/lib/run`, `src/lib/format` and that
reader from the repository at build, with the web's own zod and aws4fetch, into `WEB_CONTRACT_DIR`). A field the web adds later (the player card's season block) is gated the night the
image carrying it deploys, with no change here.

The gate fails, naming each refusal `schema:<file>:<message>`, when the reader refuses anything, and
also when it cannot run at all (no node, no web contract): a run is never promoted unchecked. Each
player page the reader refuses is a line of its own (`schema:players/<id>.json:...`, Lane 136), which
the nightly's gate (`held_pages.py`) may hold back instead of failing the run.
"""

import json
import re
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Final

from research.nightly.gates import GateRecord, gate_record

_SCRIPT: Final = Path(__file__).resolve().parent / "contract" / "run-contract.ts"
# One player file the reader refused (Lane 136): the run's own page, or a held page's earlier copy.
_PAGE_LINE: Final = re.compile(r"^schema:(?P<where>players|held)/(?P<id>[\w-]+)\.json:(?P<message>.*)$")
_TIMEOUT_SECONDS: Final = 600
# The run's season reach, one line apart from the refusals (contract/run-contract.ts `REACH_PREFIX`), and
# the members the web's `reachSchema` (web/src/lib/run/schema.ts) names.
_REACH_PREFIX: Final = "reach:"
_REACH_MEMBERS: Final = frozenset({"format", "scoring", "through", "complete", "partial"})
# The head of a failed reader's stderr the reason carries: node prints the failing source line, a caret,
# then the error itself (`Error [ERR_MODULE_NOT_FOUND]: Cannot find module ...`), so five lines reach it.
_STDERR_LINES: Final = 5
_STDERR_CHARACTERS: Final = 600
Json = dict[str, Any]


@dataclass(frozen=True, slots=True)
class ReaderRead:
    """One pass of the web's reader over a run: every refusal line, its summary line, and the run's season
    reach as the reader counted it (Lane 205), none when it refused anything or printed none."""

    reasons: tuple[str, ...]
    summary: str
    reach: Json | None = None

    def refused(self, where: str) -> dict[str, str]:
        """The player files under `where` (`players` for the run's own pages, `held` for the copies of its
        held ones) the reader refused, by player id, each with what it said (Lane 136)."""
        found = (_PAGE_LINE.match(reason) for reason in self.reasons)
        return {m["id"]: m["message"] for m in found if m is not None and m["where"] == where}

    @property
    def run_reasons(self) -> tuple[str, ...]:
        """Every refusal that is not one player file's: the run's own, which no page can be held for."""
        return tuple(reason for reason in self.reasons if _PAGE_LINE.match(reason) is None)


def read_run(runs_root: Path, run_id: str, web_dir: Path) -> ReaderRead:
    """Run the web's reader over `runs_root/runs/<run_id>` once."""
    node = shutil.which("node")
    missing = [
        what
        for what, present in (
            ("node on the PATH", node is not None),
            (f"the web contract at {web_dir}", (web_dir / "src/lib/run/schema.ts").is_file()),
            (f"the web reader at {web_dir}", (web_dir / "src/lib/server/run.ts").is_file()),
            ("zod in the web contract", (web_dir / "node_modules/zod").is_dir()),
        )
        if not present
    ]
    if missing or node is None:
        return ReaderRead((f"schema_unchecked:{', '.join(missing)}",), "the web's reader could not run")
    try:
        completed = subprocess.run(
            [node, "--experimental-strip-types", "--no-warnings", str(_SCRIPT), str(web_dir), str(runs_root), run_id],
            capture_output=True,
            text=True,
            timeout=_TIMEOUT_SECONDS,
            check=False,
        )
    except subprocess.TimeoutExpired:
        # Review N11: a reader that never answers is an unchecked run, never a crashed one.
        return ReaderRead((f"schema_unchecked:timeout after {_TIMEOUT_SECONDS} s",), "the web's reader timed out")
    reasons, summary = reader_outcome(completed.returncode, completed.stdout, completed.stderr)
    if reasons:
        return ReaderRead(tuple(reasons), summary)
    try:
        reach = reach_of(completed.stdout)
    except ValueError as error:
        # The reader and the gate disagree on the reach's line: the run is unchecked, never given a
        # wrong reach.
        return ReaderRead((f"schema_unchecked:{error}",), summary)
    return ReaderRead((), summary, reach)


def schema_gate(runs_root: Path, run_id: str, web_dir: Path) -> GateRecord:
    """Run the web's reader over `runs_root/runs/<run_id>`; every refusal is a reason. A run that holds
    pages (`held.json`) is read as the build reads it; the nightly's own gate, which may hold a refused
    page, is `held_pages.hold_refused_pages`."""
    read = read_run(runs_root, run_id, web_dir)
    return gate_record("schema", read.reasons, read.summary)


def reader_outcome(returncode: int, stdout: str, stderr: str) -> tuple[list[str], str]:
    """The reader's refusals and its summary line; a reader that could not run is a reason of its own.

    The reader prints a `schema:` line per refusal and one summary line. A run with no refusal line that
    exited non-zero, or printed no summary at all, was never read (Lane 76: an image missing a module the
    reader imports): the reason is the exit code and the head of stderr, where node names what failed.
    """
    lines = [line for line in stdout.splitlines() if line.strip() and not line.startswith(_REACH_PREFIX)]
    reasons = [line for line in lines if line.startswith("schema:")]
    summary = next((line for line in reversed(lines) if not line.startswith("schema:")), "")
    if reasons or (returncode == 0 and summary):
        return reasons, summary
    head = _stderr_head(stderr) or "the web's reader printed no summary and no stderr"
    unread = f"the web's reader did not read the run (exit {returncode})"
    return [f"schema_unchecked:exit {returncode}: {head}"], summary or unread


def reach_of(stdout: str) -> Json | None:
    """The run's season reach from the reader's one `reach:<json>` line (Lane 205), the shape the web's
    `reachSchema` names; none when it printed no such line. A line that is not that shape is the reader
    and the gate disagreeing, so it raises (`read_run` names it) rather than write a wrong reach."""
    found = [line[len(_REACH_PREFIX) :] for line in stdout.splitlines() if line.startswith(_REACH_PREFIX)]
    if not found:
        return None
    if len(found) > 1:
        raise ValueError(f"the web's reader printed {len(found)} reach lines; it prints one")
    reach = json.loads(found[0])
    if not isinstance(reach, dict) or set(reach) != _REACH_MEMBERS:
        raise ValueError(f"the web's reader printed a reach that is not one: {found[0]}")
    return reach


def _stderr_head(stderr: str) -> str:
    """The first lines of stderr on one line: node's error line and the source line above it."""
    lines = [line.strip() for line in stderr.splitlines() if line.strip()]
    head = " | ".join(lines[:_STDERR_LINES])
    return head if len(head) <= _STDERR_CHARACTERS else f"{head[: _STDERR_CHARACTERS - 1]}…"
