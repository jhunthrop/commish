"""The hourly forecast pass against a migrated scratch database (Lane 66a): the recorded game table and
the stadium seed, the weather service answered from recorded grids. A game is read from the Tuesday of
its week, once an hour at most, a dome and a venue abroad take none, and a venue the stadium table does
not confirm takes none rather than another place's weather."""

import os
from collections.abc import Iterator, Mapping
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import pytest
from sqlalchemy import Connection, Engine, delete, select, update

from research.db.engine import make_engine
from research.db.schema import NFLVERSE_GAMES, NWS_GRID_POINTS, TEAM_WEEK_OBSERVATIONS
from research.db.url import sqlalchemy_url
from research.parity import databases
from research.parity.replay import ReplayFetcher
from research.pipeline.http import HttpResponse
from research.pipeline.nflverse.client import NflverseClient
from research.pipeline.nflverse.games import ingest_games
from research.pipeline.nws.client import NwsClient
from research.pipeline.nws.forecast import FORECAST_SOURCE, ForecastMetric, run_forecast_pass, week_opens
from research.pipeline.stadiums import STADIUMS_CSV_PATH, ingest_stadiums

_RESEARCH = Path(__file__).resolve().parents[1]
_DATA = Path(__file__).resolve().parent / "testdata" / "nws"
_DATABASE = "parity_test_nws_forecast"
SEASON = 2026
FRIDAY = datetime(2026, 10, 16, 21, 5, tzinfo=UTC)
NEXT_TUESDAY = datetime(2026, 10, 20, 14, 5, tzinfo=UTC)
# The games the recorded grids cover, a dome and a game abroad; the rest of weeks 6 and 7 are removed.
KEPT = ("2026_06_DAL_GB", "2026_06_ARI_LA", "2026_06_HOU_JAX", "2026_07_NE_CHI", "2026_06_NYJ_NE")
ANSWERS = {
    "https://api.weather.gov/points/44.5014,-88.0622": "points-GNB00.json",
    "https://api.weather.gov/gridpoints/GRB/78,31": "grid-GRB-78-31.json",
    "https://api.weather.gov/points/41.8625,-87.6167": "points-CHI98.json",
    "https://api.weather.gov/gridpoints/LOT/76,72": "grid-LOT-76-72.json",
}


class _Recorded:
    def __init__(self) -> None:
        self.asked: list[str] = []

    def get(self, url: str, headers: Mapping[str, str] | None = None) -> HttpResponse:
        self.asked.append(url)
        return HttpResponse(200, (_DATA / ANSWERS[url]).read_bytes())

    def stream(self, url: str, headers: Mapping[str, str] | None = None) -> Any:
        raise NotImplementedError


def _forecast_rows(conn: Connection, team: str, week: int) -> dict[str, float]:
    table = TEAM_WEEK_OBSERVATIONS
    query = select(table.c.metric, table.c.value).where(
        table.c.source == FORECAST_SOURCE, table.c.season == SEASON, table.c.week == week, table.c.team == team
    )
    return {row.metric: row.value for row in conn.execute(query)}


@pytest.fixture(scope="module")
def engine() -> Iterator[Engine]:
    if "PARITY_DATABASE_URL" not in os.environ:
        pytest.skip("needs a Postgres for scratch databases")
    built = make_engine(sqlalchemy_url(databases.build_with_alembic(_DATABASE)))
    client = NflverseClient(ReplayFetcher([_RESEARCH / "parity" / "fixtures" / "nflverse-schedule"]))
    with built.begin() as conn:
        ingest_games(conn, client, range(2016, 2027), FRIDAY)
        ingest_stadiums(conn, _RESEARCH / STADIUMS_CSV_PATH, FRIDAY)
        table = NFLVERSE_GAMES
        conn.execute(
            delete(table).where(table.c.season == SEASON, table.c.week.in_((6, 7)), table.c.game_id.not_in(KEPT))
        )
        # A game filed under a venue it is not at: the stadium table does not confirm it.
        conn.execute(update(table).where(table.c.game_id == "2026_06_NYJ_NE").values(stadium="Wembley Stadium"))
    try:
        yield built
    finally:
        built.dispose()
        databases.drop(_DATABASE)


def test_a_week_opens_on_its_tuesday_in_eastern_time() -> None:
    sunday_night = datetime(2026, 10, 19, 0, 20, tzinfo=UTC)
    assert week_opens(sunday_night).isoformat() == "2026-10-13T00:00:00-04:00"
    thursday_night = datetime(2026, 10, 23, 0, 15, tzinfo=UTC)
    assert week_opens(thursday_night).isoformat() == "2026-10-20T00:00:00-04:00"


def test_friday_reads_sundays_outdoor_game_and_says_why_the_others_take_none(engine: Engine) -> None:
    fetcher = _Recorded()
    with engine.begin() as conn:
        result = run_forecast_pass(conn, NwsClient(fetcher, sleep=lambda _s: None), FRIDAY)
        statuses = {o.game_id: o.status for o in result.outcomes}
        assert statuses == {
            "2026_06_DAL_GB": "written",
            "2026_06_ARI_LA": "indoors",
            "2026_06_HOU_JAX": "abroad",
            "2026_06_NYJ_NE": "unknown-venue",
        }
        assert fetcher.asked == [
            "https://api.weather.gov/points/44.5014,-88.0622",
            "https://api.weather.gov/gridpoints/GRB/78,31",
        ]
        assert result.requests == len(fetcher.asked)
        gb, dal = _forecast_rows(conn, "GB", 6), _forecast_rows(conn, "DAL", 6)
        assert gb == dal
        assert (gb[ForecastMetric.TEMPERATURE], gb[ForecastMetric.WIND], gb[ForecastMetric.PRECIPITATION_PROBABILITY]) == (
            55.0, 9.2, 0.0,
        )  # fmt: skip
        assert gb[ForecastMetric.ISSUED_AT] == datetime(2026, 10, 16, 19, 57, 4, tzinfo=UTC).timestamp()
        stored = conn.execute(select(NWS_GRID_POINTS.c.office, NWS_GRID_POINTS.c.grid_x)).all()
        assert [tuple(row) for row in stored] == [("GRB", 78)]


def test_a_second_pass_in_the_same_hour_asks_nothing(engine: Engine) -> None:
    fetcher = _Recorded()
    with engine.begin() as conn:
        result = run_forecast_pass(conn, NwsClient(fetcher, sleep=lambda _s: None), FRIDAY.replace(minute=40))
    assert fetcher.asked == []
    assert {o.game_id: o.status for o in result.outcomes}["2026_06_DAL_GB"] == "fresh"


def test_next_tuesday_opens_week_seven_and_reads_its_thursday_game(engine: Engine) -> None:
    fetcher = _Recorded()
    with engine.begin() as conn:
        result = run_forecast_pass(conn, NwsClient(fetcher, sleep=lambda _s: None), NEXT_TUESDAY)
        assert {o.game_id: o.status for o in result.outcomes} == {"2026_07_NE_CHI": "written"}
        chi = _forecast_rows(conn, "CHI", 7)
    assert (chi[ForecastMetric.TEMPERATURE], chi[ForecastMetric.WIND_GUST]) == (64.0, 4.6)
    assert ForecastMetric.PRECIPITATION_AMOUNT not in chi
