"""Who is out, beside the published board (Lane 63).

The code table and the rule are pinned against the API's own file. The reads, the files and the table
run against a migrated scratch database and need PARITY_DATABASE_URL (skipped without it, run by CI).
"""

import json
import os
import shutil
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import pytest
from sqlalchemy import Engine, insert, select

from research.db.engine import make_engine
from research.db.schema import PUBLISHED_BOARDS
from research.db.schema.provider import CAPTURE_CHECKS, CAPTURE_SNAPSHOTS
from research.db.schema.published import PUBLISHED_STATUSES
from research.db.url import sqlalchemy_url
from research.model.designations import CODES, OUT_FOR_THE_SEASON, SEASON_LONG, season_long, status_of
from research.nightly.config import EARLY_KEY, LATEST_KEY
from research.nightly.designations import (
    BUILD_FILE,
    DESIGNATIONS_FILE,
    Hour,
    Marked,
    PlayerStatus,
    StatusRead,
    build_on_change,
    designations_file,
    finish_marks,
    mark_public_runs,
    read_statuses,
    season_ids,
)
from research.nightly.publish import PublishOutcome, encode
from research.nightly.published_board import sync_published_board
from research.nightly.run_store import JSON_TYPE, LocalRunStore
from research.parity import databases
from research.pipeline.tank01.capture import FeedOutcome, record_checks

_CODES = Path(__file__).resolve().parents[2] / "api" / "testdata" / "designation-codes.json"
_FIXTURE = Path(__file__).resolve().parents[1] / "nightly" / "contract" / "fixture"
_PRESEASON = "2026-10-13T21-2"
_IN_SEASON = "2026-10-21T12-ros"
_GIBBS, _ALLEN, _JACOBS = "4429795", "3918298", "4047365"
_NOW = datetime(2026, 10, 21, 13, 30, tzinfo=UTC)
_DATABASE = "parity_test_designations"
Json = dict[str, Any]


def test_the_code_table_and_the_rule_are_the_apis() -> None:
    shared = json.loads(_CODES.read_text())
    # The table's own vocabulary is the codes' statuses, no more and no fewer.
    assert sorted(PUBLISHED_STATUSES) == sorted(set(shared["codes"].values()))
    assert dict(CODES) == shared["codes"]
    assert sorted(SEASON_LONG) == sorted(shared["season_long"])
    assert shared["out_for_the_season"] == OUT_FOR_THE_SEASON
    assert status_of(" ir-r ") == "injured_reserve"
    assert status_of("X") is None


@pytest.mark.parametrize(
    ("status", "note", "expected"),
    [
        ("injured_reserve", None, True),
        ("nfi", None, True),
        ("out", "Out for the season (knee)", True),
        ("out", "Out this week (ankle)", False),
        ("doubtful", "out for the season", False),
        ("questionable", None, False),
    ],
)
def test_season_long(status: str, note: str | None, expected: bool) -> None:
    assert season_long(status, note) is expected


def test_the_file_holds_only_ranked_players_with_their_dates() -> None:
    since = datetime(2026, 10, 14, 15, 0, tzinfo=UTC)
    read = StatusRead(
        datetime(2026, 10, 21, 13, 5, tzinfo=UTC),
        datetime(2026, 10, 21, 14, 0, tzinfo=UTC),
        "tank01_injuries_by_date",
        {
            _GIBBS: PlayerStatus("injured_reserve", True, since),
            _ALLEN: PlayerStatus("doubtful", False, None),
            "unranked": PlayerStatus("injured_reserve", True, None),
        },
    )
    file = designations_file(read, [_GIBBS, _ALLEN, _JACOBS])
    assert file == {
        "readAt": "2026-10-21T13:05:00.000Z",
        "checkedAt": "2026-10-21T14:00:00.000Z",
        "source": "tank01_injuries_by_date",
        "players": {
            _ALLEN: {"status": "doubtful", "seasonLong": False, "since": None},
            _GIBBS: {"status": "injured_reserve", "seasonLong": True, "since": "2026-10-14T15:00:00.000Z"},
        },
    }
    assert season_ids(file) == frozenset({_GIBBS})


class _Dispatcher:
    def __init__(self, failure: str | None = None) -> None:
        self.failure = failure
        self.calls: list[str] = []

    def dispatch(self, run_id: str) -> str | None:
        self.calls.append(run_id)
        return self.failure


@pytest.fixture
def store(tmp_path: Path) -> LocalRunStore:
    shutil.copytree(_FIXTURE / "runs", tmp_path / "runs")
    return LocalRunStore(tmp_path)


