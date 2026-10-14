"""THE ROUND'S SCRATCH COPY: an explicit local URL, never Neon, and the house's own ingests that
bring the judgment season up to what a live season holds.

The dev copy holds 2025 only from play-by-play, with no injury filings and no week-one roster. The
round adds them to its scratch copy through the house's ingests (`ingest_season`, the injury filings,
the week-one roster), exactly as the history rebuild calls them.
"""

from collections.abc import Callable
from datetime import datetime
from typing import Final
from urllib.parse import urlparse

from sqlalchemy import Connection, Engine

from research.cli import log_line
from research.db.engine import make_engine
from research.db.url import sqlalchemy_url
from research.errors import ConfigurationError
from research.pipeline.http import LiveFetcher
from research.pipeline.nflverse import ingest
from research.pipeline.nflverse.client import NflverseClient
from research.pipeline.nflverse.injury_reports import ingest_injury_reports
from research.pipeline.preseason.ingest import ingest_week1_rosters

LOCAL_HOSTS: Final = frozenset({"localhost", "127.0.0.1", "::1"})
SCRATCH_PORT: Final = 5433  # the local test server; dev is 5432 and is only read
SCRATCH_PREFIX: Final = "lane18_"
REFUSED_DATABASES: Final = frozenset({"commish", "commish_test"})  # dev's name, and the parity database


def check_scratch_url(url: str) -> None:
    """Refuse anything but a `lane18_` database on the local test server: a remote host, another
    port (dev's 5432 above all), or the dev and parity database names."""
    parsed = urlparse(url)
    host = parsed.hostname or ""
    if host not in LOCAL_HOSTS:
        raise ConfigurationError(f"the rest-of-season round runs on a local scratch copy, never on {host!r}")
    if parsed.port != SCRATCH_PORT:
        raise ConfigurationError(f"the scratch copy lives on port {SCRATCH_PORT}, not {parsed.port}")
    database = parsed.path.lstrip("/")
    if database in REFUSED_DATABASES or not database.startswith(SCRATCH_PREFIX):
        raise ConfigurationError(f"{database!r} is not a scratch copy: its name must start {SCRATCH_PREFIX!r}")


def scratch_engine(url: str) -> Engine:
    """An engine on the round's scratch copy (`check_scratch_url`)."""
    check_scratch_url(url)
    return make_engine(sqlalchemy_url(url))


DEV_PORT: Final = 5432
DEV_DATABASE: Final = "commish"
PARITY_DATABASE: Final = "commish_test"


def check_target_url(url: str) -> None:
    """The one-shot commands (the ingests and the fit) take any explicit URL, the production store
    through its proxy included, but never dev (read only) nor the parity database."""
    parsed = urlparse(url)
    database = parsed.path.lstrip("/")
    if database == PARITY_DATABASE:
        raise ConfigurationError("the parity database is the harness's, never a target")
    # No port is libpq's default, 5432: dev's.
    if (parsed.hostname or "") in LOCAL_HOSTS and parsed.port in (None, DEV_PORT) and database == DEV_DATABASE:
        raise ConfigurationError("dev on 5432 is only read")


def target_engine(url: str) -> Engine:
    """An engine on a one-shot command's named store (`check_target_url`)."""
    check_target_url(url)
    return make_engine(sqlalchemy_url(url))


def _ingest(url: str, body: Callable[[Connection, NflverseClient], list[str]]) -> list[str]:
    """One transaction on the named store; the engine is disposed whether or not the body raises."""
    engine = target_engine(url)
    try:
        with engine.begin() as conn:
            lines = body(conn, NflverseClient(LiveFetcher()))
    finally:
        engine.dispose()
    for line in lines:
        log_line(line)
    return lines


def _roster_line(conn: Connection, client: NflverseClient, season: int, now: datetime) -> str:
    roster = ingest_week1_rosters(conn, client, season, now)
    return f"week-one roster {season}: {roster.written} written of {roster.entries_read} ({roster.mode})"


def ingest_week_one_rosters(url: str, seasons: list[int], now: datetime) -> list[str]:
    """The house's week-one roster ingest (`ingest_week1_rosters`) for `seasons`, into `url`."""
    return _ingest(url, lambda conn, client: [_roster_line(conn, client, season, now) for season in seasons])


def _judgment_season(conn: Connection, client: NflverseClient, season: int, now: datetime) -> list[str]:
    universe = ingest.ingest_player_universe(conn, client)
    stamps = ingest.schedule_week_as_of(client, [season])
    stats = f"stats {season}: {ingest.ingest_season(conn, client, universe, season, stamps.get(season))}"
    filings = ingest_injury_reports(conn, client, [season])
    return [
        stats,
        f"injury filings {season}: {sum(r.observations_written for r in filings)} observations",
        _roster_line(conn, client, season, now),
    ]


def ingest_judgment_season(url: str, season: int, now: datetime) -> list[str]:
    """Published weekly stats, injury filings and the week-one roster of `season`, into `url`."""
    return _ingest(url, lambda conn, client: _judgment_season(conn, client, season, now))
