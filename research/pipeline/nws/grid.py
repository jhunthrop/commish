"""THE FORECAST AT KICKOFF, READ FROM ONE GRID CELL'S RAW DATA (`/gridpoints/{office}/{x},{y}`).

Each layer is a list of values over ISO 8601 intervals (`2026-10-19T00:00:00+00:00/PT2H`). The kickoff's
value of a layer is the one whose interval holds the kickoff instant, and a layer whose answer ends
before kickoff has none (left out, never zero). The parser is strict, as the house's schema-drift
rule asks: a layer missing, a unit it does not know, or a weather word outside the service's list is
refused, so a changed answer is seen the first hour it arrives.

Units are the site's: degrees Fahrenheit, miles an hour, inches in the kickoff hour (the interval's
amount spread evenly over its hours), percent. The precipitation kind is one code of
`PRECIPITATION_KINDS`, the most severe kind the hour's weather names.
"""

import re
from collections.abc import Mapping
from dataclasses import dataclass, fields
from datetime import datetime, timedelta
from types import MappingProxyType
from typing import Any, Final

from research.errors import SchemaDriftError

PRECIPITATION_KINDS: Final = ("none", "rain", "thunderstorms", "snow", "ice")

# Every weather word the service uses, by the kind it counts as.
_WEATHER_KINDS: Final = MappingProxyType(
    {
        "rain": "rain",
        "rain_showers": "rain",
        "drizzle": "rain",
        "thunderstorms": "thunderstorms",
        "snow": "snow",
        "snow_showers": "snow",
        "blowing_snow": "snow",
        "freezing_rain": "ice",
        "freezing_drizzle": "ice",
        "freezing_spray": "ice",
        "sleet": "ice",
        "hail": "ice",
        "fog": "none",
        "freezing_fog": "none",
        "ice_fog": "none",
        "ice_crystals": "none",
        "frost": "none",
        "haze": "none",
        "smoke": "none",
        "blowing_dust": "none",
        "blowing_sand": "none",
        "volcanic_ash": "none",
        "water_spouts": "none",
    }
)

_CELSIUS: Final = "wmoUnit:degC"
_KILOMETRES_AN_HOUR: Final = "wmoUnit:km_h-1"
_PERCENT: Final = "wmoUnit:percent"
_MILLIMETRES: Final = "wmoUnit:mm"
_LAYER_UNITS: Final = MappingProxyType(
    {
        "temperature": _CELSIUS,
        "windSpeed": _KILOMETRES_AN_HOUR,
        "windGust": _KILOMETRES_AN_HOUR,
        "probabilityOfPrecipitation": _PERCENT,
        "quantitativePrecipitation": _MILLIMETRES,
        "skyCover": _PERCENT,
    }
)
_KILOMETRES_A_MILE: Final = 1.609344
_MILLIMETRES_AN_INCH: Final = 25.4
_DECIMALS: Final = 1
_AMOUNT_DECIMALS: Final = 2
_DURATION: Final = re.compile(r"^P(?:(\d+)D)?(?:T(?:(\d+)H)?)?$")


def parse_duration(text: str) -> timedelta:
    """An ISO 8601 duration in whole days and hours, the only ones the grid uses."""
    match = _DURATION.fullmatch(text)
    if match is None or text in ("P", "PT"):
        raise SchemaDriftError(f"The weather service's interval {text!r} is not in days and hours.")
    return timedelta(days=int(match[1] or 0), hours=int(match[2] or 0))


@dataclass(frozen=True)
class KickoffForecast:
    temperature_f: float | None
    wind_mph: float | None
    wind_gust_mph: float | None
    precipitation_probability: float | None
    precipitation_amount_in: float | None
    sky_cover_pct: float | None
    precipitation_kind: int | None
    issued_at: datetime

    @property
    def is_empty(self) -> bool:
        return all(getattr(self, f.name) is None for f in fields(self) if f.name != "issued_at")


def _interval(valid_time: object) -> tuple[datetime, timedelta]:
    if not isinstance(valid_time, str) or "/" not in valid_time:
        raise SchemaDriftError(f"The weather service's validTime {valid_time!r} is not an interval.")
    start, duration = valid_time.split("/", 1)
    return datetime.fromisoformat(start), parse_duration(duration)


