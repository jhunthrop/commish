"""Alembic environment for the research schema.

ONLINE ONLY, AGAINST DATABASE_URL. An offline SQL render is not offered: every revision here is
checked against a real Postgres by the parity harness's schema gate, and a script that was never
run is not a migration anyone should trust.

ADOPTING AN EXISTING DATABASE. The dev and production databases already hold every research table
(drizzle created them). On those, run `alembic stamp 0001_baseline` once, which records the
baseline without executing it, then `alembic upgrade head` for everything after. A fresh database
runs `alembic upgrade head` from nothing.
"""

from alembic import context
from sqlalchemy import create_engine, pool

from research.db.schema import METADATA
from research.db.url import database_url_from_env


def target_url() -> str:
    """A caller-supplied URL (the parity harness hands one in through the config's attributes) or
    DATABASE_URL. The attribute exists so a harness never has to mutate the process environment."""
    supplied = context.config.attributes.get("url")
    return supplied if isinstance(supplied, str) else database_url_from_env()


def run_migrations_online() -> None:
    engine = create_engine(target_url(), poolclass=pool.NullPool)
    with engine.connect() as connection:
        context.configure(connection=connection, target_metadata=METADATA, compare_type=True)
        with context.begin_transaction():
            context.run_migrations()


run_migrations_online()
