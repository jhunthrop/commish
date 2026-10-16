"""The weekly pass's usage steps: their place in the pass, their verdicts, and the play-by-play
stream's dropback count against the real week-1 rows in `testdata/nflverse/`."""

import gzip
from collections import Counter
from collections.abc import Iterator, Sequence
from contextlib import contextmanager
from datetime import UTC, datetime
from typing import cast

import pytest
from sqlalchemy import Connection, Engine

from research.inseason import usage_steps
from research.inseason.season_week import STEPS, SeasonWeekContext, run_season_week, run_usage_backfill
from research.inseason.step_result import StepResult
from research.pipeline.http import Fetcher
from research.pipeline.kickoffs import TeamKickoff
from research.pipeline.nflverse import context, depth_chart_weeks, usage_feeds
from research.pipeline.nflverse import ingest as nflverse_ingest
from research.pipeline.nflverse.client import NflverseClient, NflverseError
from research.pipeline.nflverse.pbp_passers import PBP_PASSER_SOURCE, PasserDropbacks, PasserMetric
from research.pipeline.nflverse.pbp_plays import PlayRows
from research.pipeline.observations import PlayerWeekObservation, TeamWeekObservation
from research.tests.nflverse_fixtures import TESTDATA, FixtureFetcher, fixture_rows

_SEASON = 2026


class _Conn:
    def commit(self) -> None:
        return None


class _FakeEngine:
    @contextmanager
    def connect(self) -> Iterator[Connection]:
        yield cast(Connection, _Conn())


def _context(fetcher: Fetcher, skip: frozenset[str] = frozenset(), season: int = _SEASON) -> SeasonWeekContext:
    engine = cast(Engine, _FakeEngine())
    return SeasonWeekContext(engine, fetcher, datetime(2026, 10, 14, tzinfo=UTC), season, {}, skip)


@pytest.fixture
def written(monkeypatch: pytest.MonkeyPatch) -> list[PlayerWeekObservation]:
    rows: list[PlayerWeekObservation] = []

    def record(conn: Connection, batch: Sequence[PlayerWeekObservation]) -> int:
        del conn
        rows.extend(batch)
        return len(batch)

    def record_team(conn: Connection, batch: Sequence[TeamWeekObservation]) -> int:
        del conn
        return len(batch)

    pbp = fixture_rows("play_by_play_2026.csv.gz")
    universe = {r[c]: "QB" for r in pbp for c in ("passer_id", "receiver_player_id", "rusher_player_id") if r[c]}
    for module in (context, usage_feeds):
        monkeypatch.setattr(module, "all_positions", lambda conn: universe)
        monkeypatch.setattr(module, "record_observations", record)
    monkeypatch.setattr(context, "record_team_observations", record_team)
    monkeypatch.setattr(context, "record_plays", lambda conn, plays: len(plays))
    kickoff = TeamKickoff(2027, 1, "KC", datetime(2027, 9, 10, tzinfo=UTC))
    monkeypatch.setattr(depth_chart_weeks, "stored_kickoffs", lambda conn, season: [kickoff])
    monkeypatch.setattr(usage_feeds, "pfr_players", lambda conn: {})
    return rows


def test_the_usage_steps_run_after_the_stats_and_before_the_register() -> None:
    assert STEPS[: 1 + len(usage_steps.USAGE_STEPS)] == ("stats-ingest", *usage_steps.USAGE_STEPS)
    assert STEPS[-4:] == ("props-snapshot", "grade", "freeze", "scoreboard")


def test_play_by_play_counts_every_passers_dropbacks_in_the_same_stream(written: list[PlayerWeekObservation]) -> None:
    fetcher = FixtureFetcher({"play_by_play_2026.csv": _gunzipped("play_by_play_2026.csv.gz")})
    report = context.ingest_play_by_play(
        cast(Connection, None), NflverseClient(fetcher), _SEASON, passers=PasserDropbacks()
    )
    expected = Counter(
        r["passer_id"] for r in fixture_rows("play_by_play_2026.csv.gz")
        if r["qb_dropback"] == "1" and r["two_point_attempt"] != "1" and r["passer_id"]
    )  # fmt: skip
    dropbacks = {r.player_id: r.value for r in written if r.source == PBP_PASSER_SOURCE}
    assert dropbacks == {passer: float(n) for passer, n in expected.items()}
    assert all(r.metric == PasserMetric.DROPBACKS for r in written if r.source == PBP_PASSER_SOURCE)
    assert report.passer_weeks == len(expected)
    assert fetcher.requested == ["play_by_play_2026.csv"]