def _marked(ids: frozenset[str]) -> Marked:
    read = StatusRead(
        _NOW, None, "tank01_injuries_by_date", {i: PlayerStatus("injured_reserve", True, None) for i in ids}
    )
    return Marked(read, {_IN_SEASON: ids}, {_IN_SEASON: 2026}, "marked")


def _hour(dispatcher: object, dispatched: bool = False) -> Hour:
    published = PublishOutcome(_IN_SEASON, "publish", True, dispatched=dispatched)
    return Hour(dispatcher, published, _NOW, sleep=lambda _seconds: None)  # type: ignore[arg-type]


def test_the_build_is_dispatched_only_when_the_season_long_players_move(store: LocalRunStore) -> None:
    store.put(LATEST_KEY, encode({"runId": _IN_SEASON}), JSON_TYPE)
    dispatcher = _Dispatcher()
    moved = build_on_change(store, _marked(frozenset({_GIBBS})), _hour(dispatcher))
    assert moved.line == f"designations: run {_IN_SEASON}, 1 season-long, moved; the web build of it was dispatched"
    assert dispatcher.calls == [_IN_SEASON]
    again = build_on_change(store, _marked(frozenset({_GIBBS})), _hour(dispatcher))
    assert again.line == f"designations: run {_IN_SEASON}, 1 season-long, unchanged since its last build"
    assert dispatcher.calls == [_IN_SEASON]
    # A dispatch refused three times in the hour keeps the old set, so the next hour tries again.
    failing = _Dispatcher("HTTP 500 down")
    failed = build_on_change(store, _marked(frozenset()), _hour(failing))
    assert not failed.ok and "the dispatch FAILED 3 attempts (HTTP 500 down); retried next hour" in failed.line
    retried = build_on_change(store, _marked(frozenset()), _hour(dispatcher))
    assert retried.ok and dispatcher.calls == [_IN_SEASON, _IN_SEASON]


def test_the_runs_own_build_and_a_missing_token_record_the_set(store: LocalRunStore) -> None:
    store.put(LATEST_KEY, encode({"runId": _IN_SEASON}), JSON_TYPE)
    own = build_on_change(store, _marked(frozenset({_GIBBS})), _hour(_Dispatcher(), dispatched=True))
    assert own.line == f"designations: run {_IN_SEASON}, 1 season-long, in the build publish dispatched"
    skipped = build_on_change(store, _marked(frozenset({_GIBBS, _ALLEN})), _hour("WEB_DISPATCH_TOKEN is not set"))
    assert skipped.ok and "the web dispatch skipped (WEB_DISPATCH_TOKEN is not set)" in skipped.line
    record = json.loads(store.get(f"runs/{_IN_SEASON}/{BUILD_FILE}") or b"{}")
    assert record["seasonLong"] == sorted([_GIBBS, _ALLEN])


def test_without_a_store_the_marking_is_skipped_by_name(store: LocalRunStore) -> None:
    marked = mark_public_runs(None, store, _NOW)
    assert marked.ok and marked.line == "designations: skipped, no store to read the injury capture from"
    assert finish_marks(None, store, marked, _hour(None)) == []


# THE READS AND THE TABLE, against a migrated scratch database.


@pytest.fixture(scope="module")
def engine() -> Any:
    if "PARITY_DATABASE_URL" not in os.environ:
        pytest.skip("needs a Postgres for scratch databases")
    url = databases.build_with_alembic(_DATABASE)
    built = make_engine(sqlalchemy_url(url))
    try:
        yield built
    finally:
        built.dispose()
        databases.drop(_DATABASE)


def _captures(engine: Engine, *captures: tuple[str, object, str]) -> None:
    with engine.begin() as conn:
        conn.execute(CAPTURE_SNAPSHOTS.delete())
        conn.execute(CAPTURE_CHECKS.delete())
        if not captures:
            return
        conn.execute(
            insert(CAPTURE_SNAPSHOTS),
            [
                {"source": source, "payload": payload, "captured_at": datetime.fromisoformat(at), "digest": at}
                for source, payload, at in captures
            ],
        )


def _listed(*entries: tuple[str, str]) -> Json:
    return {"injList": [{"playerID": player_id, "designation": code} for player_id, code in entries]}


_BY_DATE = "tank01_injuries_by_date"


