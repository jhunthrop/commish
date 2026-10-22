"""The kickoff weather fill against recorded answers: `games.csv` (four 2022 regular-season games and the
wild-card round), the play-by-play fixture's gamebook lines, NCEI's station list cut to the Chicago,
Detroit and New York airports, and the data service's answer for Chicago Midway on 2022-09-11 from
16:00 to 21:00 UTC (SF at CHI kicked off at 17:00 UTC in rain)."""

import csv
import io
import os
from collections.abc import Iterator, Mapping
from dataclasses import dataclass, field, replace
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Final

import pytest
from sqlalchemy import Engine, select, text

from research.db.engine import make_engine
from research.db.schema import GAME_WEATHER
from research.db.url import sqlalchemy_url
from research.errors import SchemaDriftError
from research.parity import databases
from research.pipeline.http import HttpResponse
from research.pipeline.nflverse import pbp_plays
from research.pipeline.nflverse.client import NflverseClient
from research.pipeline.weather import game_weather as gw
from research.pipeline.weather import isd
from research.tests.nflverse_fixtures import TESTDATA, FixtureFetcher, fixture_rows

NOAA: Final = TESTDATA.parent / "weather"
GAMES: Final = {"games.csv": (NOAA / "games.csv").read_bytes()}
SOLDIER_FIELD: Final = (41.8623, -87.6167)
_DATABASE = "parity_test_game_weather"


@dataclass
class NcciFetcher:
    """The station list, and Chicago Midway's 2022 season, from the recordings; anything else 404s."""

    requested: list[str] = field(default_factory=list)
    answers: Mapping[str, Path] = field(
        default_factory=lambda: {
            isd.STATION_LIST_URL: NOAA / "isd-history.csv",
            isd.season_url("72534014819", 2022): NOAA / "global-hourly-72534014819-2022.csv",
        }
    )

    def get(self, url: str, headers: Mapping[str, str] | None = None) -> HttpResponse:
        self.requested.append(url)
        path = self.answers.get(url)
        return HttpResponse(404, b"") if path is None else HttpResponse(200, path.read_bytes())

    def stream(self, url: str, headers: Mapping[str, str] | None = None) -> tuple[int, Iterator[bytes]]:
        raise AssertionError("the ISD reader never streams")


def _games() -> dict[str, gw.GameRecord]:
    rows = list(csv.DictReader(io.StringIO(GAMES["games.csv"].decode())))
    return {g.game_id: g for g in gw.game_records(rows, [2022])}


def _texts() -> dict[str, str]:
    texts: dict[str, str] = {}
    for row in fixture_rows("play_by_play_2022.csv.gz"):
        if row["weather"] not in ("", "NA"):
            texts.setdefault(row["game_id"], row["weather"])
    return texts


def test_only_regular_season_games_are_read_with_their_kickoff() -> None:
    games = _games()
    assert set(games) == {"2022_01_SF_CHI", "2022_01_PHI_DET", "2022_02_CHI_GB", "2022_03_CIN_NYJ"}
    chicago = games["2022_01_SF_CHI"]
    assert chicago.kickoff_at == datetime(2022, 9, 11, 17, tzinfo=UTC)
    assert (chicago.roof, chicago.stadium_id, chicago.temp, chicago.wind) == ("outdoors", "CHI98", None, None)
    assert not games["2022_01_PHI_DET"].outside


def test_the_nearest_station_with_a_record_for_the_season() -> None:
    stations = isd.parse_stations((NOAA / "isd-history.csv").read_text())
    near = isd.nearest_stations(stations, *SOLDIER_FIELD, 2022)
    assert [s.id for s, _ in near] == ["72534014819", "72530094846", "72212604879"]
    assert near[0][1] == pytest.approx(14.2, abs=0.5)
    # The 1948 to 1972 Midway record never reaches 2022.
    assert all(not s.id.startswith("999999") for s, _ in near)


def test_the_kickoff_report_of_a_rainy_hour() -> None:
    reports = isd.parse_reports((NOAA / "global-hourly-72534014819-2022.csv").read_text())
    found = isd.at_kickoff(reports, datetime(2022, 9, 11, 17, tzinfo=UTC), "72534014819", 14.2)
    # 16:53 UTC is the nearest report: +0206 tenths C, 0036 tenths m/s.
    assert found.temperature_f == pytest.approx(20.6 * 9 / 5 + 32)
    assert found.wind_mph == pytest.approx(3.6 * 2.2369362920544)
    # The first report after kickoff is 17:53, a one-hour AA1 of 0000 with condition 2: a trace.
    assert (found.precipitation, found.precipitation_mm, found.kind) == (1, 0.0, "rain")


