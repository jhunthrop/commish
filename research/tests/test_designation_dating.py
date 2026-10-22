"""The capture job dates the newest injury capture as the API does (Lane 134, B115).

One definition across the two lanes: the run read's text is the API's file, the version is derived from
the same inputs, and `api/testdata/designation-dating.json` (written by the API's
`TestTheDatingGolden`) pins the version, the digest and the runs' bytes for recorded captures. The
reads and the write run against a migrated scratch database and need PARITY_DATABASE_URL.
"""

import gzip
import json
import os
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import pytest
from sqlalchemy import Connection, Engine, insert, select, text

from research.capsules.facts.depth_reads import designations_in
from research.db.engine import make_engine
from research.db.schema.provider import CAPTURE_SNAPSHOTS
from research.db.url import sqlalchemy_url
from research.inseason import __main__ as inseason
from research.model.designations import CODES, status_of
from research.nightly.designation_dating import (
    DATINGS_KEPT,
    DATINGS_TABLE,
    RUNS_STATEMENT_TIMEOUT,
    DatingOutcome,
    date_newest_capture,
    dating_digest,
    encode_runs,
    go_instant,
)
from research.nightly.designation_runs import (
    BY_DATE_SOURCE,
    MAX_RUN_CAPTURES,
    RUN_WINDOW,
    RUNS_QUERY,
    RUNS_VERSION,
    designation_runs,
    runs_version_of,
)
from research.nightly.designations import newest_readable
from research.parity import databases

_API = Path(__file__).resolve().parents[2] / "api"
_GOLDEN = json.loads((_API / "testdata" / "designation-dating.json").read_text())
_CAPTURES_FILE = _API / "testdata" / "designation-dating-captures.json.gz"
_MIGRATION = _API / "migrations" / "00029_designation_datings.sql"
_DATABASE = "parity_test_designation_dating"
_NOW = datetime(2026, 10, 12, 6, 5, tzinfo=UTC)


def _recorded() -> list[dict[str, Any]]:
    with gzip.open(_CAPTURES_FILE, "rt", encoding="utf-8") as f:
        captures: list[dict[str, Any]] = json.load(f)
    return captures


def _golden_runs() -> dict[tuple[str, str], datetime]:
    return {(r["player"], r["status"]): datetime.fromisoformat(r["since"]) for r in _GOLDEN["runs"]}


def _golden_bytes() -> str:
    return json.dumps(_GOLDEN["runs"], separators=(",", ":"), ensure_ascii=False)


def test_the_run_read_is_the_apis_text() -> None:
    assert (_API / "internal" / "boards" / "designation_runs.sql").read_text() == RUNS_QUERY


def test_the_version_table_and_retention_are_the_pinned_ones() -> None:
    assert _GOLDEN["version"] == RUNS_VERSION
    assert _GOLDEN["table"] == DATINGS_TABLE
    assert timedelta(hours=_GOLDEN["kept_hours"]) == DATINGS_KEPT


def test_the_version_moves_with_each_input() -> None:
    base = runs_version_of(RUNS_QUERY, RUN_WINDOW, MAX_RUN_CAPTURES, CODES)
    assert base == RUNS_VERSION
    others = [
        runs_version_of(RUNS_QUERY + " ", RUN_WINDOW, MAX_RUN_CAPTURES, CODES),
        runs_version_of(RUNS_QUERY, RUN_WINDOW - timedelta(hours=1), MAX_RUN_CAPTURES, CODES),
        runs_version_of(RUNS_QUERY, RUN_WINDOW, MAX_RUN_CAPTURES + 1, CODES),
        runs_version_of(RUNS_QUERY, RUN_WINDOW, MAX_RUN_CAPTURES, {**CODES, "X": "out"}),
    ]
    assert base not in others


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        (datetime(2026, 10, 12, 6, 0, tzinfo=UTC), "2026-10-12T06:00:00Z"),
        (datetime(2026, 10, 12, 6, 0, 0, 123000, tzinfo=UTC), "2026-10-12T06:00:00.123Z"),
        (datetime(2026, 10, 12, 6, 0, 0, 120, tzinfo=UTC), "2026-10-12T06:00:00.00012Z"),
        (datetime(2026, 10, 12, 2, 0, 0, 500000, tzinfo=timezone(timedelta(hours=-4))), "2026-10-12T06:00:00.5Z"),
    ],
)
def test_an_instant_reads_as_go_formats_it(value: datetime, expected: str) -> None:
    assert go_instant(value) == expected


