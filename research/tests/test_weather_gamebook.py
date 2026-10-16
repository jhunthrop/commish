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
        # Outside the preregistered list, so not counted (the results name such words).
        ("Rainy Temp: 50° F, Wind: E 6 mph", Precipitation(0, None)),
        # The preregistered rule read literally: the word precedes "forecast", so it is present.
        ("Mostly Cloudy with Light Rain Forecasted Temp: 66° F, Wind: S 8 mph", Precipitation(1, "rain")),
    ],
)
def test_the_preregistered_precipitation_word(text: str, expected: Precipitation) -> None:
    assert precipitation(text) == expected