def _recut(mapping: Mapping[str, str], blank: str | None = None) -> bytes:
    """The recorded answer with columns renamed and one column blanked (a constructed variant)."""
    rows = list(csv.DictReader(io.StringIO((NOAA / "global-hourly-72534014819-2022.csv").read_text())))
    out = io.StringIO()
    names = [mapping.get(n, n) for n in rows[0]]
    writer = csv.writer(out, quoting=csv.QUOTE_ALL, lineterminator="\n")
    writer.writerow(names)
    for row in rows:
        writer.writerow("" if name == blank else value for name, value in zip(names, row.values(), strict=True))
    return out.getvalue().encode()


@dataclass
class RecutFetcher(NcciFetcher):
    """Midway with no one-hour depth, O'Hare with its period in AA2; the rest as recorded."""

    bodies: Mapping[str, bytes] = field(
        default_factory=lambda: {
            isd.season_url("72534014819", 2022): _recut({}, blank="AA1"),
            isd.season_url("72530094846", 2022): _recut({"AA1": "AA2"}),
        }
    )

    def get(self, url: str, headers: Mapping[str, str] | None = None) -> HttpResponse:
        return HttpResponse(200, self.bodies[url]) if url in self.bodies else super().get(url, headers)


def test_precipitation_comes_from_the_next_station_when_the_nearest_has_no_depth() -> None:
    found = isd.IsdReader(RecutFetcher()).weather(*SOLDIER_FIELD, 2022, datetime(2022, 9, 11, 17, tzinfo=UTC))
    assert found is not None
    assert found.station == "72534014819" and found.temperature_f is not None
    # O'Hare's one-hour period, read from AA2: the 17:53 report, depth 0000 with a trace.
    assert (found.precipitation, found.precipitation_station) == (1, "72530094846")


def test_an_answer_without_temperature_or_wind_columns_reads_as_no_value() -> None:
    body = _recut({"TMP": "TMP_GONE", "WND": "WND_GONE"}).decode()
    reports = isd.parse_reports(body)
    assert reports and all(r.temperature_f is None and r.wind_mph is None for r in reports)
    assert any(r.hour_depth_mm is not None for r in reports)


def test_an_unreadable_report_field_is_refused() -> None:
    body = (NOAA / "global-hourly-72534014819-2022.csv").read_text().replace('"+0206,5"', '"+0206"')
    with pytest.raises(SchemaDriftError, match="TMP"):
        isd.parse_reports(body)


def test_each_value_comes_from_the_first_source_that_has_it() -> None:
    reader = isd.IsdReader(NcciFetcher())
    lookup = gw.isd_lookup(reader, {"CHI98": SOLDIER_FIELD})
    games, texts = _games(), _texts()
    chicago = gw.fill(games["2022_01_SF_CHI"], texts["2022_01_SF_CHI"], lookup)
    # games.csv has no 2022 temperature or wind: the gamebook line has both, and names rain.
    assert (chicago.temperature_f, chicago.temperature_source) == (69.0, gw.GAMEBOOK)
    assert (chicago.wind_mph, chicago.wind_source) == (16.0, gw.GAMEBOOK)
    assert (chicago.precipitation, chicago.precipitation_source, chicago.precipitation_kind) == (1, gw.GAMEBOOK, "rain")
    assert (chicago.isd_precipitation, chicago.isd_station) == (1, "72534014819")
    # With no gamebook line, ISD fills all three.
    from_gauge = gw.fill(games["2022_01_SF_CHI"], None, lookup)
    assert (from_gauge.temperature_source, from_gauge.wind_source, from_gauge.precipitation_source) == (gw.ISD,) * 3
    # A game-table value comes first.
    tabled = gw.fill(replace(games["2022_01_SF_CHI"], temp=70.0), texts["2022_01_SF_CHI"], lookup)
    assert (tabled.temperature_f, tabled.temperature_source) == (70.0, gw.GAMES_TABLE)


def test_an_indoor_game_keeps_no_weather_and_reads_no_station() -> None:
    fetcher = NcciFetcher()
    lookup = gw.isd_lookup(isd.IsdReader(fetcher), {"DET00": (42.34, -83.0456)})
    detroit = gw.fill(_games()["2022_01_PHI_DET"], _texts()["2022_01_PHI_DET"], lookup)
    assert detroit.roof == "dome"
    assert (detroit.temperature_f, detroit.wind_mph, detroit.precipitation) == (None, None, None)
    assert fetcher.requested == []


