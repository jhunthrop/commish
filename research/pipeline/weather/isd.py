"""NOAA'S INTEGRATED SURFACE DATABASE: the hourly observation nearest a stadium at a kickoff.

The third source of the round 4 weather fill (preregistration §2.5), after the game table and the
gamebook line: NCEI's global-hourly dataset (US public domain), read through NCEI's data access
service one station and one season at a time with only the fields the fill needs.

- `isd-history.csv` lists every station with its coordinates and period of record. A stadium's
  stations are those within `MAX_STATION_KM` whose record covers the game's season, nearest first.
- A report's DATE is UTC. Temperature (`TMP`, tenths of a degree Celsius) and wind (`WND`, tenths of
  a metre a second) come from the report nearest the kickoff within `REPORT_WINDOW`; a value whose
  quality code marks it erroneous, or that is ISD's missing sentinel, is no value.
- Precipitation is the one-hour liquid depth (`AA1`, period 01) of the first report in the hour after
  the kickoff: any measured depth, or a trace, is 1; a zero depth is 0; no such report says nothing.
  Its kind is read from the present-weather code (`MW1`, else `AW1`) of the report nearest kickoff.
  The one-hour period is the first of `AA1` to `AA3` that carries one. When the nearest station has
  no such report for the hour, the next station in range that has one gives the precipitation.
- QUALITY. ISD's erroneous codes (3 and 7) make a value no value. The suspect codes (2 and 6) are
  accepted as reported: they mark a value the source flagged, not one it rejected.

Every response is parsed strictly: a missing column or an unreadable field is a changed service.
"""

import math
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, replace
from datetime import UTC, date, datetime, timedelta
from typing import Final
from urllib.parse import urlencode

from research.errors import ResearchError, SchemaDriftError
from research.pipeline.http import Fetcher
from research.pipeline.nflverse.csv import CsvRow, parse_csv

STATION_LIST_URL: Final = "https://www.ncei.noaa.gov/pub/data/noaa/isd-history.csv"
DATA_SERVICE_URL: Final = "https://www.ncei.noaa.gov/access/services/data/v1"
DEPTH_COLUMNS: Final = ("AA1", "AA2", "AA3")
DATA_TYPES: Final = ("TMP", "WND", *DEPTH_COLUMNS, "MW1", "AW1")
MAX_STATION_KM: Final = 50.0
STATIONS_TRIED: Final = 3
REPORT_WINDOW: Final = timedelta(minutes=60)
# A season's games fall between September and mid February.
SEASON_START: Final = (9, 1)
SEASON_END: Final = (2, 20)

_EARTH_KM: Final = 6371.0
_MISSING_TEMPERATURE: Final = "+9999"
_MISSING_SPEED: Final = "9999"
_ERRONEOUS_QUALITY: Final = frozenset({"3", "7"})
_CALM_TYPE: Final = "C"
_ONE_HOUR: Final = "01"
_TRACE: Final = "2"
_MPH_PER_MS: Final = 2.2369362920544
_TENTHS: Final = 10.0
_STATION_COLUMNS: Final = ("USAF", "WBAN", "STATION NAME", "LAT", "LON", "BEGIN", "END")
# The service answers only the requested fields a station reported in the window, so only these two
# columns are required; an absent field column reads as no value.
_REPORT_COLUMNS: Final = ("STATION", "DATE")
# Present-weather codes (ISD's MW1 and AW1 tables) by the word class the gamebook parser uses.
_KIND_RANGES: Final = (
    (range(50, 66), "rain"),
    (range(66, 68), "sleet"),
    (range(68, 70), "mix"),
    (range(70, 79), "snow"),
    (range(79, 80), "sleet"),
    (range(80, 83), "rain"),
    (range(83, 85), "mix"),
    (range(85, 87), "snow"),
    (range(87, 91), "sleet"),
    (range(91, 100), "rain"),
)


class IsdError(ResearchError):
    """The data service answered with a failure."""


@dataclass(frozen=True, slots=True)
class Station:
    id: str
    name: str
    latitude: float
    longitude: float
    begin: date
    end: date


@dataclass(frozen=True, slots=True)
class Report:
    at: datetime
    temperature_f: float | None
    wind_mph: float | None
    hour_depth_mm: float | None
    hour_trace: bool
    weather_code: int | None


