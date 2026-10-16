"""The gamebook weather line's parser, on lines as nflverse's play-by-play records them (2016 to 2022)."""

import pytest

from research.pipeline.weather.gamebook import Precipitation, precipitation, temperature_f, wind_mph


@pytest.mark.parametrize(
    ("text", "temperature", "wind"),
    [
        ("Partly Cloudy Temp: 84° F, Humidity: 44%, Wind: NE 8 mph", 84.0, 8.0),
        ("Clear Temp: 79° F, Humidity: 40 %, Wind: NW 17 mph gusting to 28 mph", 79.0, 17.0),
        ("Temp: 61° F, Humidity: 77%, Wind: Calm mph", 61.0, 0.0),
        ("Partly Cloudy Temp: 76° F, Humidity: 19%, Wind: SouthEast 6G15 mph", 76.0, 6.0),
        ("Cloudy Temp: 40° F, Humidity: 67%, Wind: from W 11-17 mph", 40.0, 11.0),
        ("Cloudy Temp: 77° F, Humidity: 77%, Wind: 18 E mph", 77.0, 18.0),
        ("Cloudy Temp: 68° F, Humidity: 63%, Wind: mph", 68.0, None),
        ("Temp: ° F, Wind: mph", None, None),
        ("Sunny Temp: -2° F, Wind: W 9 mph", -2.0, 9.0),
        ("", None, None),
    ],
)
def test_temperature_and_wind(text: str, temperature: float | None, wind: float | None) -> None:
    assert temperature_f(text) == temperature
    assert wind_mph(text) == wind


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("Cloudy, rain Temp: 69° F, Humidity: 87%, Wind: SW 16 mph", Precipitation(1, "rain")),
        ("Rain showers Temp: 37° F, Humidity: 87%, Wind: WSW 10 mph", Precipitation(1, "rain")),
        ("Light snow Temp: 30° F, Wind: N 10 mph", Precipitation(1, "snow")),
        ("Snow and sleet Temp: 31° F, Wind: N 10 mph", Precipitation(1, "mix")),
        ("Wintry mix Temp: 33° F, Wind: N 10 mph", Precipitation(1, "mix")),
        ("Flurries Temp: 28° F, Wind: N 10 mph", Precipitation(1, "snow")),
        ("Cloudy, 30% chance of rain Temp: 60° F, Wind: S 5 mph", Precipitation(0, None)),
        ("Cloudy, slight chance of showers Temp: 60° F, Wind: S 5 mph", Precipitation(0, None)),
        ("Possible drizzle Temp: 60° F, Wind: S 5 mph", Precipitation(0, None)),
        ("Clear, no rain Temp: 60° F, Wind: S 5 mph", Precipitation(0, None)),
        ("Cloudy, forecast: rain later Temp: 60° F, Wind: S 5 mph", Precipitation(0, None)),
        ("Sunny Temp: 74° F, Humidity: 53%, Wind: E 6 mph", Precipitation(0, None)),
        # The stems of the amended list (Amendment 1, item 1).
        ("Rainy Temp: 50° F, Wind: E 6 mph", Precipitation(1, "rain")),
        ("Raining Temp: 50° F, Wind: E 6 mph", Precipitation(1, "rain")),
        ("Shower Temp: 50° F, Wind: E 6 mph", Precipitation(1, "rain")),
        ("Drizzling Temp: 50° F, Wind: E 6 mph", Precipitation(1, "rain")),
        ("Snowing Temp: 28° F, Wind: E 6 mph", Precipitation(1, "snow")),
        ("Snowy Temp: 28° F, Wind: E 6 mph", Precipitation(1, "snow")),
        # A hedge or a percentage anywhere in the line, before or after the word, is not a present condition.
        ("Mostly Cloudy with Light Rain Forecasted Temp: 66° F, Wind: S 8 mph", Precipitation(0, None)),
        ("Rain Chance 40% Temp: 66° F, Wind: S 8 mph", Precipitation(0, None)),
        ("Rain Chances Temp: 66° F, Wind: S 8 mph", Precipitation(0, None)),
        ("Rain possible Temp: 66° F, Wind: S 8 mph", Precipitation(0, None)),
        ("Rain, possibly heavy Temp: 66° F, Wind: S 8 mph", Precipitation(0, None)),
        ("Rain 40% Temp: 66° F, Wind: S 8 mph", Precipitation(0, None)),
        ("40 % showers Temp: 66° F, Wind: S 8 mph", Precipitation(0, None)),
        ("Forecast cloudy, rain Temp: 66° F, Wind: S 8 mph", Precipitation(0, None)),
        # The humidity figure is a measurement, not a probability.
        ("Rain Temp: 66° F, Humidity: 87 %, Wind: S 8 mph", Precipitation(1, "rain")),
        ("No rain, snow Temp: 30° F, Wind: S 8 mph", Precipitation(1, "snow")),
    ],
)
def test_the_preregistered_precipitation_word(text: str, expected: Precipitation) -> None:
    assert precipitation(text) == expected


@pytest.mark.parametrize(
    ("text", "flag"),
    [
        ("Rain Chance 40%", 0),
        ("Light Rain Forecasted", 0),
        ("rainy", 1),
        ("Raining", 1),
    ],
)
def test_the_four_lines_the_literal_rule_misread(text: str, flag: int) -> None:
    assert precipitation(text).flag == flag


def test_the_empty_gamebook_line_has_no_reading() -> None:
    line = "Temp: ° F, Wind: mph"
    assert (temperature_f(line), wind_mph(line)) == (None, None)
