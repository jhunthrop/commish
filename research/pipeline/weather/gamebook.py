"""THE GAMEBOOK'S WEATHER LINE: temperature, wind and precipitation from the play-by-play `weather` text.

nflverse's play-by-play carries the official gamebook's weather line for every game ("Cloudy, rain
Temp: 69° F, Humidity: 87%, Wind: SW 16 mph"), including the games whose game table has no `temp`
or `wind` (182 outdoor games of 2022). The round 4 fill reads it second, after the game table
(preregistration §2.5).

TEMPERATURE is the integer after "Temp:"; a line whose "Temp:" holds no number ("Temp: ° F", the
indoor games' empty line) says nothing. WIND is read from the text between "Wind:" and the first
"mph": "Calm" is 0, otherwise the first whole number there (a range "11-17" or a gust "6G15" gives
its first figure, the sustained or lower wind); no number says nothing.

PRECIPITATION, preregistered word for word (§2.5, "Parsing the precipitation word"): the flag is 1
when the text names one of rain, showers, drizzle, snow, sleet, flurries or "wintry mix" as a
present condition, and 0 otherwise. A word preceded by "chance of", "no", "slight chance" or
"possible", or appearing only after "forecast", is not a present condition. The list is the
preregistered one: a word outside it ("rainy", "snowing") does not count, and the results name such
words rather than this parser widening the list.
"""

import re
from dataclasses import dataclass
from typing import Final

PRECIPITATION_WORDS: Final = ("rain", "showers", "drizzle", "snow", "sleet", "flurries", "wintry mix")
NEGATING_PREFIXES: Final = ("chance of", "no", "slight chance", "possible")
FORECAST_WORD: Final = "forecast"
KIND_OF_WORD: Final = {
    "rain": "rain",
    "showers": "rain",
    "drizzle": "rain",
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
_WORD: Final = re.compile(r"\b(" + "|".join(re.escape(w) for w in PRECIPITATION_WORDS) + r")\b", re.IGNORECASE)
_NEGATED: Final = re.compile(r"\b(" + "|".join(re.escape(p) for p in NEGATING_PREFIXES) + r")\s*$", re.IGNORECASE)


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


def _present_words(text: str) -> list[str]:
    lowered = text.lower()
    forecast_at = lowered.find(FORECAST_WORD)
    present: list[str] = []
    for match in _WORD.finditer(lowered):
        if forecast_at != -1 and match.start() > forecast_at:
            continue
        if _NEGATED.search(lowered[: match.start()]):
            continue
        present.append(match.group(1))
    return present


def precipitation(text: str) -> Precipitation:
    """The preregistered flag, and the present condition's kind (several kinds are a mix)."""
    kinds = {KIND_OF_WORD[word] for word in _present_words(text)}
    if not kinds:
        return Precipitation(0, None)
    return Precipitation(1, kinds.pop() if len(kinds) == 1 else MIXED_KIND)