def test_the_read_dates_a_season_long_run_as_the_api_does(engine: Engine) -> None:
    _captures(
        engine,
        (_BY_DATE, _listed(("p5", "Q")), "2026-07-01T10:00:00+00:00"),
        (_BY_DATE, _listed(("p1", "Q"), ("p5", "IR")), "2026-10-13T10:00:00+00:00"),
        (_BY_DATE, _listed(("p1", "IR"), ("p2", "IR"), ("p5", "IR")), "2026-10-13T11:00:00+00:00"),
        (_BY_DATE, _listed(("p1", "IR"), ("p2", "IR"), ("p3", "PUP"), ("p5", "IR")), "2026-10-13T12:00:00+00:00"),
        (_BY_DATE, [1, 2], "2026-10-13T13:00:00+00:00"),
        (
            _BY_DATE,
            _listed(("p1", "IR-R"), ("p2", "ir"), ("p3", "PUP"), ("p4", "O"), ("p5", "IR"), ("p6", "X")),
            "2026-10-13T14:00:00+00:00",
        ),
    )
    with engine.connect() as conn:
        read = read_statuses(conn, now=_NOW)
    assert read is not None
    assert (read.read_at, read.source) == (datetime(2026, 10, 13, 14, tzinfo=UTC), _BY_DATE)

    def at(hour: int) -> datetime:
        return datetime(2026, 10, 13, hour, tzinfo=UTC)

    assert dict(read.players) == {
        "p1": PlayerStatus("injured_reserve", True, at(11)),
        "p2": PlayerStatus("injured_reserve", True, at(11)),
        "p3": PlayerStatus("pup", True, at(12)),
        "p4": PlayerStatus("out", False, None),
        # His run reaches the oldest capture in the window: we do not know when it began.
        "p5": PlayerStatus("injured_reserve", True, None),
    }


def test_the_sweep_stands_in_with_its_note(engine: Engine) -> None:
    sweep = [{"roster": [{"playerID": "p1", "injury": {"designation": "O", "description": "Out for the season"}}]}]
    _captures(engine, ("tank01_injuries", sweep, "2026-10-13T10:00:00+00:00"))
    with engine.connect() as conn:
        read = read_statuses(conn, now=_NOW)
    assert read is not None and dict(read.players) == {"p1": PlayerStatus("out", True, None)}
    _captures(engine)
    with engine.connect() as conn:
        assert read_statuses(conn, now=_NOW) is None


def test_a_publish_hour_writes_the_file_marks_the_table_and_builds_once(engine: Engine, store: LocalRunStore) -> None:
    _captures(
        engine,
        (_BY_DATE, _listed((_ALLEN, "Q")), "2026-10-21T10:00:00+00:00"),
        (_BY_DATE, _listed((_GIBBS, "IR"), (_ALLEN, "D"), ("unranked", "IR")), "2026-10-21T11:00:00+00:00"),
    )
    store.put(LATEST_KEY, encode({"runId": _PRESEASON}), JSON_TYPE)
    store.put(EARLY_KEY, encode({"runId": _IN_SEASON, "publicAt": "2026-10-21T13:00:00.000Z"}), JSON_TYPE)
    marked = mark_public_runs(engine, store, _NOW)
    assert marked.ok, marked.line
    for run_id in (_PRESEASON, _IN_SEASON):
        file = json.loads(store.get(f"runs/{run_id}/{DESIGNATIONS_FILE}") or b"{}")
        assert file["players"] == {
            _ALLEN: {"status": "doubtful", "seasonLong": False, "since": None},
            _GIBBS: {"status": "injured_reserve", "seasonLong": True, "since": "2026-10-21T11:00:00.000Z"},
        }
    # The early run went public this hour and publish dispatched its build.
    store.put(LATEST_KEY, encode({"runId": _IN_SEASON}), JSON_TYPE)
    assert sync_published_board(engine, store, _NOW).ok
    dispatcher = _Dispatcher()
    steps = finish_marks(engine, store, marked, _hour(dispatcher, dispatched=True))
    assert [s.ok for s in steps] == [True, True], [s.line for s in steps]
    assert dispatcher.calls == []
    with engine.connect() as conn:
        rows = conn.execute(
            select(PUBLISHED_BOARDS.c.player_id, PUBLISHED_BOARDS.c.status, PUBLISHED_BOARDS.c.status_since)
            .where(PUBLISHED_BOARDS.c.status.is_not(None))
            .distinct()
            .order_by(PUBLISHED_BOARDS.c.player_id)
        ).all()
    assert [tuple(r) for r in rows] == [
        (_ALLEN, "doubtful", None),
        (_GIBBS, "injured_reserve", datetime(2026, 10, 21, 11, tzinfo=UTC)),
    ]
    # The next hour, the same capture: nothing to build.
    again = finish_marks(engine, store, mark_public_runs(engine, store, _NOW), _hour(dispatcher))
    assert "unchanged since its last build" in again[-1].line and dispatcher.calls == []