def test_the_recorded_capture_digests_as_the_api_digests_it() -> None:
    newest = max(_recorded(), key=lambda c: datetime.fromisoformat(c["captured_at"]))
    entries = designations_in(BY_DATE_SOURCE, newest["payload"])
    statuses = {player_id: status_of(e.designation) or "" for player_id, e in entries.items()}
    assert "" in statuses.values(), "the recording keeps a code we do not know, which digests as no status"
    assert dating_digest(datetime.fromisoformat(newest["captured_at"]), statuses) == _GOLDEN["digest"]
    assert go_instant(datetime.fromisoformat(newest["captured_at"])) == _GOLDEN["capture_at"]


def test_the_runs_encode_to_the_apis_bytes() -> None:
    assert encode_runs(_golden_runs()) == _golden_bytes()


# THE READ AND THE WRITE, against a migrated scratch database with the API's table.


@pytest.fixture(scope="module")
def engine() -> Iterator[Engine]:
    if "PARITY_DATABASE_URL" not in os.environ:
        pytest.skip("needs a Postgres for scratch databases")
    url = databases.build_with_alembic(_DATABASE)
    built = make_engine(sqlalchemy_url(url))
    up = _MIGRATION.read_text().split("-- +goose Up", 1)[1].split("-- +goose Down", 1)[0]
    with built.begin() as conn:
        conn.execute(text("create schema if not exists app"))
        conn.exec_driver_sql(up)
    try:
        yield built
    finally:
        built.dispose()
        databases.drop(_DATABASE)


@pytest.fixture
def recorded(engine: Engine) -> Engine:
    with engine.begin() as conn:
        conn.execute(CAPTURE_SNAPSHOTS.delete())
        conn.execute(text(f"delete from {DATINGS_TABLE}"))
        conn.execute(
            insert(CAPTURE_SNAPSHOTS),
            [
                {
                    "source": BY_DATE_SOURCE,
                    "payload": c["payload"],
                    "captured_at": datetime.fromisoformat(c["captured_at"]),
                    "digest": c["captured_at"],
                }
                for c in _recorded()
            ],
        )
    return engine


def test_the_job_reads_the_apis_capture_and_runs(recorded: Engine) -> None:
    with recorded.connect() as conn:
        readable = newest_readable(conn)
        assert readable is not None
        capture = readable.capture
        runs = designation_runs(conn, capture.at)
    assert go_instant(capture.at) == _GOLDEN["capture_at"]
    assert encode_runs(runs) == _golden_bytes()


def test_the_job_keeps_the_row_the_api_would_and_only_once(recorded: Engine) -> None:
    with recorded.begin() as conn:
        stale = {"digest": "0" * 64, "at": datetime(2026, 10, 10, 6, tzinfo=UTC)}
        conn.execute(
            text(f"insert into {DATINGS_TABLE} values (:digest, :at, '[]', :at)"),
            stale,
        )
        first = date_newest_capture(conn, _NOW)
        # The run read was bounded, for this transaction only.
        assert conn.execute(text("show statement_timeout")).scalar_one() == RUNS_STATEMENT_TIMEOUT
    with recorded.connect() as conn:
        assert conn.execute(text("show statement_timeout")).scalar_one() != RUNS_STATEMENT_TIMEOUT
    assert first.dated
    assert first.line.startswith("designation-dating: the capture of 2026-10-12T06:00:00.123Z dated, 100 runs read")
    assert first.line.endswith(f"kept in {DATINGS_TABLE} ({_GOLDEN['digest'][:12]})")
    with recorded.connect() as conn:
        rows = conn.execute(text(f"select capture_digest, capture_at, runs, dated_at from {DATINGS_TABLE}")).all()
    # The row is the API's, and a dating over two days older than it is gone.
    assert len(rows) == 1
    (row,) = rows
    assert row.capture_digest == _GOLDEN["digest"]
    assert go_instant(row.capture_at) == _GOLDEN["capture_at"]
    assert row.runs == _GOLDEN["runs"]
    assert row.dated_at == _NOW
    with recorded.begin() as conn:
        again = date_newest_capture(conn, _NOW + timedelta(hours=1))
    assert not again.dated
    assert again.line == (
        f"designation-dating: the capture of 2026-10-12T06:00:00.123Z is dated already ({_GOLDEN['digest'][:12]})"
    )


