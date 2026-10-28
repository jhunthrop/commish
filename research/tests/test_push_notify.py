"""The starter status push call (Lane 262): the job's identity token for the API's own URL, one POST,
and a line either way; skipped when no API is named."""

import httpx

from research.inseason.push_notify import METADATA_IDENTITY, STARTER_STATUS_PATH, notify_starter_status

API = "https://api.example.invalid"


def _client(answer: httpx.Response, seen: list[httpx.Request]) -> httpx.Client:
    def handle(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        if str(request.url).startswith(METADATA_IDENTITY):
            return httpx.Response(200, text="id-token\n")
        return answer

    return httpx.Client(transport=httpx.MockTransport(handle))


def test_skipped_without_an_api() -> None:
    ok, line = notify_starter_status(api_url="")
    assert ok
    assert "skipped" in line


def test_posts_with_the_jobs_identity() -> None:
    seen: list[httpx.Request] = []
    answer = httpx.Response(200, json={"data": {"changes": 3, "queued": 2, "newer_at": None}})
    ok, line = notify_starter_status(_client(answer, seen), API + "/")
    assert ok
    assert line == "starter-status push: 3 changes, 2 queued"
    token_request, post = seen
    assert token_request.headers["Metadata-Flavor"] == "Google"
    assert token_request.url.params["audience"] == API
    assert post.method == "POST"
    assert str(post.url) == API + STARTER_STATUS_PATH
    assert post.headers["Authorization"] == "Bearer id-token"


def test_a_refusal_fails_the_step() -> None:
    seen: list[httpx.Request] = []
    ok, line = notify_starter_status(_client(httpx.Response(401, json={"error": {}}), seen), API)
    assert not ok
    assert "401" in line


def test_an_unreachable_metadata_server_fails_the_step() -> None:
    def refuse(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("no metadata server", request=request)

    ok, line = notify_starter_status(httpx.Client(transport=httpx.MockTransport(refuse)), API)
    assert not ok
    assert "ConnectError" in line