def _entries(layer: Mapping[str, Any]) -> list[Mapping[str, Any]]:
    """A layer's values, each an object, or the answer is refused."""
    values = layer.get("values")
    if not isinstance(values, list) or not all(isinstance(entry, dict) for entry in values):
        raise SchemaDriftError("A weather service layer's values are not a list of objects.")
    return values


def _at(layer: Mapping[str, Any], kickoff: datetime) -> tuple[object, timedelta] | None:
    """The layer's value for the interval holding the kickoff, and that interval's length."""
    for entry in _entries(layer):
        start, length = _interval(entry.get("validTime"))
        if start <= kickoff < start + length:
            return entry.get("value"), length
    return None


def _layer(properties: Mapping[str, Any], name: str) -> Mapping[str, Any]:
    layer = properties.get(name)
    if not isinstance(layer, dict):
        raise SchemaDriftError(f"The weather service's grid answer has no {name} layer.")
    unit = _LAYER_UNITS.get(name)
    if unit is not None and layer.get("uom") != unit:
        raise SchemaDriftError(f"The weather service's {name} is in {layer.get('uom')!r}, not {unit}.")
    return layer


def _number(properties: Mapping[str, Any], name: str, kickoff: datetime) -> tuple[float, timedelta] | None:
    found = _at(_layer(properties, name), kickoff)
    if found is None or found[0] is None:
        return None
    value, length = found
    if not isinstance(value, int | float):
        raise SchemaDriftError(f"The weather service's {name} at kickoff is {value!r}, not a number.")
    return float(value), length


def _kinds(entries: object) -> list[int]:
    """The kinds one interval's weather names, refusing a word the service's list lacks."""
    if not isinstance(entries, list):
        raise SchemaDriftError("A weather service weather value is not a list.")
    kinds = []
    for entry in entries:
        word = entry.get("weather") if isinstance(entry, dict) else None
        if word is None:
            continue
        if word not in _WEATHER_KINDS:
            raise SchemaDriftError(f"The weather service names a weather {word!r} this parser does not know.")
        kinds.append(PRECIPITATION_KINDS.index(_WEATHER_KINDS[word]))
    return kinds


def _kind(properties: Mapping[str, Any], kickoff: datetime) -> int | None:
    """The most severe kind the kickoff interval names. Every interval's words are checked, so a
    word the service adds is refused the hour it first appears, wherever it falls."""
    layer = _layer(properties, "weather")
    for entry in _entries(layer):
        _kinds(entry.get("value"))
    found = _at(layer, kickoff)
    if found is None:
        return None
    return max(_kinds(found[0]), default=PRECIPITATION_KINDS.index("none"))


def _fahrenheit(celsius: float) -> float:
    return round(celsius * 9 / 5 + 32, _DECIMALS)


def _mph(kilometres: float) -> float:
    return round(kilometres / _KILOMETRES_A_MILE, _DECIMALS)


def kickoff_forecast(document: Mapping[str, Any], kickoff: datetime) -> KickoffForecast:
    """Every layer's value at the kickoff, in the site's units, and the forecast's issue time."""
    properties = document.get("properties")
    if not isinstance(properties, dict):
        raise SchemaDriftError("The weather service's grid answer has no properties object.")
    issued = properties.get("updateTime")
    if not isinstance(issued, str):
        raise SchemaDriftError("The weather service's grid answer has no updateTime.")
    temperature = _number(properties, "temperature", kickoff)
    wind = _number(properties, "windSpeed", kickoff)
    gust = _number(properties, "windGust", kickoff)
    chance = _number(properties, "probabilityOfPrecipitation", kickoff)
    amount = _number(properties, "quantitativePrecipitation", kickoff)
    sky = _number(properties, "skyCover", kickoff)
    hours = None if amount is None else amount[1] / timedelta(hours=1)
    return KickoffForecast(
        temperature_f=None if temperature is None else _fahrenheit(temperature[0]),
        wind_mph=None if wind is None else _mph(wind[0]),
        wind_gust_mph=None if gust is None else _mph(gust[0]),
        precipitation_probability=None if chance is None else chance[0],
        precipitation_amount_in=None
        if amount is None or hours is None
        else round(amount[0] / hours / _MILLIMETRES_AN_INCH, _AMOUNT_DECIMALS),
        sky_cover_pct=None if sky is None else sky[0],
        precipitation_kind=_kind(properties, kickoff),
        issued_at=datetime.fromisoformat(issued),
    )
