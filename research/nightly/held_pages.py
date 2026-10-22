"""HELD PAGES (Lane 136): one page the web's reader refuses holds itself back, not the run.

Two mornings running (2026-10-21, 2026-10-22) the schema gate refused all 627 player pages for one
page's reader rule, and the site served a stale run all day; both pages were true and the reader was
wrong. So the gate reads the run once with the web's own reader (`schema_gate.read_run`), which names
every player page it refuses on a line of its own, and then:

- a refusal that is not one page's (a board, the index, the record, the clubs, the schedule, the
  designations, the manifest, a reader that could not run) fails the run, as it always has;
- more refused pages than the line (`held_limit`: ten, or 2% of the pages, whichever is fewer) fails it;
- otherwise each refused page is held. The run carries `held.json` naming each with its refusal, and
  for each the newest passed run's copy of his page (`runs/early.json`'s run; its own copy when that run
  held him too) at `held/<id>.json`, stamped with the run it is from, or none when that run has no page
  of his. His refused document stays at `players/<id>.json` for diagnosis and is never read: the web
  shows the copy with its own stamp, or with no copy his board figures alone (`web/src/lib/run/held.ts`).
  His board rows and index entry stay as written. The reader then reads the run again exactly as the
  build will; a copy it refuses is dropped (his page is then the board's figures alone) and the run is
  read once more, and any refusal left fails the run.

The gate's summary names every held page with its refusal, and a run that published with a held page
prints one `nightly HELD:` line, which the research alerts email (`infra/research-alerts.sh`), so a
reader/writer drift is seen the morning after without a stale site.
"""

import math
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass, replace
from pathlib import Path
from typing import Any, Final

from research.nightly.config import EARLY_KEY, GATES
from research.nightly.gates import GateRecord, gate_record
from research.nightly.publish import encode, read_json, run_key
from research.nightly.run_store import JSON_TYPE, LocalRunStore, RunStore
from research.nightly.schema_gate import ReaderRead, read_run

HELD_FILE: Final = "held.json"
ALERT_PREFIX: Final = "nightly HELD:"
Json = dict[str, Any]
Reader = Callable[[Path, str, Path], ReaderRead]


def copy_path(player_id: str) -> str:
    return f"held/{player_id}.json"


@dataclass(frozen=True, slots=True)
class Copy:
    """A held page's earlier copy: the page as the run it is from published it."""

    run_id: str
    run_at: str
    page: Json


@dataclass(frozen=True, slots=True)
class HeldPage:
    id: str
    refusal: str
    copy: Copy | None

    def json(self) -> Json:
        copy = None if self.copy is None else {"runId": self.copy.run_id, "runAt": self.copy.run_at}
        return {"id": self.id, "refusal": self.refusal, "copy": copy}

    def words(self) -> str:
        shown = "the board's figures alone" if self.copy is None else f"shown from run {self.copy.run_id}"
        return f"players/{self.id}.json ({shown}): {self.refusal}"


@dataclass(frozen=True, slots=True)
class HeldGate:
    """The schema gate's verdict, and the pages it held for a run that passed (none for one that failed)."""

    record: GateRecord
    held: tuple[HeldPage, ...]

    def files(self) -> dict[str, Json]:
        return held_files(self.held)


def held_files(held: Sequence[HeldPage]) -> dict[str, Json]:
    """What a run carries for its held pages: `held.json` and each copy; nothing when none is held."""
    if not held:
        return {}
    copies = {copy_path(h.id): h.copy.page for h in held if h.copy is not None}
    return {HELD_FILE: {"pages": [h.json() for h in held]}, **copies}


def held_limit(pages: int) -> int:
    """The most pages a run of `pages` may hold back: `GATES.max_held_pages`, or the share, if fewer."""
    return min(GATES.max_held_pages, math.floor(pages * GATES.max_held_page_share))


def alert_line(run_id: str, held: Sequence[HeldPage]) -> str:
    """The one line a run that published with held pages prints, which the research alerts email."""
    pages = "page" if len(held) == 1 else "pages"
    return f"{ALERT_PREFIX} run {run_id} published with {len(held)} held {pages}: {' | '.join(h.words() for h in held)}"


