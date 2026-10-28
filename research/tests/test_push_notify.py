"""The starter status push call (Lane 262): the job's identity token for the API's own URL, one POST,
and a line either way, never an exception; skipped when no https API is named."""

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


def test_skipped_without_an_https_api() -> None:
    assert "skipped" in notify_starter_status(api_url="")
    seen: list[httpx.Request] = []
    line = notify_starter_status(_client(httpx.Response(202), seen), "http://api.example.invalid")
    assert "https" in line
    assert seen == []


def test_posts_with_the_jobs_identity() -> None:
    seen: list[httpx.Request] = []
    answer = httpx.Response(202, json={"data": {"requested_at": "2026-10-28T03:00:00Z"}})
    line = notify_starter_status(_client(answer, seen), API + "/")
    assert line == "starter-status push: requested"
    token_request, post = seen
    assert token_request.headers["Metadata-Flavor"] == "Google"
    assert token_request.url.params["audience"] == API
    assert post.method == "POST"
    assert str(post.url) == API + STARTER_STATUS_PATH
    assert post.headers["Authorization"] == "Bearer id-token"


def test_a_refusal_is_a_line() -> None:
    seen: list[httpx.Request] = []
    line = notify_starter_status(_client(httpx.Response(401, text="not json"), seen), API)
    assert "not requested" in line
    assert "401" in line


def test_an_unreachable_metadata_server_is_a_line() -> None:
    def refuse(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("no metadata server", request=request)

    line = notify_starter_status(httpx.Client(transport=httpx.MockTransport(refuse)), API)
    assert "ConnectError" in line


def test_an_odd_url_is_a_line() -> None:
    line = notify_starter_status(
        httpx.Client(transport=httpx.MockTransport(lambda r: httpx.Response(200))), "https://[::1"
    )
    assert "not requested" in line
