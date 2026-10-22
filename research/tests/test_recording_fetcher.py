"""A pass's answers kept for its retry (Lane 143, B125): replayed in order, errors too, nothing new asked."""

from collections.abc import Iterator, Mapping
from http import HTTPStatus

import httpx
import pytest

from research.pipeline.http import HttpResponse
from research.pipeline.recording_fetcher import RecordingFetcher, UnansweredRequestError

_URL = "https://tank01.example/getNFLGamesForDate?gameDate=20261018"


class _Scripted:
    """A provider answering a script in order: a response, or an error raised."""

    def __init__(self, script: list[HttpResponse | Exception]) -> None:
        self._script = script
        self.asked = 0

    def get(self, url: str, headers: Mapping[str, str] | None = None) -> HttpResponse:
        answer = self._script[self.asked]
        self.asked += 1
        if isinstance(answer, Exception):
            raise answer
        return answer

    def stream(self, url: str, headers: Mapping[str, str] | None = None) -> tuple[int, Iterator[bytes]]:
        return 200, iter([b"streamed"])


def test_the_replay_answers_each_read_again_in_order_without_asking() -> None:
    # A burst retry asks one URL twice: the 429, then the answer.
    answers = [HttpResponse(HTTPStatus.TOO_MANY_REQUESTS, b""), HttpResponse(HTTPStatus.OK, b'{"body": 1}')]
    provider = _Scripted(list(answers))
    recording = RecordingFetcher(provider)
    assert [recording.get(_URL), recording.get(_URL)] == answers
    replay = recording.replay()
    assert [replay.get(_URL), replay.get(_URL)] == answers
    assert provider.asked == len(answers)


def test_an_error_is_replayed_as_raised() -> None:
    timeout = httpx.ReadTimeout("read timed out")
    recording = RecordingFetcher(_Scripted([timeout]))
    with pytest.raises(httpx.ReadTimeout):
        recording.get(_URL)
    with pytest.raises(httpx.ReadTimeout):
        recording.replay().get(_URL)


def test_a_read_the_first_attempt_never_made_is_refused() -> None:
    recording = RecordingFetcher(_Scripted([HttpResponse(200, b"{}")]))
    recording.get(_URL)
    replay = recording.replay()
    replay.get(_URL)
    with pytest.raises(UnansweredRequestError, match="not asked again"):
        replay.get(_URL)
    with pytest.raises(UnansweredRequestError):
        replay.get("https://tank01.example/getNFLTeams")


def test_streams_read_through_and_are_never_replayed() -> None:
    recording = RecordingFetcher(_Scripted([]))
    status, chunks = recording.stream(_URL)
    assert (status, list(chunks)) == (200, [b"streamed"])
    with pytest.raises(UnansweredRequestError):
        recording.replay().stream(_URL)


def test_each_replay_starts_from_the_first_answer() -> None:
    answer = HttpResponse(HTTPStatus.OK, b"{}")
    recording = RecordingFetcher(_Scripted([answer]))
    recording.get(_URL)
    assert recording.replay().get(_URL) == answer
    assert recording.replay().get(_URL) == answer


def test_asked_counts_every_live_read_and_never_a_replayed_one() -> None:
    # The pass's budget comes from this count (Lane 143 fix round 1): a burst retry's two reads, an
    # error, and nothing the replay answers.
    answers = [HttpResponse(HTTPStatus.TOO_MANY_REQUESTS, b""), HttpResponse(HTTPStatus.OK, b"{}")]
    recording = RecordingFetcher(_Scripted([*answers, httpx.ReadTimeout("read timed out")]))
    recording.get(_URL)
    recording.get(_URL)
    with pytest.raises(httpx.ReadTimeout):
        recording.get("https://tank01.example/getNFLTeams")
    recording.replay().get(_URL)
    assert recording.asked == len(answers) + 1
