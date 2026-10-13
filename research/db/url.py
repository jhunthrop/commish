"""The database URL the research lane connects with, validated once at the boundary."""

import os

from research.errors import ConfigurationError

_DRIVER_PREFIXES = ("postgres://", "postgresql://")


def sqlalchemy_url(raw: str) -> str:
    """A libpq-style URL (`postgres://...`, as `.env.local` spells it) in SQLAlchemy's psycopg 3 form."""
    for prefix in _DRIVER_PREFIXES:
        if raw.startswith(prefix):
            return "postgresql+psycopg://" + raw[len(prefix) :]
    if raw.startswith("postgresql+psycopg://"):
        return raw
    raise ConfigurationError("a database URL must be postgres:// or postgresql://.")


def database_url_from_env(variable: str = "RESEARCH_DATABASE_URL") -> str:
    """The URL in `variable`, in SQLAlchemy form. Fails fast, naming the variable and never the value."""
    raw = os.environ.get(variable, "").strip()
    if raw == "":
        raise ConfigurationError(f"{variable} is not set.")
    return sqlalchemy_url(raw)
