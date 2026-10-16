"""THE GAMEBOOK'S WEATHER LINE: temperature, wind and precipitation from the play-by-play `weather` text.

nflverse's play-by-play carries the official gamebook's weather line for every game ("Cloudy, rain
Temp: 69° F, Humidity: 87%, Wind: SW 16 mph"), including the games whose game table has no `temp`
or `wind` (182 outdoor games of 2022). The round 4 fill reads it second, after the game table
(preregistration §2.5).

TEMPERATURE is the integer after "Temp:"; a line whose "Temp:" holds no number ("Temp: ° F", the
indoor games' empty line) says nothing. WIND is read from the text between "Wind:" and the first
"mph": "Calm" is 0, otherwise the first whole number there (a range "11-17" or a gust "6G15" gives
its first figure, the sustained or lower wind); no number says nothing.

PRECIPITATION, as amended before any fit (preregistration §7, Amendment 1, item 1): the words match as
stems, rain (rainy, raining), showers (shower), drizzle (drizzling), snow (snowing, snowy), sleet,
flurries and "wintry mix". A word is not a present condition when "no" precedes it, or when any form of
"chance", "possible" or "forecast", or a percentage, appears anywhere in the same line; otherwise it is
a present condition and the flag is 1, and 0 when none is. The gamebook's own "Humidity: 87%" figure is a
measurement, not a probability, so it is not read as a percentage. An empty line ("Temp: ° F, Wind: mph")
is not read here at all: the fill (`game_weather.fill`) gives it no flag and goes to ISD (item 2).
"""

import re
from dataclasses import dataclass
from typing import Final

PRECIPITATION_WORDS: Final = (
    r"rain(?:y|ing)?",
    r"showers?",
    r"drizzl(?:e|ing)",
    r"snow(?:ing|y)?",
    "sleet",
    "flurries",
    "wintry mix",
)
NEGATING_PREFIXES: Final = ("no",)
HEDGE_STEMS: Final = ("chance", "possib", "forecast")
KIND_OF_STEM: Final = {
    "rain": "rain",
    "shower": "rain",
    "drizzl": "rain",
    "snow": "snow",
    "flurries": "snow",
    "sleet": "sleet",
    "wintry mix": "mix",
}
MIXED_KIND: Final = "mix"

_TEMPERATURE: Final = re.compile(r"temp:\s*(-?\d+)", re.IGNORECASE)
_WIND_SEGMENT: Final = re.compile(r"wind:(.*?)mph", re.IGNORECASE | re.DOTALL)
_FIRST_NUMBER: Final = re.compile(r"\d+")
_CALM: Final = re.compile(r"\bcalm\b", re.IGNORECASE)
_WORD: Final = re.compile(r"\b(" + "|".join(PRECIPITATION_WORDS) + r")\b", re.IGNORECASE)
_NEGATED: Final = re.compile(r"\b(" + "|".join(re.escape(p) for p in NEGATING_PREFIXES) + r")\s*$", re.IGNORECASE)
_HEDGE: Final = re.compile("|".join(HEDGE_STEMS), re.IGNORECASE)
_HUMIDITY: Final = re.compile(r"humidity:\s*\d+\s*%", re.IGNORECASE)


@dataclass(frozen=True, slots=True)
class Precipitation:
    flag: int
    kind: str | None


def temperature_f(text: str) -> float | None:
    found = _TEMPERATURE.search(text)
    return None if found is None else float(found.group(1))


def wind_mph(text: str) -> float | None:
    segment = _WIND_SEGMENT.search(text)
    if segment is None:
        return None
    if _CALM.search(segment.group(1)):
        return 0.0
    number = _FIRST_NUMBER.search(segment.group(1))
    return None if number is None else float(number.group(0))


def _kind(word: str) -> str:
    return next(kind for stem, kind in KIND_OF_STEM.items() if word.startswith(stem))


def _is_hedged(text: str) -> bool:
    return _HEDGE.search(text) is not None or "%" in _HUMIDITY.sub("", text)


def _present_words(text: str) -> list[str]:
    if _is_hedged(text):
        return []
    lowered = text.lower()
    return [m.group(1) for m in _WORD.finditer(lowered) if not _NEGATED.search(lowered[: m.start()])]


def precipitation(text: str) -> Precipitation:
    """The preregistered flag, and the present condition's kind (several kinds are a mix)."""
    kinds = {_kind(word) for word in _present_words(text)}
    if not kinds:
        return Precipitation(0, None)
    return Precipitation(1, kinds.pop() if len(kinds) == 1 else MIXED_KIND)