def test_with_no_capture_there_is_nothing_to_date(recorded: Engine) -> None:
    with recorded.begin() as conn:
        conn.execute(CAPTURE_SNAPSHOTS.delete())
        outcome = date_newest_capture(conn, _NOW)
    assert not outcome.dated and outcome.line == "designation-dating: no injury capture yet, nothing to date"


# THE HOURLY JOB'S SAVEPOINT (Lane 141, B116): the dating commits with the capture it dates, and a failed
# dating rolls back only itself.


def _later_capture(captured_at: datetime) -> dict[str, Any]:
    """The recording's newest capture again, an hour later: a new capture the job stores and dates."""
    newest = max(_recorded(), key=lambda c: datetime.fromisoformat(c["captured_at"]))
    return {
        "source": BY_DATE_SOURCE,
        "payload": newest["payload"],
        "captured_at": captured_at,
        "digest": captured_at.isoformat(),
    }


def _stored(engine: Engine, captured_at: datetime) -> tuple[bool, list[datetime]]:
    """Whether another connection sees the capture, and the captures it sees dated."""
    with engine.connect() as conn:
        capture = conn.execute(
            select(CAPTURE_SNAPSHOTS.c.captured_at).where(CAPTURE_SNAPSHOTS.c.captured_at == captured_at)
        ).first()
        dated = conn.execute(text(f"select capture_at from {DATINGS_TABLE} order by capture_at")).scalars().all()
    return capture is not None, list(dated)


_LATER = datetime(2026, 10, 12, 7, 0, 0, 123000, tzinfo=UTC)


def test_the_hourly_dating_commits_with_its_capture(recorded: Engine, capsys: pytest.CaptureFixture[str]) -> None:
    with recorded.begin() as conn:
        conn.execute(insert(CAPTURE_SNAPSHOTS), [_later_capture(_LATER)])
        # The capture is not committed yet: the dating reads it in the same transaction.
        assert inseason._date_designations(conn, _NOW)
        # Until the commit no other connection sees the capture or its dating: no API instance dates the
        # capture itself between two commits.
        assert _stored(recorded, _LATER) == (False, [])
    assert _stored(recorded, _LATER) == (True, [_LATER])
    assert "designation-dating: the capture of 2026-10-12T07:00:00.123Z dated" in capsys.readouterr().out


def test_a_refused_dating_rolls_back_only_itself(
    recorded: Engine, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    def refused(conn: Connection, _now: datetime) -> DatingOutcome:
        # A row the table refuses (its digest check) aborts the savepoint, never the capture.
        conn.execute(text(f"insert into {DATINGS_TABLE} values ('not a digest', now(), '[]', now())"))
        return DatingOutcome("never reached")

    monkeypatch.setattr(inseason, "date_newest_capture", refused)
    with recorded.begin() as conn:
        conn.execute(insert(CAPTURE_SNAPSHOTS), [_later_capture(_LATER)])
        assert inseason._date_designations(conn, _NOW)
        # The transaction goes on past the rolled back savepoint.
        assert conn.execute(text("select 1")).scalar_one() == 1
    assert _stored(recorded, _LATER) == (True, [])
    out = capsys.readouterr().out
    assert "designation-dating: FAILED, IntegrityError" in out and "the API dates the capture itself" in out
