"""A PASS'S ANSWERS, KEPT FOR ITS RETRY (Lane 143, B125).

The hourly capture writes in one transaction with its dating. When the database connection dies in that
transaction, nothing the pass captured is stored, but the provider was already asked and its requests
spent. `RecordingFetcher` keeps every answer of the first attempt, in order per URL (a burst retry asks
one URL twice), and `replay()` hands the retry a fetcher that answers exactly those again, so the
capture is written on a fresh connection without asking the provider twice. A request the first attempt
never made is refused, never sent: the retry can not spend past the pass's budget.
"""

from collections.abc import Iterator, Mapping
from dataclasses import dataclass

from research.errors import ResearchError
from research.pipeline.http import Fetcher, HttpResponse


class UnansweredRequestError(ResearchError):
    """The retry asked for a URL the first attempt never read (or read fewer times)."""


@dataclass(frozen=True)
class _Answer:
    """One read's outcome: the response, or the error the fetcher raised."""

    response: HttpResponse | None = None
    error: Exception | None = None


class RecordingFetcher:
    """A `Fetcher` that reads through to another and keeps each answer for a replay."""

    def __init__(self, fetcher: Fetcher) -> None:
        self._fetcher = fetcher
        self._answers: dict[str, list[_Answer]] = {}

    @property
    def asked(self) -> int:
        """How many reads reached the provider, answered or not: what the pass really spent."""
        return sum(len(answers) for answers in self._answers.values())

    def get(self, url: str, headers: Mapping[str, str] | None = None) -> HttpResponse:
        try:
            response = self._fetcher.get(url, headers)
        except Exception as error:
            self._answers.setdefault(url, []).append(_Answer(error=error))
            raise
        self._answers.setdefault(url, []).append(_Answer(response=response))
        return response

    def stream(self, url: str, headers: Mapping[str, str] | None = None) -> tuple[int, Iterator[bytes]]:
        """Streams read through unkept: a body too large to hold is never replayed."""
        return self._fetcher.stream(url, headers)

    def replay(self) -> "ReplayedFetcher":
        return ReplayedFetcher({url: tuple(answers) for url, answers in self._answers.items()})


class ReplayedFetcher:
    """A `Fetcher` answering a recorded attempt's reads again, each URL's in the order they came."""

    def __init__(self, answers: Mapping[str, tuple[_Answer, ...]]) -> None:
        self._answers = answers
        self._read: dict[str, int] = {}

    def get(self, url: str, headers: Mapping[str, str] | None = None) -> HttpResponse:
        del headers
        index = self._read.get(url, 0)
        kept = self._answers.get(url, ())
        if index >= len(kept):
            raise UnansweredRequestError(f"{url} was not read before the connection was lost; not asked again")
        self._read[url] = index + 1
        answer = kept[index]
        if answer.error is not None:
            raise answer.error
        assert answer.response is not None
        return answer.response

    def stream(self, url: str, headers: Mapping[str, str] | None = None) -> tuple[int, Iterator[bytes]]:
        del headers
        raise UnansweredRequestError(f"{url} was streamed, and a stream is never kept for a retry")
