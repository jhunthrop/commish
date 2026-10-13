"""THE HEADSHOTS, MIRRORED INTO R2 (spec §2.5, the debt Lane 0 named): every face a run's pages show,
held by us, so a provider's outage or a change of URL never blanks a page.

Each image is stored once by its content, `headshots/<sha256>.<ext>`, and the run carries the map from
its pages to them, `runs/<runId>/headshots.json` (player id to key, digest, type and the source URL
it was read from). A face that did not change is fetched with the validators the last fetch
recorded (`If-None-Match`, `If-Modified-Since`) and answered 304, so a night re-downloads and
re-stores only the faces that moved. The registry of every source URL's last fetch is
`headshots/index.json`.

A face that cannot be fetched keeps its last stored copy when there is one, and is listed as missing
otherwise; it never fails the run (the page falls back to the provider's URL, which the run still
carries as `headshot`).

The web's image route reads the run's map to serve a face from the bucket; until it does, the run's
`headshot` stays the provider's URL and the route keeps reading the provider.
"""

import hashlib
import json
from collections.abc import Mapping, Sequence
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from typing import Any, Final

import httpx

from research.nightly.config import HEADSHOT_REGISTRY_KEY
from research.nightly.run_store import JSON_TYPE, RunStore

_WORKERS: Final = 8
_TIMEOUT_SECONDS: Final = 20.0
_OK: Final = 200
_NOT_MODIFIED: Final = 304
_EXTENSIONS: Final = {"image/png": "png", "image/jpeg": "jpg", "image/webp": "webp"}
Json = dict[str, Any]


@dataclass(frozen=True, slots=True)
class Face:
    player_id: str
    source: str


@dataclass(frozen=True, slots=True)
class Fetched:
    face: Face
    entry: Json | None  # the registry entry after this fetch, None when there is no copy at all
    outcome: str  # "stored", "unchanged", "kept" (a failed fetch with a copy), "missing"
    reason: str | None = None


def _fetch(http: httpx.Client, store: RunStore, face: Face, previous: Json | None) -> Fetched:
    headers = {}
    if previous is not None:
        headers = {
            k: v
            for k, v in (("if-none-match", previous.get("etag")), ("if-modified-since", previous.get("lastModified")))
            if v
        }
    try:
        response = http.get(face.source, headers=headers, timeout=_TIMEOUT_SECONDS, follow_redirects=True)
    except httpx.HTTPError as error:
        return Fetched(face, previous, "kept" if previous else "missing", str(error))
    if response.status_code == _NOT_MODIFIED and previous is not None:
        return Fetched(face, previous, "unchanged")
    content_type = response.headers.get("content-type", "").split(";")[0].strip()
    if response.status_code != _OK or content_type not in _EXTENSIONS:
        reason = f"HTTP {response.status_code} {content_type}"
        return Fetched(face, previous, "kept" if previous else "missing", reason)
    digest = hashlib.sha256(response.content).hexdigest()
    key = f"headshots/{digest}.{_EXTENSIONS[content_type]}"
    if (previous is None or previous.get("key") != key) and not store.exists(key):
        store.put(key, response.content, content_type)
    entry = {
        "key": key,
        "sha256": digest,
        "contentType": content_type,
        "bytes": len(response.content),
        "etag": response.headers.get("etag"),
        "lastModified": response.headers.get("last-modified"),
    }
    return Fetched(face, entry, "stored" if previous is None or previous.get("key") != key else "unchanged")


@dataclass(frozen=True, slots=True)
class MirrorResult:
    by_player: Json  # the run's headshots.json
    counts: Mapping[str, int]


def mirror_headshots(http: httpx.Client, store: RunStore, faces: Sequence[Face]) -> MirrorResult:
    """Every face fetched (conditionally), stored by content, and the run's map and the registry written back."""
    raw = store.get(HEADSHOT_REGISTRY_KEY)
    registry: dict[str, Json] = {} if raw is None else json.loads(raw)
    unique = list({face.source: face for face in faces}.values())
    with ThreadPoolExecutor(_WORKERS) as pool:
        fetched = {
            f.face.source: f
            for f in pool.map(lambda face: _fetch(http, store, face, registry.get(face.source)), unique)
        }
    counts: dict[str, int] = {}
    for result in fetched.values():
        counts[result.outcome] = counts.get(result.outcome, 0) + 1
        if result.entry is not None:
            registry[result.face.source] = result.entry
    store.put(HEADSHOT_REGISTRY_KEY, json.dumps(registry, sort_keys=True).encode(), JSON_TYPE)
    by_player: Json = {}
    for face in faces:
        result = fetched[face.source]
        entry = result.entry
        by_player[face.player_id] = (
            {"missing": True, "source": face.source, "reason": result.reason}
            if entry is None
            else {
                "key": entry["key"],
                "sha256": entry["sha256"],
                "contentType": entry["contentType"],
                "source": face.source,
            }
        )
    return MirrorResult(by_player, counts)
