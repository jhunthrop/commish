"""THE DURABILITY POINT OF A NON-ATOMIC INGEST.

The TypeScript writes outside a transaction wherever it does not open one, so a long ingest (the
provider seed, a backfill) keeps what it wrote when it stops and a re-run finishes the rest. A
Python ingest that mirrors that takes a `Checkpoint` and calls it at each point the TypeScript's
work became durable; the command line passes the connection's commit, a parity run passes the
same, and a caller that wants one all-or-nothing transaction passes `no_checkpoint`.
"""

from collections.abc import Callable

Checkpoint = Callable[[], None]


def no_checkpoint() -> None:
    """Nothing becomes durable before the caller's own commit."""
