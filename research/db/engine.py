"""One engine per process, built from an explicit URL. No module-level connection, ever."""

from sqlalchemy import Engine, create_engine, pool


def make_engine(url: str) -> Engine:
    """An engine for `url` (already in SQLAlchemy form, see `research.db.url`).

    NullPool: the pipeline is a batch job that opens a connection, writes, and exits, so a pool
    would only hold connections open past the work. `prepare_threshold=None` is the psycopg 3
    spelling of the TypeScript client's `prepare: false`, for the same PgBouncer reason.
    """
    return create_engine(url, poolclass=pool.NullPool, connect_args={"prepare_threshold": None})
