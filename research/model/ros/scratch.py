"""THE ROUND'S SCRATCH COPY: an explicit local URL, never Neon, and the house's own ingests that
bring the judgment season up to what a live season holds.

The dev copy holds 2025 only from play-by-play, with no injury filings and no week-one roster. The
round adds them to its scratch copy through the house's ingests (`ingest_season`, the injury filings,
the week-one roster), exactly as the history rebuild calls them.
"""

from datetime import datetime
from typing import Final
from urllib.parse import urlparse

from sqlalchemy import Engine

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


def scratch_engine(url: str) -> Engine:
    """An engine on a local database; a Neon host, or any remote host, is refused."""
    host = urlparse(url).hostname or ""
    if "neon" in host or host not in LOCAL_HOSTS:
        raise ConfigurationError(f"the rest-of-season round runs on a local scratch copy, never on {host!r}")
    return make_engine(sqlalchemy_url(url))


def ingest_week_one_rosters(url: str, seasons: list[int], now: datetime) -> list[str]:
    """The house's week-one roster ingest (`ingest_week1_rosters`) for `seasons`, into `url`."""
    engine = scratch_engine(url)
    client = NflverseClient(LiveFetcher())
    lines: list[str] = []
    with engine.begin() as conn:
        for season in seasons:
            roster = ingest_week1_rosters(conn, client, season, now)
            lines.append(f"week-one roster {season}: {roster.written} written of {roster.entries_read} ({roster.mode})")
    engine.dispose()
    for line in lines:
        log_line(line)
    return lines


def ingest_judgment_season(url: str, season: int, now: datetime) -> list[str]:
    """Published weekly stats, injury filings and the week-one roster of `season`, into `url`."""
    engine = scratch_engine(url)
    client = NflverseClient(LiveFetcher())
    lines: list[str] = []
    with engine.begin() as conn:
        universe = ingest.ingest_player_universe(conn, client)
        stamps = ingest.schedule_week_as_of(client, [season])
        lines.append(f"stats {season}: {ingest.ingest_season(conn, client, universe, season, stamps.get(season))}")
        filings = ingest_injury_reports(conn, client, [season])
        lines.append(f"injury filings {season}: {sum(r.observations_written for r in filings)} observations")
        roster = ingest_week1_rosters(conn, client, season, now)
        lines.append(f"week-one roster {season}: {roster.written} written of {roster.entries_read} ({roster.mode})")
    engine.dispose()
    for line in lines:
        log_line(line)
    return lines