@dataclass(frozen=True, slots=True)
class KickoffWeather:
    station: str
    distance_km: float
    temperature_f: float | None
    wind_mph: float | None
    precipitation: int | None
    precipitation_mm: float | None
    kind: str | None
    # The station the precipitation came from: the same one, or the next within range when the nearest
    # reported no one-hour depth for the hour.
    precipitation_station: str | None = None


def _require(rows: Sequence[CsvRow], columns: Iterable[str], what: str) -> None:
    if rows:
        missing = [c for c in columns if c not in rows[0]]
        if missing:
            raise SchemaDriftError(f"{what} has no {', '.join(missing)} column; the service changed.")


def _day(raw: str, what: str) -> date:
    try:
        return date(int(raw[:4]), int(raw[4:6]), int(raw[6:8]))
    except ValueError as error:
        raise SchemaDriftError(f'{what} has a date "{raw}" that is not YYYYMMDD.') from error


def parse_stations(text: str) -> list[Station]:
    """`isd-history.csv`: every station with coordinates and a period of record."""
    rows = parse_csv(text)
    _require(rows, _STATION_COLUMNS, "isd-history.csv")
    stations: list[Station] = []
    for row in rows:
        lat, lon = row["LAT"].strip(), row["LON"].strip()
        if not lat or not lon or not row["BEGIN"] or not row["END"]:
            continue
        stations.append(
            Station(
                f"{row['USAF']}{row['WBAN']}",
                row["STATION NAME"],
                float(lat),
                float(lon),
                _day(row["BEGIN"], "isd-history.csv"),
                _day(row["END"], "isd-history.csv"),
            )
        )
    return stations


