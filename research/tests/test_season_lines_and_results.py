"""A season's stat lines and its game results land together (Lane 66s, Lane 78): the operator's
`season` command wrote the lines without the results, so dev held week 6 lines for SEA at DEN and no
result. Both the command and the weekly pass's stats step now ingest the two as one unit and commit
after both, so a store holds both or neither."""

import argparse
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import UTC, datetime
from typing import cast

import pytest
from sqlalchemy import Connection, Engine

from research.inseason import season_week
from research.inseason.season_week import SeasonWeekContext
from research.pipeline import commands
from research.pipeline.http import Fetcher
from research.pipeline.nflverse import ingest, ingest_schedule
from research.pipeline.nflverse.ingest import SeasonIngestReport
from research.pipeline.nflverse.participation import SnapCountTally

_NOW = datetime(2026, 10, 19, tzinfo=UTC)
_RESULTS_FAIL = "games.csv answered 503"


def _report(season: int) -> SeasonIngestReport:
    return SeasonIngestReport(
        season=season,
        participation_rows=1,
        stat_lines=1,
        observations_written=1,
        participation_resolution=1.0,
        stat_line_resolution=1.0,
        unresolved=[],
        week_as_of={},
        player_week_unavailable=False,
        snap_counts_unavailable=False,
        player_team_edges=1,
        snap_counts=SnapCountTally(1, 1, 0, 0),
        snap_observations_written=1,
    )


def _record_writes(monkeypatch: pytest.MonkeyPatch, events: list[str], failing_results: int | None = None) -> None:
    def lines(conn: Connection, client: object, universe: object, season: int, *rest: object, **kw: object) -> object:
        events.append(f"lines {season}")
        return _report(season)

    def results(conn: Connection, client: object, seasons: list[int]) -> int:
        if seasons == [failing_results]:
            raise RuntimeError(_RESULTS_FAIL)
        events.append(f"results {','.join(str(s) for s in seasons)}")
        return 2

    monkeypatch.setattr(ingest, "ingest_player_universe", lambda conn, client: events.append("universe"))
    monkeypatch.setattr(ingest, "schedule_week_as_of", lambda client, seasons: {})
    monkeypatch.setattr(ingest, "ingest_season", lines)
    monkeypatch.setattr(ingest_schedule, "ingest_game_results", results)


def _run_season_command(events: list[str], first: int, last: int) -> object:
    invocation = commands.Invocation(
        cast(Fetcher, None),
        argparse.Namespace(first=first, last=last),
        lambda: events.append("commit"),
        _NOW,
        {},
    )
    return commands.COMMANDS["season"].run(cast(Connection, None), invocation)


def test_the_season_command_writes_each_seasons_lines_and_results_before_its_commit(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    events: list[str] = []
    _record_writes(monkeypatch, events)
    _run_season_command(events, 2024, 2025)
    assert events == [
        "universe",
        "commit",
        "lines 2024",
        "results 2024",
        "commit",
        "lines 2025",
        "results 2025",
        "commit",
    ]


def test_a_season_whose_results_fail_commits_neither(monkeypatch: pytest.MonkeyPatch) -> None:
    events: list[str] = []
    _record_writes(monkeypatch, events, failing_results=2025)
    with pytest.raises(RuntimeError, match=_RESULTS_FAIL):
        _run_season_command(events, 2024, 2025)
    # 2024 is durable with both; 2025's lines were written and never committed, so they roll back.
    assert events == ["universe", "commit", "lines 2024", "results 2024", "commit", "lines 2025"]


class _Conn:
    def __init__(self, events: list[str]) -> None:
        self.events = events

    def commit(self) -> None:
        self.events.append("commit")


class _Engine:
    def __init__(self, events: list[str]) -> None:
        self.events = events

    @contextmanager
    def connect(self) -> Iterator[Connection]:
        yield cast(Connection, _Conn(self.events))


def test_the_weekly_pass_writes_the_same_unit_and_commits_once_after_both(monkeypatch: pytest.MonkeyPatch) -> None:
    """The parity of the two doors: the weekly pass's stats step runs the season command's unit."""
    events: list[str] = []
    _record_writes(monkeypatch, events)
    context = SeasonWeekContext(cast(Engine, _Engine(events)), cast(Fetcher, None), _NOW, 2026, {})
    step = season_week.stats_ingest(context)
    assert step.status == "ok"
    assert events == ["universe", "commit", "lines 2026", "results 2026", "commit"]
    command_events: list[str] = []
    _record_writes(monkeypatch, command_events)
    _run_season_command(command_events, 2026, 2026)
    assert command_events == events