def test_without_a_passer_counter_the_history_pass_writes_what_it_always_wrote(
    written: list[PlayerWeekObservation],
) -> None:
    fetcher = FixtureFetcher({"play_by_play_2026.csv": _gunzipped("play_by_play_2026.csv.gz")})
    report = context.ingest_play_by_play(cast(Connection, None), NflverseClient(fetcher), _SEASON)
    assert not any(r.source == PBP_PASSER_SOURCE for r in written)
    assert report.passer_weeks == 0


def test_an_unpublished_season_skips_every_usage_step(
    written: list[PlayerWeekObservation], monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(nflverse_ingest, "schedule_week_as_of", lambda client, seasons: {2027: {}})
    results = run_usage_backfill(_context(FixtureFetcher(), season=2027))
    assert [r.step for r in results] == list(usage_steps.USAGE_STEPS)
    assert all(r.status == "skipped" for r in results), results
    assert all("has not published" in r.summary and "for 2027" in r.summary for r in results)
    assert written == []


def test_a_schedule_the_stamps_need_is_a_failure_not_an_unpublished_feed(written: list[PlayerWeekObservation]) -> None:
    with pytest.raises(NflverseError, match="the schedule could not be read") as raised:
        usage_steps.next_gen_stats(cast(Engine, _FakeEngine()), FixtureFetcher(), _SEASON)
    assert raised.value.kind == "upstream"


def test_a_failing_feed_is_its_own_line_and_the_pass_carries_on(monkeypatch: pytest.MonkeyPatch) -> None:
    ran: list[str] = []

    def runs(name: str) -> usage_steps.UsageStep:
        def body(engine: Engine, fetcher: Fetcher, season: int) -> StepResult:
            ran.append(name)
            return StepResult(name, "ok", "wrote")

        return body

    def broken(engine: Engine, fetcher: Fetcher, season: int) -> StepResult:
        raise RuntimeError("nflverse answered 500")

    for name in usage_steps.USAGE_STEPS:
        monkeypatch.setitem(usage_steps.BODIES, name, broken if name == "ftn-charting" else runs(name))
    skip = frozenset(STEPS) - set(usage_steps.USAGE_STEPS)
    results = run_season_week(_context(cast(Fetcher, None), skip))
    statuses = {r.step: r.status for r in results}
    assert statuses["ftn-charting"] == "failed"
    assert ran == ["play-by-play", "next-gen-stats", "pfr-advstats", "depth-charts"]
    assert all(statuses[s] == "skipped" for s in skip)


def test_the_weekly_pass_reads_the_gzipped_play_by_play(written: list[PlayerWeekObservation]) -> None:
    fetcher = FixtureFetcher()
    result = usage_steps.play_by_play(cast(Engine, _FakeEngine()), fetcher, _SEASON)
    assert fetcher.requested == ["play_by_play_2026.csv.gz"]
    assert result.status == "ok"
    assert any(r.source == PBP_PASSER_SOURCE for r in written)


def test_the_weekly_pass_keeps_the_plays_for_the_play_table(written: list[PlayerWeekObservation]) -> None:
    plays = PlayRows()
    report = context.ingest_play_by_play(
        cast(Connection, None), NflverseClient(FixtureFetcher()), _SEASON, play_rows=plays, compressed=True
    )
    expected = [r for r in fixture_rows("play_by_play_2026.csv.gz") if r["season_type"] == "REG" and r["play_type"]]
    assert report.plays_written == len(plays.rows) == len(expected)
    assert {(r["game_id"], r["play_id"]) for r in plays.rows} == {(r["game_id"], int(r["play_id"])) for r in expected}
    result = usage_steps.play_by_play(cast(Engine, _FakeEngine()), FixtureFetcher(), _SEASON)
    assert f"{len(expected)} new plays in the play table" in result.summary


def test_a_landed_week_is_skipped_with_nothing_new(monkeypatch: pytest.MonkeyPatch) -> None:
    report = usage_feeds.FeedReport("pfr-advstats", _SEASON, 40, 0, 12, (), ("pass: 40 rows",))
    monkeypatch.setattr(usage_feeds, "ingest_pfr_advstats", lambda conn, client, season: report)
    result = usage_steps.pfr_advstats(cast(Engine, _FakeEngine()), cast(Fetcher, None), _SEASON)
    assert result.status == "skipped"
    assert result.summary.startswith("nothing new, 0 new observations for 2026")


def _gunzipped(name: str) -> bytes:
    return gzip.decompress((TESTDATA / name).read_bytes())
