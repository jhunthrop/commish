"""THE HTTP BOUNDARY: every ingest reaches a provider through `Fetcher`, and nothing else.

One protocol, two implementations. `LiveFetcher` is httpx against the real provider. The parity
harness's `ReplayFetcher` (`research.parity.replay`) answers from recorded fixtures and refuses any
request it has no recording for, so a replayed ingest can never quietly reach the network.

A response is handed back whole and unjudged (status, headers, body): deciding what a 404 or an
empty body MEANS is each provider client's job, because it means different things per provider
(nflverse's 404 is "not published yet", Tank01's empty 200 is a failure).
"""

from collections.abc import Iterator, Mapping
from dataclasses import dataclass, field
from typing import Protocol

import httpx


@dataclass(frozen=True)
class HttpResponse:
    status: int
    body: bytes
    headers: Mapping[str, str] = field(default_factory=dict)

    @property
    def ok(self) -> bool:
        return 200 <= self.status < 300

    def text(self) -> str:
        return self.body.decode("utf-8-sig", errors="replace")

    def header(self, name: str) -> str | None:
        lowered = name.lower()
        for key, value in self.headers.items():
            if key.lower() == lowered:
                return value
        return None


class Fetcher(Protocol):
    def get(self, url: str, headers: Mapping[str, str] | None = None) -> HttpResponse: ...

    def stream(self, url: str, headers: Mapping[str, str] | None = None) -> tuple[int, Iterator[bytes]]:
        """The status and the body as byte chunks, for assets too large to hold whole."""
        ...


class LiveFetcher:
    """httpx against the real network. Timeouts are explicit; redirects are followed (GitHub
    release assets redirect to their storage host)."""

    def __init__(self, timeout_seconds: float = 120.0) -> None:
        self._client = httpx.Client(timeout=timeout_seconds, follow_redirects=True)

    def get(self, url: str, headers: Mapping[str, str] | None = None) -> HttpResponse:
        response = self._client.get(url, headers=dict(headers or {}))
        return HttpResponse(status=response.status_code, body=response.content, headers=dict(response.headers))

    def stream(self, url: str, headers: Mapping[str, str] | None = None) -> tuple[int, Iterator[bytes]]:
        request = self._client.build_request("GET", url, headers=dict(headers or {}))
        response = self._client.send(request, stream=True)

        def chunks() -> Iterator[bytes]:
            try:
                yield from response.iter_bytes()
            finally:
                response.close()

        return response.status_code, chunks()

    def close(self) -> None:
        self._client.close()
