"""The play table against recorded rows (`testdata/nflverse/play_by_play_2022.csv.gz`: every column of
nflverse's 2022 release for the first 60 rows of SF at CHI, PHI at DET and CIN at NYJ, and three
postseason rows), each value checked against Python's csv reading of the same file."""

import datetime as dt
import gzip
import os
from collections import Counter
from datetime import UTC, datetime
from typing import Any

import pytest
from sqlalchemy import Engine, func, select

from research.db.engine import make_engine
from research.db.schema import NFLVERSE_PBP_PLAYS
from research.db.url import sqlalchemy_url
from research.errors import SchemaDriftError
from research.parity import databases
from research.pipeline.nflverse import pbp_plays
from research.pipeline.nflverse.client import NflverseClient, NflverseError
from research.pipeline.observations import INSERT_CHUNK_ROWS, MAX_BIND_PARAMETERS, rows_per_statement
from research.tests.nflverse_fixtures import TESTDATA, FixtureFetcher, fixture_rows

_FILE = "play_by_play_2022.csv.gz"
_SEASON = 2022
_GAMES = 3
_DATABASE = "parity_test_pbp_plays"


def _plays() -> list[dict[str, str]]:
    return [r for r in fixture_rows(_FILE) if r["season_type"] == "REG" and r["play_type"] not in ("", "NA")]


def _absent(raw: str) -> bool:
    return raw in ("", "NA")


def _mapped() -> pbp_plays.PlayRows:
    rows = pbp_plays.PlayRows()
    for row in fixture_rows(_FILE):
        rows.add(row)
    return rows


def test_only_regular_season_rows_with_a_play_type_are_plays() -> None:
    rows = _mapped()
    assert rows.read == len(fixture_rows(_FILE))
    assert len(rows.rows) == len(_plays())
    assert Counter(r["game_id"] for r in rows.rows) == Counter(r["game_id"] for r in _plays())
    assert all(r["season"] == _SEASON for r in rows.rows)


def test_each_value_is_the_files_by_its_declared_type() -> None:
    by_key = {(r["game_id"], r["play_id"]): r for r in _mapped().rows}
    for raw in _plays():
        row = by_key[(raw["game_id"], int(raw["play_id"]))]
        assert row["posteam"] == (None if _absent(raw["posteam"]) else raw["posteam"])
        assert row["down"] == (None if _absent(raw["down"]) else int(raw["down"]))
        assert row["yardline_100"] == (None if _absent(raw["yardline_100"]) else int(raw["yardline_100"]))
        assert row["air_yards"] == (None if _absent(raw["air_yards"]) else float(raw["air_yards"]))
        assert row["epa"] == (None if _absent(raw["epa"]) else float(raw["epa"]))
        assert row["qb_dropback"] == (None if _absent(raw["qb_dropback"]) else raw["qb_dropback"] == "1")
        assert row["pass_location"] == (None if _absent(raw["pass_location"]) else raw["pass_location"])
        assert row["receiver_player_id"] == (None if _absent(raw["receiver_player_id"]) else raw["receiver_player_id"])
        assert row["weather"] == (None if _absent(raw["weather"]) else raw["weather"])
        assert row["game_date"] == dt.date.fromisoformat(raw["game_date"])


def test_a_target_carries_its_depth_location_and_receiver() -> None:
    targets = [r for r in _mapped().rows if r["play_type"] == "pass" and r["receiver_player_id"] is not None]
    assert targets
    assert all(r["air_yards"] is not None and r["pass_location"] in ("left", "middle", "right") for r in targets)


def test_every_play_of_a_game_is_stamped_as_the_aggregates_are() -> None:
    rows = [r for r in _mapped().rows if r["game_id"] == "2022_01_SF_CHI"]
    # Sunday 2022-09-11: the end of the game's UTC day plus the 24-hour publication lag.
    assert {r["as_of"] for r in rows} == {datetime(2022, 9, 13, 0, tzinfo=UTC)}


def _row(**changes: str) -> dict[str, str]:
    return {**_plays()[5], **changes}


def test_an_unknown_play_type_is_refused() -> None:
    with pytest.raises(SchemaDriftError, match="play_type"):
        pbp_plays.map_play(_row(play_type="lateral_party"))


def test_a_fraction_in_a_whole_number_column_is_refused() -> None:
    with pytest.raises(SchemaDriftError, match="ydstogo"):
        pbp_plays.map_play(_row(ydstogo="7.5"))


def test_a_flag_that_is_not_zero_or_one_is_refused() -> None:
    with pytest.raises(SchemaDriftError, match="shotgun"):
        pbp_plays.map_play(_row(shotgun="yes"))


def test_a_play_with_no_game_date_is_refused() -> None:
    with pytest.raises(SchemaDriftError, match="game_date"):
        pbp_plays.map_play(_row(game_date="NA"))


def test_a_play_row_is_too_wide_for_the_observation_writers_chunk() -> None:
    width = len(NFLVERSE_PBP_PLAYS.columns) - 1  # the database stamps ingested_at
    per_statement = rows_per_statement(width)
    assert per_statement < INSERT_CHUNK_ROWS
    assert per_statement * width <= MAX_BIND_PARAMETERS < (per_statement + 1) * width
    assert rows_per_statement(7) == INSERT_CHUNK_ROWS


def test_postseason_and_marker_rows_are_not_plays() -> None:
    assert pbp_plays.map_play(_row(season_type="POST")) is None
    assert pbp_plays.map_play(_row(play_type="NA")) is None


def test_a_release_without_a_tabled_column_is_refused() -> None:
    body = gzip.decompress((TESTDATA / _FILE).read_bytes()).decode()
    header, rest = body.split("\n", 1)
    trimmed = header.replace(",run_gap,", ",run_gap_renamed,")
    fetcher = FixtureFetcher(bodies={_FILE: gzip.compress(f"{trimmed}\n{rest}".encode())})
    with pytest.raises(NflverseError, match="run_gap"):
        pbp_plays.ingest_pbp_plays(None, NflverseClient(fetcher), 2022)  # type: ignore[arg-type]


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


def test_the_ingest_writes_each_play_once(engine: Engine) -> None:
    client = NflverseClient(FixtureFetcher())
    with engine.begin() as conn:
        first = pbp_plays.ingest_pbp_plays(conn, client, 2022)
        again = pbp_plays.ingest_pbp_plays(conn, client, 2022)
        stored = conn.execute(select(func.count()).select_from(NFLVERSE_PBP_PLAYS)).scalar_one()
    assert first.written == first.plays == len(_plays()) == stored
    assert first.games == _GAMES
    assert again.written == 0


def test_a_season_the_release_has_not_published_is_not_found(engine: Engine) -> None:
    with engine.begin() as conn, pytest.raises(NflverseError) as raised:
        pbp_plays.ingest_pbp_plays(conn, NflverseClient(FixtureFetcher()), 2031)
    assert raised.value.kind == "not_found"
