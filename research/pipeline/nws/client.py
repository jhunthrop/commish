"""THE WEATHER SERVICE'S CLIENT: `api.weather.gov`, free and keyless.

The service asks every caller for a `User-Agent` naming the application and a way to reach its
owner, so each request carries one. It publishes no rate limit and says an over-limit request may be
retried after a few seconds: a 429 or a 5xx is retried once after a pause, and a second is a failure.
A body that is not the JSON object the endpoint answers is a typed failure, never an empty forecast.
"""

import json
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from http import HTTPStatus
from typing import Any, Final, Literal

from research.errors import ResearchError, SchemaDriftError
from research.pipeline.http import Fetcher, HttpResponse

NWS_BASE_URL: Final = "https://api.weather.gov"
NWS_USER_AGENT: Final = "commish (trycommish.app, hello@trycommish.app)"
RETRY_DELAY_SECONDS: Final = 5.0
# The service wants a point to four decimal places and redirects anything finer.
_POINT_DECIMALS: Final = 4

FailureKind = Literal["not_found", "rate_limited", "upstream", "malformed"]


class NwsError(ResearchError):
    def __init__(self, kind: FailureKind, url: str, message: str) -> None:
        super().__init__(message)
        self.kind: FailureKind = kind
        self.url = url


@dataclass(frozen=True)
class GridPoint:
    office: str
    grid_x: int
    grid_y: int
    grid_url: str
    time_zone: str


def _sleep(seconds: float) -> None:
    time.sleep(seconds)


def _retryable(status: int) -> bool:
    return status == HTTPStatus.TOO_MANY_REQUESTS or status >= HTTPStatus.INTERNAL_SERVER_ERROR


@dataclass(frozen=True)
class NwsClient:
    fetcher: Fetcher
    base_url: str = NWS_BASE_URL
    sleep: Callable[[float], None] = field(default=_sleep)

    def _get(self, url: str) -> dict[str, Any]:
        headers = {"User-Agent": NWS_USER_AGENT, "Accept": "application/geo+json"}
        response = self.fetcher.get(url, headers)
        if _retryable(response.status):
            self.sleep(RETRY_DELAY_SECONDS)
            response = self.fetcher.get(url, headers)
        return _body(response, url)

    def point(self, latitude: float, longitude: float) -> GridPoint:
        """The grid cell and forecast URL the service files a coordinate under."""
        url = f"{self.base_url}/points/{latitude:.{_POINT_DECIMALS}f},{longitude:.{_POINT_DECIMALS}f}"
        properties = _properties(self._get(url), url)
        try:
            return GridPoint(
                office=str(properties["gridId"]),
                grid_x=int(properties["gridX"]),
                grid_y=int(properties["gridY"]),
                grid_url=str(properties["forecastGridData"]),
                time_zone=str(properties["timeZone"]),
            )
        except (KeyError, TypeError, ValueError) as error:
            raise SchemaDriftError(f"The weather service's point answer for {url} lacks {error}.") from error

    def grid(self, grid_url: str) -> dict[str, Any]:
        """The raw forecast data of one grid cell, every layer over the coming week."""
        return self._get(grid_url)


def _body(response: HttpResponse, url: str) -> dict[str, Any]:
    if response.status == HTTPStatus.NOT_FOUND:
        raise NwsError("not_found", url, f"The weather service has no answer at {url}.")
    if _retryable(response.status):
        raise NwsError("rate_limited", url, f"The weather service answered HTTP {response.status} twice for {url}.")
    if not response.ok:
        raise NwsError("upstream", url, f"The weather service answered HTTP {response.status} for {url}.")
    try:
        parsed: object = json.loads(response.text())
    except ValueError:
        parsed = None
    if not isinstance(parsed, dict):
        raise NwsError("malformed", url, f"The weather service answered {url} with no JSON object.")
    return parsed


def _properties(document: dict[str, Any], url: str) -> dict[str, Any]:
    properties = document.get("properties")
    if not isinstance(properties, dict):
        raise SchemaDriftError(f"The weather service's answer for {url} has no properties object.")
    return properties