def earlier_copies(store: RunStore, ids: Sequence[str], log: Callable[[str], None]) -> dict[str, Copy | None]:
    """Each id's copy from the newest passed run (`runs/early.json`): that run's own page of his, or, when it
    held him too, its copy, stamped with the run that copy is from. A copy that cannot be read is none,
    named in the log: it costs his page its copy, never the night."""
    try:
        pointer = read_json(store, EARLY_KEY)
        previous = None if pointer is None else str(pointer["runId"])
        if previous is None:
            return dict.fromkeys(ids)
        manifest = read_json(store, run_key(previous, "manifest.json"))
        held = read_json(store, run_key(previous, HELD_FILE))
    except Exception as error:
        # A store read that failed or a pointer that does not read: no copies, said once.
        log(f"schema: no earlier copies of the held pages ({error})")
        return dict.fromkeys(ids)
    marks = {str(page["id"]): page["copy"] for page in (held or {}).get("pages", [])}
    return {pid: _copy(store, previous, manifest, marks, pid, log) for pid in ids}


def _copy(  # noqa: PLR0913, PLR0917 - the earlier run, read once, and the page to copy from it
    store: RunStore,
    previous: str,
    manifest: Json | None,
    marks: Mapping[str, Json | None],
    player_id: str,
    log: Callable[[str], None],
) -> Copy | None:
    try:
        if player_id in marks:
            mark = marks[player_id]
            page = None if mark is None else read_json(store, run_key(previous, copy_path(player_id)))
            return None if mark is None or page is None else Copy(str(mark["runId"]), str(mark["runAt"]), page)
        page = read_json(store, run_key(previous, f"players/{player_id}.json"))
        if page is None or manifest is None:
            return None
        return Copy(previous, str(manifest["runAt"]), page)
    except Exception as error:
        log(f"schema: the copy of players/{player_id}.json from run {previous} was not read ({error})")
        return None


def hold_refused_pages(  # noqa: PLR0913, PLR0917 - the staged run, the store its copies come from, the night's log
    root: Path,
    run_id: str,
    web_dir: Path,
    store: RunStore,
    pages: int,
    log: Callable[[str], None],
    read: Reader = read_run,
) -> HeldGate:
    """The schema gate over the run staged under `root`, holding back up to `held_limit(pages)` refused
    pages (the module's rules). The held pages' files are staged beside the run when it passes."""
    first = read(root, run_id, web_dir)
    refused = first.refused("players")
    if first.run_reasons or not refused:
        return HeldGate(gate_record("schema", first.reasons, first.summary), ())
    limit = held_limit(pages)
    if len(refused) > limit:
        over = f"{len(refused)} pages refused, more than the {limit} a run of {pages} pages may hold"
        return HeldGate(gate_record("schema", first.reasons, f"{first.summary}; {over}"), ())
    copies = earlier_copies(store, list(refused), log)
    held = tuple(HeldPage(pid, message, copies[pid]) for pid, message in refused.items())
    return _read_held(root, run_id, web_dir, held, read)


def _read_held(root: Path, run_id: str, web_dir: Path, held: tuple[HeldPage, ...], read: Reader) -> HeldGate:
    """The run read again as the build reads it, with its held pages; a copy the reader refuses is dropped
    once (his page is then the board's figures alone), and any refusal left fails the run."""
    again = _stage_and_read(root, run_id, web_dir, held, read)
    refused_copies = again.refused("held")
    if refused_copies and len(refused_copies) == len(again.reasons):
        for pid in refused_copies:
            (root / "runs" / run_id / copy_path(pid)).unlink(missing_ok=True)
        held = tuple(replace(h, copy=None) if h.id in refused_copies else h for h in held)
        again = _stage_and_read(root, run_id, web_dir, held, read)
    if again.reasons:
        return HeldGate(gate_record("schema", again.reasons, again.summary), ())
    pages = "page" if len(held) == 1 else "pages"
    words = f"{len(held)} {pages} held: {' | '.join(h.words() for h in held)}"
    return HeldGate(gate_record("schema", (), f"{again.summary}; {words}"), held)


def _stage_and_read(root: Path, run_id: str, web_dir: Path, held: tuple[HeldPage, ...], read: Reader) -> ReaderRead:
    staging = LocalRunStore(root)
    for path, value in held_files(held).items():
        staging.put(run_key(run_id, path), encode(value), JSON_TYPE)
    return read(root, run_id, web_dir)
