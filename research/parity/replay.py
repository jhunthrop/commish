"""RECORDED RESPONSES, REPLAYED: the fixture store both sides of a parity run read from.

A case's fixtures live in `parity/fixtures/<case>/` with a `manifest.json` naming, for every
request the ingest makes, the URL, the status, the response headers that matter, and the file
holding the body (gzipped on disk to keep the repository small; the replay hands back the bytes
exactly as recorded). The TypeScript driver (`parity/ts/replay.ts`) reads the same manifest, so
the two implementations are fed byte-identical input.

SECRETS NEVER ENTER A FIXTURE. A query parameter in `SECRET_PARAMS` is stripped from a URL before
it is recorded or matched, and request headers are not recorded at all.

AN UNRECORDED REQUEST RAISES, naming the URL, so a replayed ingest can never reach the network
and a missing recording is a test problem rather than a quiet 404.
"""

import gzip
import json
from collections.abc import Iterator, Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from research.errors import ResearchError
from research.pipeline.http import HttpResponse

FIXTURES_ROOT = Path(__file__).resolve().parent / "fixtures"
SECRET_PARAMS = frozenset({"apiKey", "api_key", "apikey"})


class UnrecordedRequestError(ResearchError):
    """The replay was asked for a URL no fixture records."""


def normalized_url(url: str) -> str:
    """The URL with secret parameters removed and the query sorted, the key a recording is filed under."""
    parts = urlsplit(url)
    query = sorted((k, v) for k, v in parse_qsl(parts.query, keep_blank_values=True) if k not in SECRET_PARAMS)
    return urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode(query), ""))


@dataclass(frozen=True)
class Recording:
    url: str
    status: int
    file: str
    headers: Mapping[str, str]


def load_manifest(case_dir: Path) -> dict[str, Recording]:
    manifest = json.loads((case_dir / "manifest.json").read_text())
    recordings: dict[str, Recording] = {}
    for entry in manifest["responses"]:
        recording = Recording(
            url=entry["url"], status=int(entry["status"]), file=entry["file"], headers=dict(entry.get("headers", {}))
        )
        recordings[normalized_url(recording.url)] = recording
    return recordings


def read_body(case_dir: Path, recording: Recording) -> bytes:
    return gzip.decompress((case_dir / recording.file).read_bytes())


class ReplayFetcher:
    """A `Fetcher` that answers only from the named fixture sets' recordings."""

    def __init__(self, case_dirs: Sequence[Path]) -> None:
        self._recordings: dict[str, tuple[Path, Recording]] = {}
        for case_dir in case_dirs:
            for key, recording in load_manifest(case_dir).items():
                self._recordings[key] = (case_dir, recording)
        self._names = ", ".join(d.name for d in case_dirs)
        self.requested: list[str] = []

    def _recording(self, url: str) -> tuple[Path, Recording]:
        key = normalized_url(url)
        found = self._recordings.get(key)
        if found is None:
            raise UnrecordedRequestError(f"no recording for {key} in {self._names}; record it first.")
        # Which recording answered, as `<fixture set>/<file>`: the TypeScript replay reports the
        # same, so the harness can check both sides asked for exactly the same inputs.
        self.requested.append(f"{found[0].name}/{found[1].file}")
        return found

    def get(self, url: str, headers: Mapping[str, str] | None = None) -> HttpResponse:
        case_dir, recording = self._recording(url)
        return HttpResponse(
            status=recording.status, body=read_body(case_dir, recording), headers=dict(recording.headers)
        )

    def stream(self, url: str, headers: Mapping[str, str] | None = None) -> tuple[int, Iterator[bytes]]:
        case_dir, recording = self._recording(url)
        body = read_body(case_dir, recording)
        chunk = 64 * 1024
        return recording.status, iter([body[i : i + chunk] for i in range(0, len(body), chunk)] or [b""])
