"""The stadiums ingest (Lane 66a; the round 4 preregistration, section 2.5): the reviewed Wikidata seed
validated against nflverse's game table before a row is written. Every venue of 2016 to 2026 present,
coordinates inside the venue's state or country, the roof type consistent with the recorded roofs,
and international venues flagged."""

import os
from collections.abc import Iterator, Sequence
from dataclasses import replace
from datetime import UTC, datetime
from pathlib import Path

import pytest
from sqlalchemy import Engine, func, select

from research.db.engine import make_engine
from research.db.schema import STADIUMS
from research.db.url import sqlalchemy_url
from research.errors import SchemaDriftError
from research.parity import databases
from research.parity.replay import ReplayFetcher
from research.pipeline.nflverse.client import NflverseClient
from research.pipeline.nflverse.games import ingest_games, map_games
from research.pipeline.nflverse.ingest import schedule_client
from research.pipeline.nflverse.schedule import SCHEDULE_FILE, SCHEDULE_RELEASE
from research.pipeline.stadiums import (
    STADIUMS_CSV_PATH,
    GameVenue,
    StadiumRow,
    game_venues,
    ingest_stadiums,
    parse_stadiums_csv,
    validate_stadiums,
)

_RESEARCH = Path(__file__).resolve().parents[1]
_FIXTURE = _RESEARCH / "parity" / "fixtures" / "nflverse-schedule"
_DATABASE = "parity_test_stadiums"
_NOW = datetime(2026, 10, 16, 22, 0, tzinfo=UTC)
_SEED_ROWS = 47


def _client() -> NflverseClient:
    return NflverseClient(ReplayFetcher([_FIXTURE]))


@pytest.fixture(scope="module")
def seed() -> list[StadiumRow]:
    return parse_stadiums_csv((_RESEARCH / STADIUMS_CSV_PATH).read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def venues() -> Sequence[GameVenue]:
    rows = schedule_client(_client()).get_csv(SCHEDULE_RELEASE, SCHEDULE_FILE)
    return game_venues(map_games(rows, range(2016, 2027)))


def _by_id(seed: Sequence[StadiumRow]) -> dict[str, StadiumRow]:
    return {row.stadium_id: row for row in seed}


def test_the_committed_seed_validates_against_the_recorded_game_table(
    seed: list[StadiumRow], venues: Sequence[GameVenue]
) -> None:
    report = validate_stadiums(seed, venues)
    assert report.problems == []
    assert len(seed) == _SEED_ROWS
    # nflverse files the 2026 London game of week 5 under Jacksonville's own venue.
    assert any("JAX00" in note and "Tottenham Hotspur Stadium" in note for note in report.notes)
    # Its recorded roofs for some games abroad disagree with the venue (a cricket ground as a dome).
    assert any(note.startswith("MEL00") for note in report.notes)


def test_international_venues_are_flagged_and_carry_no_state(seed: list[StadiumRow]) -> None:
    rows = _by_id(seed)
    assert (rows["PAR00"].international, rows["PAR00"].region, rows["PAR00"].country) == (True, None, "FR")
    assert (rows["GNB00"].international, rows["GNB00"].region) == (False, "WI")
    assert rows["NYC01"].clubs == ("NYG", "NYJ")


def test_a_coordinate_outside_the_venues_state_is_a_problem(
    seed: list[StadiumRow], venues: Sequence[GameVenue]
) -> None:
    lambeau = _by_id(seed)["GNB00"]
    flipped = [replace(lambeau, longitude=-lambeau.longitude) if row is lambeau else row for row in seed]
    (problem,) = validate_stadiums(flipped, venues).problems
    assert problem.startswith("GNB00") and "WI" in problem


def test_a_venue_the_game_table_names_and_the_seed_lacks_is_a_problem(
    seed: list[StadiumRow], venues: Sequence[GameVenue]
) -> None:
    report = validate_stadiums([row for row in seed if row.stadium_id != "PAR00"], venues)
    assert report.problems == ["PAR00 is a venue of 2026 games with no stadium row"]


def test_a_roof_the_recorded_games_contradict_is_a_problem_at_home(
    seed: list[StadiumRow], venues: Sequence[GameVenue]
) -> None:
    rows = _by_id(seed)
    changed = [replace(row, roof_type="dome") if row is rows["ATL97"] else row for row in seed]
    (problem,) = validate_stadiums(changed, venues).problems
    assert problem.startswith("ATL97") and "dome" in problem


@pytest.fixture(scope="module")
def engine() -> Iterator[Engine]:
    if "PARITY_DATABASE_URL" not in os.environ:
        pytest.skip("needs a Postgres for scratch databases")
    built = make_engine(sqlalchemy_url(databases.build_with_alembic(_DATABASE)))
    try:
        yield built
    finally:
        built.dispose()
        databases.drop(_DATABASE)


def test_the_ingest_refuses_before_the_game_table_and_then_writes_each_venue_once(engine: Engine) -> None:
    seed_path = _RESEARCH / STADIUMS_CSV_PATH
    with engine.begin() as conn, pytest.raises(SchemaDriftError):
        ingest_stadiums(conn, seed_path, _NOW)
    with engine.begin() as conn:
        ingest_games(conn, _client(), range(2016, 2027), _NOW)
        report = ingest_stadiums(conn, seed_path, _NOW)
        assert report.written == _SEED_ROWS
    with engine.begin() as conn:
        assert ingest_stadiums(conn, seed_path, _NOW).written == 0
        assert conn.execute(select(func.count()).select_from(STADIUMS)).scalar_one() == _SEED_ROWS
