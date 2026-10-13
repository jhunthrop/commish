"""`python -m research.advisor`: the advisor service on $PORT (8080), uvloop and httptools.

The closed form is CPU work on one thread, so a process answers one call at a time; the service
runs `ADVISOR_WORKERS` processes (default 2, one per vCPU of the Cloud Run shape) so two rooms on
the clock together are answered side by side.
"""

import logging
import os
import sys
from typing import Final

import uvicorn

DEFAULT_PORT: Final = 8080
DEFAULT_WORKERS: Final = 2


def _positive(name: str, default: int) -> int | None:
    raw = os.environ.get(name, str(default))
    if not raw.isdigit() or int(raw) <= 0:
        sys.stderr.write(f"advisor: {name} must be a positive integer; got {raw!r}\n")
        return None
    return int(raw)


def main() -> int:
    port = _positive("PORT", DEFAULT_PORT)
    workers = _positive("ADVISOR_WORKERS", DEFAULT_WORKERS)
    if port is None or workers is None:
        return 2
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    uvicorn.run(
        "research.advisor.server:create_app",
        factory=True,
        workers=workers,
        host="0.0.0.0",
        port=port,
        loop="uvloop",
        http="httptools",
        access_log=False,
        timeout_graceful_shutdown=10,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
