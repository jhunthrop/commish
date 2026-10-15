"""TAKING A RUN ID, WRITING A RUN, AND MAKING IT PUBLIC.

A run id is the run's UTC start to the hour (`2026-10-13T05`, spec §2.1), with `-2`, `-3` appended
when an earlier run took that hour (the web's run id pattern allows a lower-case suffix). An id is
taken by claiming `runs/<id>/started.json` with a conditional write, so it is never reused, even by
a run that died half way: its partial files stay where they are.

Every JSON artifact is written compact, as the web reads it, and recorded in the run's report with
its bytes and SHA-256. The manifest is written last.

PUBLIC AFTER AN HOUR (spec §4, early access). A run that passed every gate moves `runs/early.json`
at once, the run a member may read, with the instant it goes public. `publish` (hourly from 06:00
UTC) moves `runs/latest.json` to it once that instant has passed and dispatches the web build with
its id: a `workflow_dispatch` of `web.yml` on main with the input `runId`, which needs a token with
Actions write and nothing else (a `repository_dispatch` token needs Contents write, which can push
code). A dispatch that failed is retried by the next
`publish`; the run's `published.json` records each attempt.

THE HOURLY BACKSTOP IS THE DELIVERY PATH; THE TOKEN IS OPTIONAL (Lane 43). The web workflow runs
at 30 minutes past every hour from 06:30 to 12:30 UTC, compares `runs/latest.json` with the run the
live site says it holds (`/data/run.txt`, which every build writes), and builds when they differ,
so the site is on a published run within the hour of `latest` moving, with no token at all; an hour
with nothing new stops in seconds with a named line. WEB_DISPATCH_TOKEN needs a GitHub token only
the founder can mint, and its dispatch only makes the build start sooner. So a token that is
missing, empty or exactly `placeholder` (the Secret Manager placeholder's value), after trimming,
is no dispatch to make: the run still goes public, the dispatch is skipped by name in the
log line and in the run's `published.json` (`dispatch`), and `publish` exits 0. A dispatch that was
attempted and that GitHub refused stays a failure, retried the next hour.
"""

import hashlib
import json
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, Final

import httpx

from research.model.instants import js_iso
from research.nightly.config import EARLY_ACCESS, EARLY_KEY, LATEST_KEY, RUNS_PREFIX
from research.nightly.run_store import JSON_TYPE, RunStore

STARTED_FILE: Final = "started.json"
PUBLISHED_FILE: Final = "published.json"
DISPATCH_TOKEN_VARIABLE: Final = "WEB_DISPATCH_TOKEN"
DISPATCH_REPOSITORY_VARIABLE: Final = "WEB_DISPATCH_REPOSITORY"
DEFAULT_REPOSITORY: Final = "jhunthrop/commish"
WEB_WORKFLOW: Final = "web.yml"
WEB_REF: Final = "main"
_DISPATCHED: Final = 204
# The values that mean "no token yet": the Secret Manager placeholder's value, or nothing.
PLACEHOLDER_TOKENS: Final = frozenset({"", "placeholder"})
Json = dict[str, Any]


def run_key(run_id: str, path: str) -> str:
    return f"{RUNS_PREFIX}/{run_id}/{path}"


def encode(value: object) -> bytes:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode()


def take_run_id(store: RunStore, started_at: datetime, suffix: str | None = None) -> str:
    """The first free id for this hour (with `suffix`, `2026-10-22T18-weekly`), claimed atomically."""
    hour = started_at.astimezone(UTC).strftime("%Y-%m-%dT%H")
    base = hour if suffix is None else f"{hour}-{suffix}"
    attempt = 1
    while True:
        candidate = base if attempt == 1 else f"{base}-{attempt}"
        body = encode({"runId": candidate, "startedAt": js_iso(started_at)})
        if store.claim(run_key(candidate, STARTED_FILE), body, JSON_TYPE):
            return candidate
        attempt += 1


@dataclass(slots=True)
class ArtifactWriter:
    store: RunStore
    run_id: str
    records: list[Json]

    def write(self, path: str, value: object) -> None:
        body = encode(value)
        self.store.put(run_key(self.run_id, path), body, JSON_TYPE)
        self.records.append({"path": path, "bytes": len(body), "sha256": hashlib.sha256(body).hexdigest()})


