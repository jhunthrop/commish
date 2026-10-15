"""One engine per process, built from an explicit URL. No module-level connection, ever."""

from collections.abc import Callable
from types import MappingProxyType
from typing import Final

from sqlalchemy import Engine, create_engine, pool
from sqlalchemy.exc import DBAPIError, OperationalError

# psycopg 3's spelling of the TypeScript client's `prepare: false`, for PgBouncer: every engine's.
_CONNECT_ARGS: Final = MappingProxyType({"prepare_threshold": None})
# A connection exception (SQLSTATE class 08); a lost connection with no SQLSTATE at all is one too.
_CONNECTION_CLASS: Final = "08"


def make_engine(url: str) -> Engine:
    """An engine for `url` (already in SQLAlchemy form, see `research.db.url`).

    NullPool: the pipeline is a batch job that opens a connection, writes, and exits, so a pool
    would only hold connections open past the work. `prepare_threshold=None` is the psycopg 3
    spelling of the TypeScript client's `prepare: false`, for the same PgBouncer reason.
    """
    return create_engine(url, poolclass=pool.NullPool, connect_args=_CONNECT_ARGS)


# Connections a pooled engine may open past its steady size, for a reader beside the writers.
POOL_HEADROOM = 4


def pooled_like(engine: Engine, writers: int) -> Engine:
    """An engine on `engine`'s URL that keeps `writers` connections open (plus `POOL_HEADROOM`), each
    pinged before use, for a step that commits from many threads: the database (or the proxy in
    front of it) sees a few long connections, not one short one per commit (the 2026-10-15 nightly
    lost one of thousands through the Cloud SQL proxy). Dispose of it when the step ends."""
    return create_engine(
        engine.url,
        poolclass=pool.QueuePool,
        pool_size=writers,
        max_overflow=POOL_HEADROOM,
        pool_pre_ping=True,
        connect_args=_CONNECT_ARGS,
    )


def connection_lost(error: DBAPIError) -> bool:
    """Whether the error is a lost connection: SQLAlchemy invalidated it, or the driver's operational
    error carries a connection-class SQLSTATE (08) or none at all (the server closed it unexpectedly).
    A statement timeout, a deadlock or a lock wait (also operational errors) is not."""
    if error.connection_invalidated:
        return True
    if not isinstance(error, OperationalError):
        return False
    state = getattr(error.orig, "sqlstate", None)
    return state is None or str(state).startswith(_CONNECTION_CLASS)


def once_more_on_disconnect[T](action: Callable[[], T]) -> T:
    """`action`, run once more on a fresh connection when the first try lost its connection
    (`connection_lost`). Any other error, or a second loss, is raised: the action opens its own
    connection, so the retry starts clean."""
    try:
        return action()
    except DBAPIError as error:
        if not connection_lost(error):
            raise
    return action()
