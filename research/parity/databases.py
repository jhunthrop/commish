"""Scratch databases for the parity harness: one built by drizzle, one by alembic, per run.

The harness never touches a database it did not create. It is handed an ADMIN URL
(`PARITY_DATABASE_URL`, any database on a server where it may CREATE DATABASE: a local Postgres,
or the CI service container, in the TCP form; production's Cloud SQL socket form is never a target) and makes its own scratch databases beside it, named with a
`parity_` prefix so nothing else on the server can be mistaken for one.
"""

import json
import re
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit

import psycopg
from alembic import command
from alembic.config import Config

from research.db.url import database_url_from_env, sqlalchemy_url
from research.errors import ConfigurationError

RESEARCH_ROOT = Path(__file__).resolve().parent.parent
REPO_ROOT = RESEARCH_ROOT.parent
DRIZZLE_DIR = REPO_ROOT / "drizzle"
SCRATCH_NAME = re.compile(r"^parity_[a-z0-9_]+$")


def admin_url() -> str:
    """The libpq URL the harness creates scratch databases through."""
    url = database_url_from_env("PARITY_DATABASE_URL")
    return url.replace("postgresql+psycopg://", "postgresql://", 1)


def url_for(database: str) -> str:
    """The admin URL with its database swapped for `database`, in libpq form."""
    parts = urlsplit(admin_url())
    return urlunsplit((parts.scheme, parts.netloc, f"/{database}", parts.query, parts.fragment))


def _scratch(database: str) -> str:
    if SCRATCH_NAME.fullmatch(database) is None:
        raise ConfigurationError(f"refusing to touch {database!r}: scratch databases are named parity_*.")
    return database


def drop(database: str) -> None:
    """Drops a scratch database if it exists. Refuses any name not shaped `parity_*`."""
    with psycopg.connect(admin_url(), autocommit=True) as conn:
        conn.execute(f'DROP DATABASE IF EXISTS "{_scratch(database)}" WITH (FORCE)')


def drop_scratch_databases() -> list[str]:
    """Drops every `parity_*` database on the server: leftovers of an interrupted run."""
    with psycopg.connect(admin_url(), autocommit=True) as conn:
        names = [str(row[0]) for row in conn.execute("select datname from pg_database where datname like 'parity\\_%'")]
    for name in names:
        drop(name)
    return names


def recreate(database: str) -> str:
    """Drops and creates `database`, returning its libpq URL. Refuses any name not shaped `parity_*`."""
    drop(database)
    with psycopg.connect(admin_url(), autocommit=True) as conn:
        conn.execute(f'CREATE DATABASE "{_scratch(database)}"')
    return url_for(database)


def clone(template: str, database: str) -> str:
    """A fresh `database` copied from `template`, returning its libpq URL."""
    drop(database)
    with psycopg.connect(admin_url(), autocommit=True) as conn:
        conn.execute(f'CREATE DATABASE "{_scratch(database)}" TEMPLATE "{_scratch(template)}"')
    return url_for(database)


def drizzle_journal() -> list[str]:
    """The migration tags in journal order — what `drizzle-kit migrate` would apply."""
    journal = json.loads((DRIZZLE_DIR / "meta" / "_journal.json").read_text())
    return [str(entry["tag"]) for entry in journal["entries"]]


def build_with_drizzle(database: str) -> str:
    """A fresh database migrated by the TypeScript lane's drizzle journal, every app table included."""
    url = recreate(database)
    with psycopg.connect(url, autocommit=True) as conn:
        for tag in drizzle_journal():
            conn.execute((DRIZZLE_DIR / f"{tag}.sql").read_text().encode())
    return url


def build_with_alembic(database: str, revision: str = "head") -> str:
    """A fresh database migrated by this lane's alembic revisions."""
    url = recreate(database)
    config = Config(str(RESEARCH_ROOT / "alembic.ini"))
    config.attributes["url"] = sqlalchemy_url(url)
    command.upgrade(config, revision)
    return url
