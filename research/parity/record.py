"""RECORDING A CASE'S INPUTS, ONCE: real responses from the real providers, never synthesized.

`record_case` fetches every request a case names through the live network and files the body
under `parity/fixtures/<case>/`. A CSV asset too large to commit whole is narrowed by a ROW
FILTER that keeps the header and the chosen records BYTE FOR BYTE (the raw text of each kept
record, quotes and line endings as published), so a slice is still a recording of the release and
not a re-serialisation of it. The filter and its reason are written into the manifest beside the
file, the same discipline `src/projections/nflverse/fixtures/manifest.json` keeps.

Secret query parameters are stripped from the recorded URL (`replay.SECRET_PARAMS`); request
headers (where Tank01's key travels) are never recorded.
"""

import gzip
import json
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path

from research.parity.replay import FIXTURES_ROOT, normalized_url
from research.pipeline.http import Fetcher
from research.pipeline.nflverse.csv import split_records

RowFilter = Callable[[Mapping[str, str]], bool]

# Response headers a mapper reads (the odds API reports its credit balance in two of them).
KEPT_HEADERS = ("content-type", "x-requests-remaining", "x-requests-used", "x-requests-last")


@dataclass(frozen=True)
class RecordSpec:
    """One request to record: where, how to narrow it, and why the narrowing keeps what it keeps."""

    url: str
    file: str
    row_filter: RowFilter | None = None
    filtered: str = "the whole response, unfiltered"
    request_headers: Mapping[str, str] = field(default_factory=dict)


def raw_records(text: str) -> list[str]:
    """The document's records as their RAW text, each with its own line terminator.

    Walks the same quote-aware state the strict splitter does, so a newline inside a quoted field
    stays inside its record.
    """
    records: list[str] = []
    start = 0
    quoted = False
    pending_quote = False
    field_empty = True
    for index, char in enumerate(text):
        if pending_quote:
            pending_quote = False
            if char == '"':
                continue
            quoted = False
        if quoted:
            if char == '"':
                pending_quote = True
            continue
        if char == '"' and field_empty:
            quoted = True
            field_empty = False
        elif char == ",":
            field_empty = True
        elif char == "\n":
            records.append(text[start : index + 1])
            start = index + 1
            field_empty = True
        elif char != "\r":
            field_empty = False
    if start < len(text):
        records.append(text[start:])
    return records


def slice_csv(text: str, keep: RowFilter) -> str:
    """The header and every record `keep` accepts, byte for byte."""
    raw = raw_records(text)
    parsed = split_records(text)
    header = parsed[0]
    kept = [raw[0]]
    for raw_record, fields in zip(raw[1:], parsed[1:], strict=True):
        if keep(dict(zip(header, fields, strict=True))):
            kept.append(raw_record)
    return "".join(kept)


def record_case(case: str, specs: Sequence[RecordSpec], fetcher: Fetcher, note: str) -> Path:
    case_dir = FIXTURES_ROOT / case
    case_dir.mkdir(parents=True, exist_ok=True)
    responses = []
    for spec in specs:
        response = fetcher.get(spec.url, spec.request_headers)
        body = response.body
        if spec.row_filter is not None and response.ok:
            body = slice_csv(response.body.decode("utf-8"), spec.row_filter).encode("utf-8")
        (case_dir / spec.file).write_bytes(gzip.compress(body, mtime=0))
        headers = {name: value for name in KEPT_HEADERS if (value := response.header(name)) is not None}
        responses.append(
            {
                "url": normalized_url(spec.url),
                "status": response.status,
                "file": spec.file,
                "headers": headers,
                "filtered": spec.filtered,
                "bytes": len(body),
            }
        )
    manifest = {
        "provenance": "recorded-from-live-provider",
        "recordedAt": datetime.now(UTC).strftime("%Y-%m-%d"),
        "note": note,
        "responses": responses,
    }
    (case_dir / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    return case_dir
