"""The charted feeds' history command: each feed from its first published season, each one durable."""

import argparse
from datetime import UTC, datetime
from typing import cast

import pytest
from sqlalchemy import Connection

from research.pipeline import commands
from research.pipeline.http import Fetcher
from research.pipeline.nflverse import ingest, usage_feeds
from research.pipeline.nflverse.usage_feeds import FeedReport


def test_each_feed_runs_from_its_first_season(monkeypatch: pytest.MonkeyPatch) -> None:
    ran: list[tuple[str, int]] = []

    def feed(name: str) -> object:
        def run(conn: Connection, client: object, season: int, *rest: object) -> FeedReport:
            ran.append((name, season))
            return FeedReport(name, season, 1, 1, 1, (), ())

        return run

    monkeypatch.setattr(ingest, "schedule_week_as_of", lambda client, seasons: {})
    monkeypatch.setattr(usage_feeds, "ingest_next_gen_stats", feed("ngs"))
    monkeypatch.setattr(usage_feeds, "ingest_pfr_advstats", feed("pfr"))
    checkpoints: list[int] = []
    invocation = commands.Invocation(
        cast(Fetcher, None),
        argparse.Namespace(first=2015, last=2018),
        lambda: checkpoints.append(1),
        datetime(2026, 10, 16, tzinfo=UTC),
        {},
    )
    lines = commands.COMMANDS["charted-history"].run(cast(Connection, None), invocation)
    assert ran == [("ngs", 2016), ("ngs", 2017), ("ngs", 2018), ("pfr", 2018)]
    assert len(checkpoints) == len(ran) == len(cast(list[str], lines))
