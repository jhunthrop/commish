"""Scratch databases for the parity harness: one built by drizzle, one by alembic, per run.

The harness never touches a database it did not create. It is handed an ADMIN URL
(`PARITY_DATABASE_URL`, any database on a server where it may CREATE DATABASE: a local Postgres,
or the CI service container, in the TCP form; production's Cloud SQL socket form is never a target) and makes its own scratch databases beside it, named with a
`parity_` prefix so nothing else on the server can be mistaken for one.

ONE FAMILY PER ADMIN DATABASE (B85). Callers name a scratch database by its role (`parity_test_designations`);
the name made on the server carries the admin database's own name after the prefix
(`parity_lane110_research_test__test_designations` for `.../lane110_research_test`), so two lanes whose
PARITY_DATABASE_URL names different databases on one server never touch each other's scratch databases,
and the leftover sweep drops only its own family's.
"""

import hashlib
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
SCRATCH_PREFIX = "parity_"
# Postgres keeps the first 63 bytes of a name: a longer one is shortened here, with a digest of the
# whole so two long names never shorten to one.
MAX_NAME_BYTES = 63
_DIGEST_CHARS = 8
# A family is the admin database's name in [a-z0-9_], runs of underscores made one, so the `__` that ends
# the prefix never occurs inside a family and one family's names never start another's prefix.
_NOT_NAME_CHARS = re.compile(r"[^a-z0-9]+")
MAX_FAMILY_CHARS = 32


def admin_url() -> str:
    """The libpq URL the harness creates scratch databases through."""
    url = database_url_from_env("PARITY_DATABASE_URL")
    return url.replace("postgresql+psycopg://", "postgresql://", 1)


def url_for(database: str) -> str:
    """The admin URL with its database swapped for `database` (a name on the server), in libpq form."""
    parts = urlsplit(admin_url())
    return urlunsplit((parts.scheme, parts.netloc, f"/{database}", parts.query, parts.fragment))


def family_prefix(admin: str) -> str:
    """`parity_<admin database>__`: the start of every scratch name made beside `admin` (a libpq URL)."""
    database = urlsplit(admin).path.lstrip("/")
    family = _NOT_NAME_CHARS.sub("_", database.lower()).strip("_")
    if not family:
        raise ConfigurationError("PARITY_DATABASE_URL names no database: its name is the scratch databases' family.")
    if len(family) > MAX_FAMILY_CHARS:
        family = f"{family[: MAX_FAMILY_CHARS - _DIGEST_CHARS - 1].rstrip('_')}_{_digest(family)}"
    return f"{SCRATCH_PREFIX}{family}__"


def _digest(text: str) -> str:
    return hashlib.sha256(text.encode()).hexdigest()[:_DIGEST_CHARS]


def scratch_name(role: str, admin: str) -> str:
    """The server's name for the scratch database `role` (shaped `parity_*`) in `admin`'s family."""
    if SCRATCH_NAME.fullmatch(role) is None:
        raise ConfigurationError(f"refusing to touch {role!r}: scratch databases are named parity_*.")
    name = family_prefix(admin) + role.removeprefix(SCRATCH_PREFIX)
    if len(name) <= MAX_NAME_BYTES:
        return name
    return f"{name[: MAX_NAME_BYTES - _DIGEST_CHARS - 1]}_{_digest(name)}"


def _server_name(role: str) -> str:
    return scratch_name(role, admin_url())


def _drop_named(name: str) -> None:
    with psycopg.connect(admin_url(), autocommit=True) as conn:
        conn.execute(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)')


def drop(database: str) -> None:
    """Drops the scratch database `database` if it exists. Refuses any name not shaped `parity_*`."""
    _drop_named(_server_name(database))


def drop_scratch_databases() -> list[str]:
    """Drops every scratch database of this admin database's family: leftovers of an interrupted run.
    Another family's (another lane's PARITY_DATABASE_URL on the same server) is never touched."""
    prefix = family_prefix(admin_url())
    pattern = prefix.replace("_", "\\_") + "%"
    with psycopg.connect(admin_url(), autocommit=True) as conn:
        names = [
            str(row[0]) for row in conn.execute("select datname from pg_database where datname like %s", (pattern,))
        ]
    for name in names:
        _drop_named(name)
    return names


def recreate(database: str) -> str:
    """Drops and creates `database`, returning its libpq URL. Refuses any name not shaped `parity_*`."""
    drop(database)
    with psycopg.connect(admin_url(), autocommit=True) as conn:
        conn.execute(f'CREATE DATABASE "{_server_name(database)}"')
    return url_for(_server_name(database))


def clone(template: str, database: str) -> str:
    """A fresh `database` copied from `template`, returning its libpq URL."""
    drop(database)
    with psycopg.connect(admin_url(), autocommit=True) as conn:
        conn.execute(f'CREATE DATABASE "{_server_name(database)}" TEMPLATE "{_server_name(template)}"')
    return url_for(_server_name(database))


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
