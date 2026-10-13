"""Alembic environment for the `research` schema.

ONLINE ONLY, AGAINST RESEARCH_DATABASE_URL. An offline SQL render is not offered: every revision is
checked against a real Postgres by the parity harness's schema gate, and a script that was never
run is not a migration anyone should trust.

Everything alembic owns lives in the `research` schema, its version table included, so the same
database can hold the legacy `public` tables beside it (the dev copy does) without either side
seeing the other. The schema is created here, before alembic looks for its version table in it;
revision 1 creates everything inside it.
"""

from alembic import context
from sqlalchemy import create_engine, pool, text

from research.db.schema import METADATA, RESEARCH_SCHEMA
from research.db.url import database_url_from_env


def target_url() -> str:
    """A caller-supplied URL (the parity harness hands one in through the config's attributes) or
    RESEARCH_DATABASE_URL. The attribute exists so a harness never has to mutate the environment."""
    supplied = context.config.attributes.get("url")
    return supplied if isinstance(supplied, str) else database_url_from_env()


def _owned(name: str | None, kind: str, _parent: object) -> bool:
    return kind != "schema" or name == RESEARCH_SCHEMA


def run_migrations_online() -> None:
    engine = create_engine(target_url(), poolclass=pool.NullPool)
    with engine.connect() as connection:
        connection.execute(text(f'CREATE SCHEMA IF NOT EXISTS "{RESEARCH_SCHEMA}"'))
        connection.commit()
        context.configure(
            connection=connection,
            target_metadata=METADATA,
            compare_type=True,
            compare_server_default=True,
            include_schemas=True,
            include_name=_owned,
            version_table_schema=RESEARCH_SCHEMA,
        )
        with context.begin_transaction():
            context.run_migrations()


run_migrations_online()
