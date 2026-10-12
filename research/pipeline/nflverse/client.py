"""The nflverse release fetcher (`src/projections/nflverse/client.ts`).

The failure KIND is typed because each means a different operator action: `not_found` is the
ordinary case of a season nflverse has not published, `upstream` wants a retry, `malformed` wants
a human. `getCsv` parses a whole asset; `streamCsv` projects named columns out of an asset too
large to hold (play-by-play), decompressing a `.gz` asset explicitly because GitHub serves it as
opaque bytes.
"""

import codecs
import zlib
from collections.abc import Callable, Iterator
from dataclasses import dataclass
from typing import Literal
from urllib.parse import urljoin

from research.errors import ResearchError
from research.pipeline.http import Fetcher
from research.pipeline.jscompat import js_trim
from research.pipeline.nflverse.config import NFLVERSE_BASE_URL
from research.pipeline.nflverse.csv import CsvRow, CsvSplitter, parse_csv, project_records

FailureKind = Literal["not_found", "upstream", "malformed"]


class NflverseError(ResearchError):
    def __init__(self, kind: FailureKind, asset: str, message: str) -> None:
        super().__init__(message)
        self.kind: FailureKind = kind
        self.asset = asset


def _asset_url(base_url: str, release: str, file: str) -> str:
    return urljoin(base_url, f"{release}/{file}")


def _assert_ok(status: int, asset: str) -> None:
    if status == 404:
        raise NflverseError("not_found", asset, f"nflverse has no release asset {asset}.")
    if not 200 <= status < 300:
        raise NflverseError("upstream", asset, f"nflverse returned HTTP {status} for {asset}.")


def _decoded(chunks: Iterator[bytes], gzipped: bool) -> Iterator[str]:
    inflater = zlib.decompressobj(16 + zlib.MAX_WBITS) if gzipped else None
    decoder = codecs.getincrementaldecoder("utf-8-sig")(errors="replace")
    for chunk in chunks:
        data = inflater.decompress(chunk) if inflater is not None else chunk
        text = decoder.decode(data)
        if text:
            yield text
    tail = inflater.flush() if inflater is not None else b""
    final = decoder.decode(tail, final=True)
    if final:
        yield final


@dataclass(frozen=True)
class NflverseClient:
    fetcher: Fetcher
    base_url: str = NFLVERSE_BASE_URL

    def get_csv(self, release: str, file: str) -> list[dict[str, str]]:
        asset = f"{release}/{file}"
        response = self.fetcher.get(_asset_url(self.base_url, release, file))
        _assert_ok(response.status, asset)
        body = response.text()
        if js_trim(body) == "":
            raise NflverseError("malformed", asset, f"nflverse returned an empty body for {asset}.")
        try:
            return parse_csv(body)
        except ResearchError as error:
            raise NflverseError("malformed", asset, f"nflverse asset {asset} did not parse: {error}") from error

    def stream_csv(self, release: str, file: str, columns: tuple[str, ...], on_row: Callable[[CsvRow], None]) -> int:
        asset = f"{release}/{file}"
        status, chunks = self.fetcher.stream(_asset_url(self.base_url, release, file))
        _assert_ok(status, asset)
        splitter = CsvSplitter()

        def records() -> Iterator[list[str]]:
            for text in _decoded(chunks, file.endswith(".gz")):
                yield from splitter.feed(text)
            yield from splitter.end()

        count = 0
        try:
            for row in project_records(records(), columns, asset):
                count += 1
                on_row(row)
        except NflverseError:
            raise
        except ResearchError as error:
            raise NflverseError("malformed", asset, str(error)) from error
        return count
