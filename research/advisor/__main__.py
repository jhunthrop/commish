"""`python -m research.advisor`: the advisor service on $PORT (8080), one process, uvloop and httptools."""

import logging
import os
import sys
from typing import Final

import uvicorn

from research.advisor.server import create_app

DEFAULT_PORT: Final = 8080


def main() -> int:
    raw = os.environ.get("PORT", str(DEFAULT_PORT))
    if not raw.isdigit() or int(raw) <= 0:
        sys.stderr.write(f"advisor: PORT must be a positive integer; got {raw!r}\n")
        return 2
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    uvicorn.run(
        create_app(),
        host="0.0.0.0",
        port=int(raw),
        loop="uvloop",
        http="httptools",
        access_log=False,
        timeout_graceful_shutdown=10,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