def test_an_empty_gamebook_line_says_nothing_about_precipitation() -> None:
    row = gw.fill(_games()["2022_03_CIN_NYJ"], "Temp: ° F, Wind: mph", gw.isd_lookup(None, None))
    assert (row.temperature_f, row.wind_mph, row.precipitation) == (None, None, None)


def test_an_empty_gamebook_line_proceeds_to_the_gauge_for_all_three_values() -> None:
    station = isd.KickoffWeather("72534014819", 12.0, 61.0, 9.0, 1, 1.5, "rain", "72534014819")
    row = gw.fill(_games()["2022_03_CIN_NYJ"], "Temp: ° F, Wind: mph", lambda _game: station)
    assert (row.temperature_f, row.wind_mph, row.precipitation) == (61.0, 9.0, 1)
    assert (row.temperature_source, row.wind_source, row.precipitation_source) == (gw.ISD,) * 3
    dry = replace(station, precipitation=None)
    unknown = gw.fill(_games()["2022_03_CIN_NYJ"], "Temp: ° F, Wind: mph", lambda _game: dry)
    assert (unknown.precipitation, unknown.precipitation_source) == (None, None)


def test_a_missing_season_answer_is_a_failure() -> None:
    reader = isd.IsdReader(NcciFetcher())
    with pytest.raises(isd.IsdError, match="HTTP 404"):
        reader.weather(*SOLDIER_FIELD, 2021, datetime(2021, 9, 12, 17, tzinfo=UTC))


@pytest.fixture(scope="module")
def engine() -> Any:
    if "PARITY_DATABASE_URL" not in os.environ:
        pytest.skip("needs a Postgres for scratch databases")
    # The whole schema (the play ingest writes revision 0020's kick columns) without the real stadiums
    # table revision 0010 creates: these cases build their own stand-in.
    url = databases.build_with_alembic(_DATABASE)
    built = make_engine(sqlalchemy_url(url))
    with built.begin() as conn:
        conn.execute(text("drop table research.stadiums cascade"))
    try:
        yield built
    finally:
        built.dispose()
        databases.drop(_DATABASE)


def test_a_season_with_no_plays_is_refused(engine: Engine) -> None:
    with engine.begin() as conn, pytest.raises(SchemaDriftError, match=r"no plays of \[2022\]"):
        gw.ingest_game_weather(conn, NflverseClient(FixtureFetcher(bodies=GAMES)), None, [2022])
    with engine.begin() as conn:
        pbp_plays.ingest_pbp_plays(conn, NflverseClient(FixtureFetcher()), 2022)


def test_without_a_stadiums_table_no_station_is_read_and_a_rerun_writes_nothing(engine: Engine) -> None:
    client = NflverseClient(FixtureFetcher(bodies=GAMES))
    fetcher = NcciFetcher()
    with engine.begin() as conn:
        assert gw.stadium_coordinates(conn) is None
        first = gw.ingest_game_weather(conn, client, isd.IsdReader(fetcher), [2022])
        again = gw.ingest_game_weather(conn, client, isd.IsdReader(fetcher), [2022])
        stored = conn.execute(select(GAME_WEATHER.c.game_id, GAME_WEATHER.c.temperature_source)).all()
    assert fetcher.requested == []
    assert first[0].written == len(stored) == len(_games())
    assert again[0].written == 0
    assert "no ISD read" in first[0].lines()[0]


def test_a_value_that_moved_is_rewritten(engine: Engine) -> None:
    client = NflverseClient(FixtureFetcher(bodies=GAMES))
    with engine.begin() as conn:
        conn.execute(
            text("create table research.stadiums (stadium_id text primary key, latitude float8, longitude float8)")
        )
        conn.execute(text("insert into research.stadiums values ('CHI98', 41.8623, -87.6167)"))
        reports = gw.ingest_game_weather(conn, client, isd.IsdReader(NcciFetcher()), [2022])
        station = conn.execute(
            select(GAME_WEATHER.c.isd_station).where(GAME_WEATHER.c.game_id == "2022_01_SF_CHI")
        ).scalar_one()
        conn.execute(text("drop table research.stadiums"))
    assert station == "72534014819"
    assert reports[0].written >= 1
