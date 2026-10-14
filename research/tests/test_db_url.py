"""The database URL in both of its forms: TCP for dev and CI, the Cloud SQL socket for production.

Cloud Run mounts the instance's Unix socket at /cloudsql/<instance> (a directory whose name holds
colons), and RESEARCH_DATABASE_URL names it in the `host` parameter with no host in the authority.
"""

import pytest

from research.db.engine import make_engine
from research.db.url import database_url_from_env, sqlalchemy_url
from research.errors import ConfigurationError
from research.model.weekly.round.__main__ import _engine as weekly_round_engine

SOCKET_DIR = "/cloudsql/trycommish:us-east1:commish-pg"
SOCKET_URL = f"postgres://commish_research:s3cr%40t@/commish?host={SOCKET_DIR}"
TCP_URL = "postgres://commish:commish@localhost:5433/commish_test"


def _connect_args(url: str) -> dict[str, object]:
    engine = make_engine(sqlalchemy_url(url))
    try:
        _, kwargs = engine.dialect.create_connect_args(engine.url)
        return dict(kwargs)
    finally:
        engine.dispose()


def test_the_socket_form_reaches_psycopg_as_a_socket_directory() -> None:
    assert sqlalchemy_url(SOCKET_URL) == f"postgresql+psycopg://commish_research:s3cr%40t@/commish?host={SOCKET_DIR}"
    args = _connect_args(SOCKET_URL)
    # The whole directory, colons included, and no port: libpq dials <dir>/.s.PGSQL.5432.
    assert args["host"] == SOCKET_DIR
    assert "port" not in args
    assert (args["dbname"], args["user"], args["password"]) == ("commish", "commish_research", "s3cr@t")


def test_the_tcp_form_is_unchanged() -> None:
    args = _connect_args(TCP_URL)
    assert (args["host"], args["port"], args["dbname"]) == ("localhost", 5433, "commish_test")


def test_the_socket_form_reads_from_the_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("RESEARCH_DATABASE_URL", SOCKET_URL)
    assert database_url_from_env() == sqlalchemy_url(SOCKET_URL)


@pytest.mark.parametrize("url", [SOCKET_URL, "postgres://u:p@ep-x-pooler.us-east-1.aws.neon.tech/commish"])
def test_the_weekly_round_refuses_production(url: str) -> None:
    with pytest.raises(ConfigurationError, match="local copy"):
        weekly_round_engine(url)
