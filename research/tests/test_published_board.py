"""The published run's board as a table (Lane 28): the rows a run's artifacts give, and the swap.

The row tests read the web contract's two fixture runs (a preseason run and a week-7 rest-of-season
run) through a local run store laid out as the bucket. The table tests need PARITY_DATABASE_URL (a
server where the harness may create `parity_*` databases); skipped without it, and run by CI.
"""

import json
import os
import shutil
from dataclasses import replace
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import pytest
from sqlalchemy import Engine, select

from research.db.engine import make_engine
from research.db.schema import PUBLISHED_BOARDS
from research.db.url import sqlalchemy_url
from research.nightly.__main__ import main as nightly_main
from research.nightly.config import EARLY_KEY, LATEST_KEY, RUN_FORMATS
from research.nightly.publish import encode
from research.nightly.published_board import (
    PUBLISHED_FORMAT,
    PublishedBoardError,
    published_board,
    read_published_board,
    replace_published_board,
    sync_published_board,
)
from research.nightly.run_store import JSON_TYPE, LocalRunStore
from research.parity import databases

_FIXTURE = Path(__file__).resolve().parents[1] / "nightly" / "contract" / "fixture"
_PRESEASON = "2026-10-13T21-2"
_IN_SEASON = "2026-10-21T12-ros"
_NOW = datetime(2026, 10, 21, 13, 0, tzinfo=UTC)
_DATABASE = "parity_test_published_board"
_SEASON, _OTHER_SEASON = 2026, 2025
Json = dict[str, Any]


@pytest.fixture
def store(tmp_path: Path) -> LocalRunStore:
    shutil.copytree(_FIXTURE / "runs", tmp_path / "runs")
    return LocalRunStore(tmp_path)


def _artifact(run_id: str, path: str) -> Json:
    loaded: Json = json.loads((_FIXTURE / "runs" / run_id / path).read_text())
    return loaded


def test_every_run_format_names_a_table_format() -> None:
    assert {f.id: PUBLISHED_FORMAT[f.id] for f in RUN_FORMATS} == {
        "ppr-12": "ppr",
        "half-ppr-12": "half",
        "standard-12": "std",
        "superflex-12": "superflex",
    }


def test_a_preseason_run_publishes_its_boards_with_the_stored_generation_as_refreshed(store: LocalRunStore) -> None:
    board = read_published_board(store, _PRESEASON)
    assert (board.run_id, board.season) == (_PRESEASON, 2026)
    ppr = {r.player_id: r for r in board.rows if r.format == "ppr"}
    gibbs = ppr["4429795"]
    assert (gibbs.rank, gibbs.position_rank, gibbs.points) == (5, 1, 262.1)
    assert gibbs.points_over_replacement == pytest.approx(113.94)
    assert (gibbs.floor, gibbs.median, gibbs.ceiling) == pytest.approx((177.6178, 262.1017, 346.5856), abs=1e-4)
    assert {r.order_basis for r in board.rows} == {"preseason"}
    # The stored board generation the run printed (the manifest's boards source window).
    assert {r.refreshed for r in board.rows} == {datetime(2026, 9, 9, 2, 20, 29, 697000, tzinfo=UTC)}
    assert {r.format for r in board.rows} == {"ppr", "half", "std"}
    rows_in_files = sum(
        len(_artifact(_PRESEASON, f"boards/{f}.json")["rows"]) for f in ("ppr-12", "half-ppr-12", "standard-12")
    )
    assert len(board.rows) == rows_in_files


def test_a_rest_of_season_run_publishes_its_order_with_no_range(store: LocalRunStore) -> None:
    board = read_published_board(store, _IN_SEASON)
    ppr = {r.player_id: r for r in board.rows if r.format == "ppr"}
    gibbs = ppr["4429795"]
    assert (gibbs.rank, gibbs.position_rank) == (1, 1)
    assert gibbs.points == pytest.approx(242.5281, abs=1e-4)
    assert (gibbs.floor, gibbs.median, gibbs.ceiling) == (None, None, None)
    assert {r.order_basis for r in board.rows} == {"rest_of_season"}
    assert {r.refreshed for r in board.rows} == {datetime(2026, 10, 21, 12, 0, tzinfo=UTC)}


def test_a_superflex_board_is_published_under_its_own_format() -> None:
    manifest = _artifact(_PRESEASON, "manifest.json")
    ppr = _artifact(_PRESEASON, "boards/ppr-12.json")
    superflex_format = {**next(f for f in manifest["formats"] if f["id"] == "ppr-12"), "id": "superflex-12"}
    manifest = {**manifest, "formats": [*manifest["formats"], superflex_format]}
    boards = {f["id"]: _artifact(_PRESEASON, f"boards/{f['id']}.json") for f in manifest["formats"][:3]}
    boards["superflex-12"] = {**ppr, "format": "superflex-12"}
    board = published_board(_PRESEASON, manifest, boards)
    superflex = [r for r in board.rows if r.format == "superflex"]
    assert len(superflex) == len(ppr["rows"])
    # Superflex is the PPR board's points: its stored generation is the PPR board's.
    assert {r.refreshed for r in superflex} == {datetime(2026, 9, 9, 2, 20, 29, 697000, tzinfo=UTC)}


