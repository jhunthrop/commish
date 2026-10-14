"""The shared logging setup: secrets in query strings are redacted, and httpx's request line is quiet."""

import io
import logging
from collections.abc import Iterator

import httpx
import pytest

from research.logging_setup import RedactSecrets, configure_logging, redact

_URL = "https://api.the-odds-api.com/v4/sports/americanfootball_nfl/events?apiKey=abc123secret&regions=us"


@pytest.fixture
def captured() -> Iterator[io.StringIO]:
    """The root logger configured as an entry point would, writing to a buffer, restored after."""
    root = logging.getLogger()
    saved_handlers, saved_level = root.handlers[:], root.level
    quiet = {name: logging.getLogger(name).level for name in ("httpx", "httpcore")}
    buffer = io.StringIO()
    root.handlers = [logging.StreamHandler(buffer)]
    root.setLevel(logging.WARNING)
    configure_logging(logging.INFO)
    yield buffer
    root.handlers, root.level = saved_handlers, saved_level
    for name, level in quiet.items():
        logging.getLogger(name).setLevel(level)


def test_every_secret_query_value_is_redacted() -> None:
    text = "GET /x?apiKey=A1&api_key=B2&key=C3&token=D4&secret=E5&access_token=F6&regions=us"
    assert redact(text) == (
        "GET /x?apiKey=[redacted]&api_key=[redacted]&key=[redacted]&token=[redacted]"
        "&secret=[redacted]&access_token=[redacted]&regions=us"
    )


def test_a_logged_url_carrying_an_api_key_is_redacted(captured: io.StringIO) -> None:
    logging.getLogger("research.pipeline.odds").info("fetched %s", _URL)
    line = captured.getvalue()
    assert "abc123secret" not in line
    assert "apiKey=[redacted]&regions=us" in line


def test_an_exception_carrying_an_api_key_is_redacted(captured: io.StringIO) -> None:
    try:
        raise RuntimeError(f"request failed for {_URL}")
    except RuntimeError:
        logging.getLogger("research.inseason").exception("step failed")
    assert "abc123secret" not in captured.getvalue()
    assert "apiKey=[redacted]" in captured.getvalue()


def test_httpx_request_line_is_not_logged_at_info(captured: io.StringIO) -> None:
    transport = httpx.MockTransport(lambda request: httpx.Response(200, text="{}"))
    with httpx.Client(transport=transport) as client:
        client.get(_URL)
    assert "HTTP Request" not in captured.getvalue()
    assert "abc123secret" not in captured.getvalue()
    assert not logging.getLogger("httpx").isEnabledFor(logging.INFO)


def test_the_filter_is_added_once(captured: io.StringIO) -> None:
    configure_logging(logging.INFO)
    handler = next(h for h in logging.getLogger().handlers if isinstance(h, logging.StreamHandler))
    assert sum(isinstance(existing, RedactSecrets) for existing in handler.filters) == 1
