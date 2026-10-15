"""The lane-23 fixtures (`testdata/nflverse/`, real nflverse rows cut on 2026-10-14) behind a `Fetcher`.

Each fixture answers the release asset of the same file name; any other asset is a 404, the way
nflverse answers a season it has not published. Bodies stream in small chunks so the byte cap and
the CSV splitter both see chunk boundaries.
"""

import csv
import gzip
import io
from collections.abc import Iterator, Mapping
from dataclasses import dataclass, field
from pathlib import Path
from typing import Final

from research.pipeline.http import HttpResponse

TESTDATA: Final = Path(__file__).resolve().parent / "testdata" / "nflverse"
_CHUNK: Final = 4096


def fixture_rows(name: str) -> list[dict[str, str]]:
    """A fixture's rows as Python's csv reads them: the test's independent reading of the file."""
    raw = (TESTDATA / name).read_bytes()
    body = gzip.decompress(raw).decode() if name.endswith(".gz") else raw.decode()
    return list(csv.DictReader(io.StringIO(body)))


@dataclass
class FixtureFetcher:
    """Answers `<release>/<file>` from the fixture named `<file>`; `bodies` overrides a file's bytes."""

    bodies: Mapping[str, bytes] = field(default_factory=dict)
    requested: list[str] = field(default_factory=list)

    def _body(self, url: str) -> bytes | None:
        name = url.rsplit("/", 1)[-1]
        self.requested.append(name)
        if name in self.bodies:
            return self.bodies[name]
        path = TESTDATA / name
        return path.read_bytes() if path.exists() else None

    def get(self, url: str, headers: Mapping[str, str] | None = None) -> HttpResponse:
        body = self._body(url)
        return HttpResponse(404, b"") if body is None else HttpResponse(200, body)

    def stream(self, url: str, headers: Mapping[str, str] | None = None) -> tuple[int, Iterator[bytes]]:
        body = self._body(url)
        if body is None:
            return 404, iter([b""])
        return 200, iter([body[i : i + _CHUNK] for i in range(0, len(body), _CHUNK)] or [b""])
