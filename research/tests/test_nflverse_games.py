"""nflverse's game table into `nflverse_games` (Lane 66a; the round 4 preregistration, sections 2.5 and
2.9), read from the recorded `games.csv` of 2026-10-12. The mapper is checked against the file's own
counts and the preregistration's missing-weather counts; the ingest against a migrated scratch
database: stamped, idempotent, and a moved fact updates its row."""

import os
from collections.abc import Iterator, Sequence
from datetime import UTC, date, datetime
from pathlib import Path

import pytest
from sqlalchemy import Engine, func, select, update

from research.db.engine import make_engine
from research.db.schema import NFLVERSE_GAMES
from research.db.url import sqlalchemy_url
from research.errors import SchemaDriftError
from research.parity import databases
from research.parity.replay import ReplayFetcher
from research.pipeline.nflverse.client import NflverseClient
from research.pipeline.nflverse.csv import CsvRow
from research.pipeline.nflverse.games import (
    GAMES_FIRST_SEASON,
    ingest_games,
    map_games,
    missing_weather,
)
from research.pipeline.nflverse.ingest import schedule_client
from research.pipeline.nflverse.schedule import SCHEDULE_FILE, SCHEDULE_RELEASE

_FIXTURE = Path(__file__).resolve().parents[1] / "parity" / "fixtures" / "nflverse-schedule"
_SEASONS = range(GAMES_FIRST_SEASON, 2027)
_DATABASE = "parity_test_nflverse_games"
_READ = datetime(2026, 10, 16, 21, 0, tzinfo=UTC)
# Every game of 2016 to 2026 in the recorded file, every game type.
_GAMES_2016_TO_2026 = 3033


def _client() -> NflverseClient:
    return NflverseClient(ReplayFetcher([_FIXTURE]))


@pytest.fixture(scope="module")
def recorded() -> Sequence[CsvRow]:
    return schedule_client(_client()).get_csv(SCHEDULE_RELEASE, SCHEDULE_FILE)


def test_every_game_of_the_named_seasons_is_one_row_with_its_kickoff_instant(recorded: Sequence[CsvRow]) -> None:
    games = map_games(recorded, _SEASONS)
    per_season = {s: sum(1 for g in games if g.season == s) for s in _SEASONS}
    assert per_season == {
        2016: 267, 2017: 267, 2018: 267, 2019: 267, 2020: 269,
        2021: 285, 2022: 284, 2023: 285, 2024: 285, 2025: 285, 2026: 272,
    }  # fmt: skip
    by_id = {g.game_id: g for g in games}
    paris = by_id["2026_07_PIT_NO"]
    assert (paris.week, paris.home_team, paris.away_team, paris.stadium_id) == (7, "NO", "PIT", "PAR00")
    assert paris.gameday == date(2026, 10, 25)
    assert paris.kickoff_at == datetime(2026, 10, 25, 13, 30, tzinfo=UTC)
    assert paris.result is None and paris.home_score is None


def test_a_trailing_space_in_the_surface_is_not_a_second_surface(recorded: Sequence[CsvRow]) -> None:
    surfaces = {g.surface for g in map_games(recorded, _SEASONS)}
    assert "grass " not in surfaces
    assert None in surfaces and "grass" in surfaces


def test_the_missing_weather_counts_are_the_preregistrations(recorded: Sequence[CsvRow]) -> None:
    counts = missing_weather(map_games(recorded, _SEASONS))
    # Outdoor regular-season club-games (roof neither dome nor closed) with no temperature or wind.
    assert {s: counts[s] for s in range(2016, 2025)} == {
        2016: (4, 388), 2017: (10, 394), 2018: (10, 392), 2019: (14, 394), 2020: (0, 330),
        2021: (22, 386), 2022: (182, 374), 2023: (82, 382), 2024: (10, 356),
    }  # fmt: skip


def test_a_row_with_no_stadium_is_refused(recorded: Sequence[CsvRow]) -> None:
    broken = [{**recorded[-1], "stadium_id": ""}]
    with pytest.raises(SchemaDriftError):
        map_games(broken, [2026])


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


def test_the_ingest_writes_each_game_once_stamped_and_a_rerun_writes_nothing(engine: Engine) -> None:
    with engine.begin() as conn:
        first = ingest_games(conn, _client(), _SEASONS, _READ)
    assert first.written == sum(first.games_per_season.values()) == _GAMES_2016_TO_2026
    with engine.begin() as conn:
        again = ingest_games(conn, _client(), _SEASONS, datetime(2026, 10, 16, 22, 0, tzinfo=UTC))
        assert again.written == 0
        assert conn.execute(select(func.count()).select_from(NFLVERSE_GAMES)).scalar_one() == _GAMES_2016_TO_2026
        assert set(conn.execute(select(NFLVERSE_GAMES.c.read_at).distinct()).scalars()) == {_READ}


def test_a_game_whose_facts_moved_is_updated_and_restamped(engine: Engine) -> None:
    later = datetime(2026, 10, 17, 9, 0, tzinfo=UTC)
    with engine.begin() as conn:
        table = NFLVERSE_GAMES
        conn.execute(update(table).where(table.c.game_id == "2026_07_PIT_NO").values(stadium="Somewhere else"))
        report = ingest_games(conn, _client(), _SEASONS, later)
        assert report.written == 1
        row = conn.execute(select(table).where(table.c.game_id == "2026_07_PIT_NO")).one()
        assert row.stadium == "Stade de France" and row.read_at == later
