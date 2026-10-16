"""The National Weather Service forecast at kickoff (Lane 66a; the round 4 preregistration, section 2.5),
read from recorded answers of 2026-10-16: Lambeau Field's grid (GRB 78,31) and Soldier Field's (LOT
76,72). The parser takes each layer's value for the interval holding the kickoff, in the units the site
says, and refuses a layer or a unit it does not know."""

import copy
import json
from collections.abc import Mapping
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import pytest

from research.errors import SchemaDriftError
from research.pipeline.http import HttpResponse
from research.pipeline.nws.client import NWS_USER_AGENT, NwsClient, NwsError
from research.pipeline.nws.grid import PRECIPITATION_KINDS, KickoffForecast, kickoff_forecast, parse_duration

_DATA = Path(__file__).resolve().parent / "testdata" / "nws"
LAMBEAU_GRID = "https://api.weather.gov/gridpoints/GRB/78,31"
# DAL at GB, week 6, Sunday 20:20 Eastern.
DAL_AT_GB = datetime(2026, 10, 19, 0, 20, tzinfo=UTC)
# NE at CHI, week 7, Thursday 20:15 Eastern.
NE_AT_CHI = datetime(2026, 10, 23, 0, 15, tzinfo=UTC)


def _recorded(name: str) -> dict[str, Any]:
    loaded: dict[str, Any] = json.loads((_DATA / name).read_text(encoding="utf-8"))
    return loaded


def test_the_kind_codes_are_the_list_the_api_reads() -> None:
    shared = Path(__file__).resolve().parents[2] / "api" / "testdata" / "precipitation-kinds.json"
    assert list(PRECIPITATION_KINDS) == json.loads(shared.read_text(encoding="utf-8"))["kinds"]


def test_an_iso_duration_reads_days_and_hours() -> None:
    assert [parse_duration(d).total_seconds() / 3600 for d in ("PT1H", "PT6H", "P1D", "P4DT17H", "P7D")] == [
        1.0, 6.0, 24.0, 113.0, 168.0,
    ]  # fmt: skip
    with pytest.raises(SchemaDriftError):
        parse_duration("PT30M15S")


def test_sunday_night_at_lambeau_reads_each_layer_at_the_kickoff_hour_in_the_sites_units() -> None:
    forecast = kickoff_forecast(_recorded("grid-GRB-78-31.json"), DAL_AT_GB)
    assert forecast == KickoffForecast(
        temperature_f=55.0,
        wind_mph=9.2,
        wind_gust_mph=20.7,
        precipitation_probability=0.0,
        precipitation_amount_in=0.0,
        sky_cover_pct=2.0,
        precipitation_kind=PRECIPITATION_KINDS.index("none"),
        issued_at=datetime(2026, 10, 16, 19, 57, 4, tzinfo=UTC),
    )


def test_a_layer_whose_forecast_ends_before_kickoff_is_left_out_not_zero() -> None:
    forecast = kickoff_forecast(_recorded("grid-LOT-76-72.json"), NE_AT_CHI)
    assert (forecast.temperature_f, forecast.wind_mph, forecast.wind_gust_mph) == (64.0, 2.3, 4.6)
    assert (forecast.precipitation_probability, forecast.sky_cover_pct) == (2.0, 36.0)
    # The amount runs only to the 19th in this answer.
    assert forecast.precipitation_amount_in is None


def test_showers_in_the_hour_are_rain_with_the_hours_share_of_the_amount() -> None:
    forecast = kickoff_forecast(_recorded("grid-GRB-78-31.json"), datetime(2026, 10, 16, 13, 30, tzinfo=UTC))
    assert forecast.precipitation_kind == PRECIPITATION_KINDS.index("rain")
    assert forecast.precipitation_probability == pytest.approx(40.0)
    # 1.016 mm over five hours is 0.2 mm in the hour, 0.01 inch.
    assert forecast.precipitation_amount_in == pytest.approx(0.01)


def test_a_kickoff_past_the_whole_answer_has_no_values() -> None:
    forecast = kickoff_forecast(_recorded("grid-GRB-78-31.json"), datetime(2026, 11, 1, 18, 0, tzinfo=UTC))
    assert forecast.temperature_f is None and forecast.wind_mph is None and forecast.is_empty


def test_an_unknown_unit_or_weather_word_or_a_missing_layer_is_refused() -> None:
    recorded = _recorded("grid-GRB-78-31.json")
    unit = copy.deepcopy(recorded)
    unit["properties"]["windSpeed"]["uom"] = "wmoUnit:m_s-1"
    word = copy.deepcopy(recorded)
    word["properties"]["weather"]["values"][0]["value"][0]["weather"] = "meteor_shower"
    missing = copy.deepcopy(recorded)
    del missing["properties"]["windGust"]
    for broken in (unit, word, missing):
        with pytest.raises(SchemaDriftError):
            kickoff_forecast(broken, DAL_AT_GB)


class _Fetcher:
    """Answers each URL from a queue of recorded or stated responses and keeps what was asked."""

    def __init__(self, answers: Mapping[str, list[HttpResponse]]) -> None:
        self.answers = {url: list(responses) for url, responses in answers.items()}
        self.asked: list[tuple[str, Mapping[str, str]]] = []

    def get(self, url: str, headers: Mapping[str, str] | None = None) -> HttpResponse:
        self.asked.append((url, dict(headers or {})))
        return self.answers[url].pop(0)

    def stream(self, url: str, headers: Mapping[str, str] | None = None) -> Any:
        raise NotImplementedError


def _ok(name: str) -> HttpResponse:
    return HttpResponse(200, (_DATA / name).read_bytes())


def test_the_client_names_the_site_and_a_contact_and_reads_the_grid_cell() -> None:
    fetcher = _Fetcher({"https://api.weather.gov/points/44.5014,-88.0622": [_ok("points-GNB00.json")]})
    point = NwsClient(fetcher, sleep=lambda _s: None).point(44.501388888889, -88.062222222222)
    assert (point.office, point.grid_x, point.grid_y, point.grid_url, point.time_zone) == (
        "GRB", 78, 31, LAMBEAU_GRID, "America/Chicago",
    )  # fmt: skip
    ((_url, headers),) = fetcher.asked
    assert headers["User-Agent"] == NWS_USER_AGENT
    assert "trycommish.app" in NWS_USER_AGENT and "@" in NWS_USER_AGENT


def test_an_over_limit_answer_is_retried_once_after_a_pause_and_a_second_is_a_failure() -> None:
    busy = HttpResponse(503, b"")
    waits: list[float] = []
    fetcher = _Fetcher({LAMBEAU_GRID: [busy, _ok("grid-GRB-78-31.json"), busy, busy]})
    client = NwsClient(fetcher, sleep=waits.append)
    assert client.grid(LAMBEAU_GRID)["properties"]["gridId"] == "GRB"
    with pytest.raises(NwsError):
        client.grid(LAMBEAU_GRID)
    assert len(waits) == len(fetcher.asked) - 2