def read_json(store: RunStore, key: str) -> Json | None:
    raw = store.get(key)
    return None if raw is None else json.loads(raw)


def promote_early(store: RunStore, run_id: str, finished_at: datetime) -> datetime:
    """A passed run becomes the early-access run; returns when it goes public."""
    public_at = finished_at + EARLY_ACCESS
    store.put(
        EARLY_KEY,
        encode({"runId": run_id, "finishedAt": js_iso(finished_at), "publicAt": js_iso(public_at)}),
        JSON_TYPE,
    )
    return public_at


@dataclass(frozen=True, slots=True)
class Dispatcher:
    http: httpx.Client
    token: str
    repository: str

    @classmethod
    def from_environ(cls, http: httpx.Client, environ: Mapping[str, str]) -> "Dispatcher | str":
        """The dispatcher, or why there is none (a missing or placeholder token)."""
        token = environ.get(DISPATCH_TOKEN_VARIABLE, "").strip()
        if token in PLACEHOLDER_TOKENS:
            state = "is not set" if token == "" else "is the placeholder"
            return (
                f"{DISPATCH_TOKEN_VARIABLE} {state}; the web's daily 06:30 UTC rebuild builds runs/latest.json instead"
            )
        return cls(http, token, environ.get(DISPATCH_REPOSITORY_VARIABLE, DEFAULT_REPOSITORY).strip())

    def dispatch(self, run_id: str) -> str | None:
        """The web workflow's build of `run_id`; None on success, else what GitHub answered."""
        response = self.http.post(
            f"https://api.github.com/repos/{self.repository}/actions/workflows/{WEB_WORKFLOW}/dispatches",
            headers={
                "Authorization": f"Bearer {self.token}",
                "Accept": "application/vnd.github+json",
                "X-GitHub-Api-Version": "2022-11-28",
            },
            json={"ref": WEB_REF, "inputs": {"runId": run_id}},
            timeout=30.0,
        )
        return None if response.status_code == _DISPATCHED else f"HTTP {response.status_code} {response.text[:200]}"


@dataclass(frozen=True, slots=True)
class PublishOutcome:
    run_id: str | None
    line: str
    ok: bool


def publish(store: RunStore, dispatcher: Dispatcher | str | None, now: datetime) -> PublishOutcome:
    """Move `latest.json` to the early run once it is public, and dispatch its build (once)."""
    early = read_json(store, EARLY_KEY)
    if early is None:
        return PublishOutcome(None, "publish: no run has passed its gates yet", True)
    run_id = str(early["runId"])
    public_at = datetime.fromisoformat(str(early["publicAt"]).replace("Z", "+00:00"))
    if now < public_at:
        return PublishOutcome(
            run_id, f"publish: run {run_id} goes public at {early['publicAt']}, in {public_at - now}", True
        )
    latest = read_json(store, LATEST_KEY)
    record = read_json(store, run_key(run_id, PUBLISHED_FILE)) or {"attempts": []}
    if latest is None or latest.get("runId") != run_id:
        store.put(LATEST_KEY, encode({"runId": run_id}), JSON_TYPE)
        record["publishedAt"] = js_iso(now)
    if record.get("dispatchedAt"):
        return PublishOutcome(run_id, f"publish: run {run_id} is public and its build was dispatched", True)
    if dispatcher is None or isinstance(dispatcher, str):
        why = "--no-dispatch" if dispatcher is None else dispatcher
        record["dispatch"] = f"skipped: {why}"
        store.put(run_key(run_id, PUBLISHED_FILE), encode(record), JSON_TYPE)
        return PublishOutcome(run_id, f"publish: run {run_id} is public; the web dispatch skipped ({why})", True)
    failure = dispatcher.dispatch(run_id)
    record["attempts"] = [*record["attempts"], {"at": js_iso(now), "error": failure}]
    if failure is None:
        record["dispatchedAt"] = js_iso(now)
    store.put(run_key(run_id, PUBLISHED_FILE), encode(record), JSON_TYPE)
    if failure is not None:
        return PublishOutcome(
            run_id, f"publish: run {run_id} is public, the dispatch FAILED ({failure}); retried next hour", False
        )
    return PublishOutcome(run_id, f"publish: run {run_id} is public and the web build of it was dispatched", True)