@pytest.mark.parametrize(
    ("change", "message"),
    [
        (lambda m, b: (m, {**b, "ppr-12": {**b["ppr-12"], "format": "half-ppr-12"}}), "names format half-ppr-12"),
        (lambda m, b: (m, {k: v for k, v in b.items() if k != "half-ppr-12"}), "no board half-ppr-12"),
        (lambda m, b: ({**m, "formats": [*m["formats"], {"id": "two-qb-10"}]}, b), "no format two-qb-10"),
        (lambda m, b: (m, _with_row(b, {"ourRank": 0})), "ourRank"),
        (lambda m, b: (m, _with_row(b, {"projected": "262"})), "projected"),
        (lambda m, b: (m, _with_row(b, {"id": b["ppr-12"]["rows"][1]["id"]})), "twice"),
        (lambda m, b: ({**m, "sources": []}, b), "commish_board_v9_ppr_12"),
    ],
)
def test_a_run_whose_artifacts_do_not_read_is_refused_by_name(change: Any, message: str) -> None:
    manifest = _artifact(_PRESEASON, "manifest.json")
    boards = {f["id"]: _artifact(_PRESEASON, f"boards/{f['id']}.json") for f in manifest["formats"]}
    manifest, boards = change(manifest, boards)
    with pytest.raises(PublishedBoardError, match=message):
        published_board(_PRESEASON, manifest, boards)


def _with_row(boards: dict[str, Json], fields: Json) -> dict[str, Json]:
    ppr = boards["ppr-12"]
    return {**boards, "ppr-12": {**ppr, "rows": [{**ppr["rows"][0], **fields}, *ppr["rows"][1:]]}}


def test_a_missing_run_is_refused(store: LocalRunStore) -> None:
    with pytest.raises(PublishedBoardError, match="no manifest"):
        read_published_board(store, "2026-10-22T05")


def test_with_no_public_run_nothing_is_written(store: LocalRunStore) -> None:
    outcome = sync_published_board(_unreachable_engine(), store, _NOW)
    assert outcome.line == "published board: no run is public yet"


def _unreachable_engine() -> Engine:
    return make_engine("postgresql+psycopg://nobody@127.0.0.1:9/none")


# THE TABLE, against a migrated scratch database.


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


def _table(engine: Engine) -> list[Json]:
    with engine.connect() as conn:
        rows = conn.execute(select(PUBLISHED_BOARDS).order_by(*PUBLISHED_BOARDS.primary_key))
        return [dict(r._mapping) for r in rows]


def _point_latest(store: LocalRunStore, run_id: str) -> None:
    store.put(LATEST_KEY, encode({"runId": run_id}), JSON_TYPE)


def test_the_table_holds_exactly_the_published_run_and_a_second_publish_changes_nothing(
    engine: Engine, store: LocalRunStore
) -> None:
    with engine.begin() as conn:
        conn.execute(PUBLISHED_BOARDS.delete())
        # Another season's rows stay: a publish replaces its own season only.
        replace_published_board(
            conn, replace(read_published_board(store, _PRESEASON), run_id="2025-12-01T05", season=_OTHER_SEASON), _NOW
        )
    _point_latest(store, _PRESEASON)
    first = sync_published_board(engine, store, _NOW)
    assert first.line.startswith(f"published board: run {_PRESEASON}, 2026, ")
    preseason = _table(engine)
    again = sync_published_board(engine, store, datetime(2026, 10, 21, 14, 0, tzinfo=UTC))
    assert again.line == f"published board: run {_PRESEASON} is already the table's"
    assert _table(engine) == preseason

    _point_latest(store, _IN_SEASON)
    sync_published_board(engine, store, _NOW)
    rows = _table(engine)
    this_season = [r for r in rows if r["season"] == _SEASON]
    assert {r["run_id"] for r in this_season} == {_IN_SEASON}
    assert {r["order_basis"] for r in this_season} == {"rest_of_season"}
    expected = sum(
        len(_artifact(_IN_SEASON, f"boards/{f}.json")["rows"]) for f in ("ppr-12", "half-ppr-12", "standard-12")
    )
    assert len(this_season) == expected
    assert [r for r in rows if r["season"] == _OTHER_SEASON] == [r for r in preseason if r["season"] == _OTHER_SEASON]


def test_a_publish_that_fails_part_way_leaves_the_table_as_it_was(engine: Engine, store: LocalRunStore) -> None:
    _point_latest(store, _PRESEASON)
    sync_published_board(engine, store, _NOW)
    before = _table(engine)
    board = read_published_board(store, _IN_SEASON)
    broken = replace(board, rows=(*board.rows, board.rows[0]))  # a key twice
    with pytest.raises(Exception, match="published_boards_pkey"), engine.begin() as conn:
        replace_published_board(conn, broken, _NOW)
    assert _table(engine) == before


def test_the_publish_command_moves_the_pointer_then_writes_the_table(
    engine: Engine,
    store: LocalRunStore,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    public = {"runId": _IN_SEASON, "finishedAt": "2026-10-21T12:00:00.000Z", "publicAt": "2026-10-21T13:00:00.000Z"}
    store.put(EARLY_KEY, encode(public), JSON_TYPE)
    monkeypatch.setenv("RESEARCH_DATABASE_URL", engine.url.render_as_string(hide_password=False))
    status = nightly_main(["publish", "--out", str(tmp_path), "--no-dispatch", "--at", "2026-10-21T13:30:00+00:00"])
    out = capsys.readouterr().out
    assert status == 0, out
    assert f"publish: run {_IN_SEASON} is public" in out
    assert f"published board: run {_IN_SEASON}, {_SEASON}, " in out
    assert {r["run_id"] for r in _table(engine) if r["season"] == _SEASON} == {_IN_SEASON}
