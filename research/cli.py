"""What the research command lines share: one stamped line to stdout, flushed, for a job's log."""

import sys
from datetime import UTC, datetime


def log_line(text: str) -> None:
    sys.stdout.write(f"{datetime.now(UTC).isoformat()} {text}\n")
    sys.stdout.flush()