def distance_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance by the haversine formula."""
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * _EARTH_KM * math.asin(math.sqrt(a))


def nearest_stations(
    stations: Sequence[Station], latitude: float, longitude: float, season: int
) -> list[tuple[Station, float]]:
    """Stations within `MAX_STATION_KM` whose record reaches into the season, nearest first."""
    opens, closes = date(season, *SEASON_START), date(season + 1, *SEASON_END)
    near = [
        (s, distance_km(latitude, longitude, s.latitude, s.longitude))
        for s in stations
        if s.begin <= closes and s.end >= opens
    ]
    return sorted([(s, d) for s, d in near if d <= MAX_STATION_KM], key=lambda pair: pair[1])[:STATIONS_TRIED]


def season_url(station: str, season: int) -> str:
    query = {
        "dataset": "global-hourly",
        "stations": station,
        "startDate": f"{season}-{SEASON_START[0]:02d}-{SEASON_START[1]:02d}T00:00:00",
        "endDate": f"{season + 1}-{SEASON_END[0]:02d}-{SEASON_END[1]:02d}T23:59:59",
        "dataTypes": ",".join(DATA_TYPES),
        "format": "csv",
    }
    return f"{DATA_SERVICE_URL}?{urlencode(query)}"


def _fields(raw: str, count: int, column: str, at: str) -> list[str] | None:
    if raw == "":
        return None
    parts = raw.split(",")
    if len(parts) < count:
        raise SchemaDriftError(f'ISD report {at}: {column} "{raw}" has fewer than {count} fields.')
    return parts


def _temperature(raw: str, at: str) -> float | None:
    parts = _fields(raw, 2, "TMP", at)
    if parts is None or parts[0] == _MISSING_TEMPERATURE or parts[1] in _ERRONEOUS_QUALITY:
        return None
    return float(parts[0]) / _TENTHS * 9 / 5 + 32


def _wind(raw: str, at: str) -> float | None:
    parts = _fields(raw, 5, "WND", at)
    if parts is None or parts[3] == _MISSING_SPEED or parts[4] in _ERRONEOUS_QUALITY:
        return None
    if parts[2] == _CALM_TYPE:
        return 0.0
    return float(parts[3]) / _TENTHS * _MPH_PER_MS


def _hour_depth(raw: str, at: str) -> tuple[float | None, bool]:
    parts = _fields(raw, 4, "AA1", at)
    if parts is None or parts[0] != _ONE_HOUR or parts[3] in _ERRONEOUS_QUALITY or parts[1] == _MISSING_SPEED:
        return None, False
    return float(parts[1]) / _TENTHS, parts[2] == _TRACE


def _weather_code(row: CsvRow, at: str) -> int | None:
    for column in ("MW1", "AW1"):
        parts = _fields(row.get(column, ""), 2, column, at)
        if parts is not None and parts[0].isdigit():
            return int(parts[0])
    return None


def _first_hour_depth(row: CsvRow, at: str) -> tuple[float | None, bool]:
    """The first one-hour period among AA1 to AA3 (a report can carry several periods)."""
    for column in DEPTH_COLUMNS:
        depth, trace = _hour_depth(row.get(column, ""), at)
        if depth is not None:
            return depth, trace
    return None, False


def parse_reports(text: str) -> list[Report]:
    """A data service CSV answer, one report per row."""
    rows = parse_csv(text) if text.strip() else []
    _require(rows, _REPORT_COLUMNS, "the ISD data service answer")
    reports: list[Report] = []
    for row in rows:
        at = row["DATE"]
        try:
            instant = datetime.fromisoformat(at).replace(tzinfo=UTC)
        except ValueError as error:
            raise SchemaDriftError(f'ISD report date "{at}" is not ISO 8601.') from error
        depth, trace = _first_hour_depth(row, at)
        reports.append(
            Report(instant, _temperature(row["TMP"], at), _wind(row["WND"], at), depth, trace, _weather_code(row, at))
        )
    return reports


def kind_of_code(code: int | None) -> str | None:
    if code is None:
        return None
    return next((kind for codes, kind in _KIND_RANGES if code in codes), None)


def _nearest(reports: Sequence[Report], kickoff: datetime, has: str) -> Report | None:
    near = [r for r in reports if abs(r.at - kickoff) <= REPORT_WINDOW and getattr(r, has) is not None]
    return min(near, key=lambda r: abs(r.at - kickoff), default=None)


def at_kickoff(reports: Sequence[Report], kickoff: datetime, station: str, km: float) -> KickoffWeather:
    """The station's weather at a kickoff, from its season's reports."""
    temperature = _nearest(reports, kickoff, "temperature_f")
    wind = _nearest(reports, kickoff, "wind_mph")
    hour = sorted(
        (r for r in reports if kickoff < r.at <= kickoff + REPORT_WINDOW and r.hour_depth_mm is not None),
        key=lambda r: r.at,
    )
    flag = None if not hour else int(bool(hour[0].hour_depth_mm) or hour[0].hour_trace)
    coded = _nearest(reports, kickoff, "weather_code")
    kind = kind_of_code(coded.weather_code if coded is not None else None) if flag == 1 else None
    return KickoffWeather(
        station,
        km,
        None if temperature is None else temperature.temperature_f,
        None if wind is None else wind.wind_mph,
        flag,
        hour[0].hour_depth_mm if hour else None,
        kind,
    )


class IsdReader:
    """One run's reads: the station list once, each station's season once."""

    def __init__(self, fetcher: Fetcher) -> None:
        self._fetcher = fetcher
        self._stations: list[Station] | None = None
        self._seasons: dict[tuple[str, int], list[Report]] = {}
        self.requests: list[str] = []

    def _get(self, url: str) -> str:
        self.requests.append(url)
        response = self._fetcher.get(url)
        if not response.ok:
            raise IsdError(f"NCEI answered HTTP {response.status} for {url}.")
        return response.text()

    def stations(self) -> list[Station]:
        if self._stations is None:
            self._stations = parse_stations(self._get(STATION_LIST_URL))
        return self._stations

    def season(self, station: str, season: int) -> list[Report]:
        key = (station, season)
        if key not in self._seasons:
            self._seasons[key] = parse_reports(self._get(season_url(station, season)))
        return self._seasons[key]

    def weather(self, latitude: float, longitude: float, season: int, kickoff: datetime) -> KickoffWeather | None:
        """The nearest station with a temperature or a wind reported near the kickoff, and the
        precipitation from it or, when it has no one-hour depth for the hour, from the next station in
        range that has one; None when no station reports a temperature or a wind."""
        found: KickoffWeather | None = None
        for station, km in nearest_stations(self.stations(), latitude, longitude, season):
            here = at_kickoff(self.season(station.id, season), kickoff, station.id, km)
            if found is None and (here.temperature_f is not None or here.wind_mph is not None):
                found = here
            if found is not None and here.precipitation is not None:
                return replace(
                    found,
                    precipitation=here.precipitation,
                    precipitation_mm=here.precipitation_mm,
                    kind=here.kind,
                    precipitation_station=station.id,
                )
        return found


Coordinates = Mapping[str, tuple[float, float]]
