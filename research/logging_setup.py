"""THE ONE LOGGING SETUP every research command line calls, so no secret reaches a job's log.

httpx logs each request at INFO with its full URL, and the odds provider takes its key as a query
parameter, so httpx and httpcore are held at WARNING. Behind that, a filter on the root handlers
rewrites any secret-looking query value (`apiKey=`, `api_key=`, `key=`, `token=`, `secret=`) to
`[redacted]` in every record's message and exception text, whichever logger wrote it.
"""

import logging
import re
from typing import Final

LOG_FORMAT: Final = "%(levelname)s %(name)s: %(message)s"
QUIET_LOGGERS: Final = ("httpx", "httpcore")
REDACTED: Final = "[redacted]"
# Matched without a word boundary on purpose: `access_token=` and `x-api-key=` are secrets too, and
# redacting a harmless `monkey=` costs nothing.
_SECRET_QUERY: Final = re.compile(r"(?i)((?:api_?key|key|token|secret)=)[^&\s#'\"]+")


def redact(text: str) -> str:
    """The text with every secret-looking query value replaced by `[redacted]`."""
    return _SECRET_QUERY.sub(rf"\g<1>{REDACTED}", text)


class RedactSecrets(logging.Filter):
    """Rewrites a record's message and exception text before any handler formats it."""

    _formatter: Final = logging.Formatter()

    def filter(self, record: logging.LogRecord) -> bool:
        message = record.getMessage()
        cleaned = redact(message)
        if cleaned != message:
            record.msg, record.args = cleaned, None
        if record.exc_info and not record.exc_text:
            record.exc_text = self._formatter.formatException(record.exc_info)
        if record.exc_text:
            record.exc_text = redact(record.exc_text)
        return True


def configure_logging(level: int = logging.INFO) -> None:
    """The root handler at `level`, the HTTP clients held at WARNING, and the redaction filter on
    every root handler (once each, so a second call adds nothing)."""
    logging.basicConfig(format=LOG_FORMAT)
    root = logging.getLogger()
    root.setLevel(level)
    for name in QUIET_LOGGERS:
        logging.getLogger(name).setLevel(logging.WARNING)
    for handler in root.handlers:
        if not any(isinstance(existing, RedactSecrets) for existing in handler.filters):
            handler.addFilter(RedactSecrets())