def test_an_empty_or_cut_short_list_gives_way_and_a_real_drop_reads_on_the_next(engine: Engine) -> None:
    full = _listed(("p1", "IR"), ("p2", "Q"), ("p3", "Q"), ("p4", "Q"))
    _captures(
        engine,
        (_BY_DATE, full, "2026-10-13T10:00:00+00:00"),
        (_BY_DATE, {"injList": []}, "2026-10-13T11:00:00+00:00"),
        (_BY_DATE, _listed(("p3", "Q")), "2026-10-13T12:00:00+00:00"),
    )
    with engine.begin() as conn:
        record_checks(conn, [FeedOutcome(_BY_DATE, "captured", 1)], datetime(2026, 10, 13, 12, tzinfo=UTC))
    with engine.connect() as conn:
        read = read_statuses(conn, now=_NOW)
    assert read is not None and read.read_at == datetime(2026, 10, 13, 10, tzinfo=UTC)
    assert read.players["p1"] == PlayerStatus("injured_reserve", True, None)
    # The 12:00 check returned the refused list, so it never vouches for the 10:00 one shown.
    assert read.checked_at is None
    # A second short list: the drop is real, and the lapsed injured reserve is gone.
    with engine.begin() as conn:
        conn.execute(
            insert(CAPTURE_SNAPSHOTS),
            [
                {
                    "source": _BY_DATE,
                    "payload": _listed(("p3", "D")),
                    "digest": "d",
                    "captured_at": datetime(2026, 10, 13, 13, tzinfo=UTC),
                }
            ],
        )
    with engine.begin() as conn:
        record_checks(conn, [FeedOutcome(_BY_DATE, "captured", 1)], datetime(2026, 10, 13, 13, tzinfo=UTC))
    with engine.connect() as conn:
        read = read_statuses(conn, now=_NOW)
    assert read is not None and dict(read.players) == {"p3": PlayerStatus("doubtful", False, None)}
    assert read.checked_at == datetime(2026, 10, 13, 13, tzinfo=UTC)


def test_the_checks_ride_on_the_read_and_an_out_takes_a_nearby_sweeps_note(engine: Engine) -> None:
    sweep = [{"roster": [{"playerID": "p2", "injury": {"designation": "O", "description": "Out for the season"}}]}]
    _captures(
        engine,
        ("tank01_injuries", sweep, "2026-10-12T20:00:00+00:00"),
        (_BY_DATE, _listed(("p1", "Q"), ("p2", "O")), "2026-10-13T10:00:00+00:00"),
    )
    checked = datetime(2026, 10, 13, 15, tzinfo=UTC)
    with engine.begin() as conn:
        record_checks(conn, [FeedOutcome(_BY_DATE, "unchanged", 1), FeedOutcome("tank01_news", "failed", 1)], checked)
        # An older pass never moves the check back.
        record_checks(conn, [FeedOutcome(_BY_DATE, "captured", 1)], checked.replace(hour=12))
    with engine.connect() as conn:
        read = read_statuses(conn, now=_NOW)
        assert conn.execute(select(CAPTURE_CHECKS.c.source)).scalars().all() == [_BY_DATE]
    assert read is not None and read.checked_at == checked
    assert read.players["p2"] == PlayerStatus("out", True, None)


def test_a_lapsed_designation_clears_from_the_file_and_the_table(engine: Engine, store: LocalRunStore) -> None:
    store.put(LATEST_KEY, encode({"runId": _IN_SEASON}), JSON_TYPE)
    assert sync_published_board(engine, store, _NOW).ok
    _captures(engine, (_BY_DATE, _listed((_GIBBS, "IR"), (_ALLEN, "Q")), "2026-10-21T10:00:00+00:00"))
    first = mark_public_runs(engine, store, _NOW)
    finish_marks(engine, store, first, _hour(None))
    _captures(
        engine,
        (_BY_DATE, _listed((_GIBBS, "IR"), (_ALLEN, "Q")), "2026-10-21T10:00:00+00:00"),
        (_BY_DATE, _listed((_ALLEN, "Q"), ("x1", "Q")), "2026-10-21T11:00:00+00:00"),
    )
    second = mark_public_runs(engine, store, _NOW)
    steps = finish_marks(engine, store, second, _hour(None))
    file = json.loads(store.get(f"runs/{_IN_SEASON}/{DESIGNATIONS_FILE}") or b"{}")
    assert list(file["players"]) == [_ALLEN]
    with engine.connect() as conn:
        marked = (
            conn.execute(select(PUBLISHED_BOARDS.c.player_id).where(PUBLISHED_BOARDS.c.status.is_not(None)).distinct())
            .scalars()
            .all()
        )
    assert marked == [_ALLEN]
    assert "moved" in steps[-1].line
